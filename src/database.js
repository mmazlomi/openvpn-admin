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
      notes              TEXT
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

    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
  `);
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
  create({ name, certificateSerial = null, expiresAt = null, notes = null }) {
    const info = getDb()
      .prepare(
        `INSERT INTO clients (name, status, certificate_serial, expires_at, notes)
         VALUES (?, 'active', ?, ?, ?)`,
      )
      .run(name, certificateSerial, expiresAt, notes);
    return this.findByName(name) && getDb().prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
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
      .prepare("UPDATE clients SET status = 'revoked', revoked_at = datetime('now') WHERE name = ?")
      .run(name);
  },
  markArchived(name) {
    getDb()
      .prepare("UPDATE clients SET status = 'archived', archived_at = datetime('now') WHERE name = ?")
      .run(name);
  },
  setLastSeen(name, isoTs) {
    getDb().prepare('UPDATE clients SET last_seen = ? WHERE name = ?').run(isoTs, name);
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

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}
