/**
 * SQLite access layer (better-sqlite3, synchronous).
 * All queries are parameterised. The filesystem PKI remains the source of
 * truth for certificates and keys; this database only stores metadata.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import config from './config.js';
import logger from './utils/logger.js';

let db;

export function getDb() {
  if (db) return db;

  const dir = path.dirname(config.database);
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.database);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  logger.debug('database opened', { path: config.database });
  return db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      status             TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','revoked','archived')),
      certificate_serial TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at         TEXT,
      archived_at        TEXT,
      expires_at         TEXT,
      last_seen          TEXT,
      notes              TEXT,
      static_ip          TEXT,
      paused             INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id    INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      admin_name  TEXT,
      action      TEXT NOT NULL,
      client_name TEXT,
      ip_address  TEXT,
      detail      TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid        TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connection_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name     TEXT NOT NULL,
      real_address    TEXT,
      virtual_ip      TEXT,
      connected_at    TEXT NOT NULL,
      disconnected_at TEXT,
      bytes_received  INTEGER DEFAULT 0,
      bytes_sent      INTEGER DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'connected'
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
    CREATE INDEX IF NOT EXISTS idx_conn_client ON connection_history (client_name, id DESC);
    CREATE INDEX IF NOT EXISTS idx_conn_id ON connection_history (id DESC);
  `);

  const cols = d.pragma('table_info(clients)');
  if (!cols.some((c) => c.name === 'static_ip')) {
    d.exec('ALTER TABLE clients ADD COLUMN static_ip TEXT');
  }
  if (!cols.some((c) => c.name === 'paused')) {
    d.exec('ALTER TABLE clients ADD COLUMN paused INTEGER NOT NULL DEFAULT 0');
  }
  d.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_static_ip ON clients (static_ip) WHERE static_ip IS NOT NULL');
}

/* ----------------------------- admins ----------------------------- */

export const admins = {
  countAll() {
    return getDb().prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  },
  findByUsername(username) {
    return getDb().prepare('SELECT * FROM admins WHERE username = ?').get(username);
  },
  findById(id) {
    return getDb().prepare('SELECT * FROM admins WHERE id = ?').get(id);
  },
  create(username, passwordHash) {
    const info = getDb()
      .prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
      .run(username, passwordHash);
    return info.lastInsertRowid;
  },
  updatePassword(id, passwordHash) {
    getDb().prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  },
  markLogin(id) {
    getDb().prepare("UPDATE admins SET last_login_at = datetime('now') WHERE id = ?").run(id);
  },
};

/* ----------------------------- clients ---------------------------- */

export const clients = {
  all() {
    return getDb().prepare('SELECT * FROM clients ORDER BY name COLLATE NOCASE').all();
  },
  findByName(name) {
    return getDb().prepare('SELECT * FROM clients WHERE name = ?').get(name);
  },
  findByStaticIp(ip) {
    return getDb().prepare('SELECT * FROM clients WHERE static_ip = ?').get(ip);
  },
  create({ name, certificateSerial = null, expiresAt = null, notes = null, staticIp = null }) {
    const info = getDb()
      .prepare(
        `INSERT INTO clients (name, status, certificate_serial, expires_at, notes, static_ip)
         VALUES (?, 'active', ?, ?, ?, ?)`,
      )
      .run(name, certificateSerial, expiresAt, notes, staticIp);
    return this.findByName(name) && getDb().prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
  },
  setStaticIp(name, staticIp) {
    getDb().prepare('UPDATE clients SET static_ip = ? WHERE name = ?').run(staticIp, name);
    return this.findByName(name);
  },
  upsertFromPki({ name, status, certificateSerial, expiresAt, revokedAt }) {
    const existing = this.findByName(name);
    if (existing) {
      getDb()
        .prepare(
          `UPDATE clients
             SET status = ?, certificate_serial = ?, expires_at = ?,
                 revoked_at = COALESCE(?, revoked_at)
           WHERE name = ?`,
        )
        .run(status, certificateSerial, expiresAt, revokedAt, name);
      return { name, created: false };
    }
    getDb()
      .prepare(
        `INSERT INTO clients (name, status, certificate_serial, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(name, status, certificateSerial, expiresAt, revokedAt);
    return { name, created: true };
  },
  markRevoked(name) {
    getDb()
      .prepare("UPDATE clients SET status = 'revoked', revoked_at = datetime('now'), static_ip = NULL, paused = 0 WHERE name = ?")
      .run(name);
  },
  markArchived(name) {
    getDb()
      .prepare("UPDATE clients SET status = 'archived', archived_at = datetime('now'), static_ip = NULL, paused = 0 WHERE name = ?")
      .run(name);
  },
  setPaused(name, paused) {
    getDb().prepare('UPDATE clients SET paused = ? WHERE name = ?').run(paused ? 1 : 0, name);
    return this.findByName(name);
  },
  setLastSeen(name, isoTs) {
    getDb().prepare('UPDATE clients SET last_seen = ? WHERE name = ?').run(isoTs, name);
  },
  deleteByName(name) {
    getDb().prepare('DELETE FROM clients WHERE name = ?').run(name);
  },
  updateExpiry(name, { certificateSerial, expiresAt }) {
    getDb()
      .prepare(
        `UPDATE clients
            SET status = 'active', certificate_serial = ?, expires_at = ?, revoked_at = NULL
          WHERE name = ?`,
      )
      .run(certificateSerial, expiresAt, name);
    return this.findByName(name);
  },
};

/* --------------------------- audit logs -------------------------- */

export const audit = {
  record({ adminId = null, adminName = null, action, clientName = null, ip = null, detail = null }) {
    getDb()
      .prepare(
        `INSERT INTO audit_logs (admin_id, admin_name, action, client_name, ip_address, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(adminId, adminName, action, clientName, ip, detail);
  },
  recent(limit = 100) {
    return getDb()
      .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?')
      .all(Math.min(Math.max(limit, 1), 500));
  },
};

/* ----------------------- connection history ----------------------- */

export const connections = {
  recordConnection({ clientName, realAddress, virtualIp, connectedAt, bytesReceived = 0, bytesSent = 0 }) {
    const d = getDb();
    const existing = d
      .prepare('SELECT id FROM connection_history WHERE client_name = ? AND connected_at = ?')
      .get(clientName, connectedAt);
    if (!existing) {
      d.prepare(
        `INSERT INTO connection_history (client_name, real_address, virtual_ip, connected_at, bytes_received, bytes_sent, status)
         VALUES (?, ?, ?, ?, ?, ?, 'connected')`,
      ).run(clientName, realAddress, virtualIp, connectedAt, bytesReceived, bytesSent);
    } else {
      d.prepare(
        `UPDATE connection_history
            SET bytes_received = ?, bytes_sent = ?, virtual_ip = COALESCE(?, virtual_ip), real_address = COALESCE(?, real_address)
          WHERE id = ?`,
      ).run(bytesReceived, bytesSent, virtualIp, realAddress, existing.id);
    }
  },

  markDisconnected(activeSessions) {
    const d = getDb();
    const openRows = d.prepare("SELECT id, client_name, connected_at FROM connection_history WHERE status = 'connected'").all();
    const activeSet = new Set(activeSessions.map((s) => `${s.clientName}_${s.connectedAt}`));
    for (const row of openRows) {
      if (!activeSet.has(`${row.client_name}_${row.connected_at}`)) {
        d.prepare("UPDATE connection_history SET status = 'disconnected', disconnected_at = datetime('now') WHERE id = ?").run(row.id);
      }
    }
  },

  getRecent(limit = 10) {
    return getDb()
      .prepare(
        `SELECT id, client_name AS clientName, real_address AS realAddress, virtual_ip AS virtualIp,
                connected_at AS connectedAt, disconnected_at AS disconnectedAt,
                bytes_received AS bytesReceived, bytes_sent AS bytesSent, status
           FROM connection_history
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(Math.min(Math.max(limit, 1), 100));
  },

  getForClient(clientName, limit = 50) {
    return getDb()
      .prepare(
        `SELECT id, client_name AS clientName, real_address AS realAddress, virtual_ip AS virtualIp,
                connected_at AS connectedAt, disconnected_at AS disconnectedAt,
                bytes_received AS bytesReceived, bytes_sent AS bytesSent, status
           FROM connection_history
          WHERE client_name = ?
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(clientName, Math.min(Math.max(limit, 1), 100));
  },

  getAllTrafficStats() {
    const rows = getDb().prepare(`
      SELECT
        c.name AS clientName,
        COALESCE(stats.total_bytes_received, 0) AS bytesReceived,
        COALESCE(stats.total_bytes_sent, 0) AS bytesSent,
        COALESCE(stats.total_connections, 0) AS connectionCount,
        latest.real_address AS lastRealAddress
      FROM clients c
      LEFT JOIN (
        SELECT
          client_name,
          SUM(bytes_received) AS total_bytes_received,
          SUM(bytes_sent) AS total_bytes_sent,
          COUNT(id) AS total_connections
        FROM connection_history
        GROUP BY client_name
      ) stats ON stats.client_name = c.name
      LEFT JOIN (
        SELECT h.client_name, h.real_address
        FROM connection_history h
        INNER JOIN (
          SELECT client_name, MAX(id) AS max_id
          FROM connection_history
          WHERE real_address IS NOT NULL AND real_address != ''
          GROUP BY client_name
        ) latest_id ON h.id = latest_id.max_id
      ) latest ON latest.client_name = c.name
    `).all();

    const map = new Map();
    for (const r of rows) {
      map.set(r.clientName, {
        bytesReceived: Number(r.bytesReceived) || 0,
        bytesSent: Number(r.bytesSent) || 0,
        totalBytes: (Number(r.bytesReceived) || 0) + (Number(r.bytesSent) || 0),
        connectionCount: Number(r.connectionCount) || 0,
        lastRealAddress: r.lastRealAddress || null,
      });
    }
    return map;
  },

  getClientTrafficSummary(clientName) {
    const row = getDb().prepare(`
      SELECT
        COALESCE(SUM(bytes_received), 0) AS bytesReceived,
        COALESCE(SUM(bytes_sent), 0) AS bytesSent,
        COUNT(id) AS connectionCount,
        (
          SELECT real_address FROM connection_history
          WHERE client_name = ? AND real_address IS NOT NULL AND real_address != ''
          ORDER BY id DESC LIMIT 1
        ) AS lastRealAddress
      FROM connection_history
      WHERE client_name = ?
    `).get(clientName, clientName);

    const addr = row?.lastRealAddress || null;
    let lastRealIp = null;
    if (addr) {
      const m = addr.match(/^\[?([a-fA-F0-9:.]+)\]?:[0-9]+$/);
      lastRealIp = m ? m[1] : addr;
    }

    if (!row) {
      return { bytesReceived: 0, bytesSent: 0, totalBytes: 0, connectionCount: 0, lastRealAddress: null, lastRealIp: null };
    }
    return {
      bytesReceived: Number(row.bytesReceived) || 0,
      bytesSent: Number(row.bytesSent) || 0,
      totalBytes: (Number(row.bytesReceived) || 0) + (Number(row.bytesSent) || 0),
      connectionCount: Number(row.connectionCount) || 0,
      lastRealAddress: addr,
      lastRealIp,
    };
  },
};

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}
