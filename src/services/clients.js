/**
 * Client lifecycle orchestration: create / list / revoke / archive / sync.
 * Combines the SQLite metadata store, the EasyRSA layer and live status.
 */
import { clients as clientsDb, audit } from '../database.js';
import { buildClient, revokeClient, readIndex } from './easyrsa.js';
import { getStatus } from './openvpn.js';
import { validateClientName, validateNotes } from '../utils/validation.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/** List clients merged with live connection info. */
export async function listClients() {
  const rows = clientsDb.all();
  let status = { available: false, clients: [] };
  try {
    status = await getStatus();
  } catch {
    /* status is best-effort */
  }
  const online = new Map(status.clients.map((c) => [c.name, c]));

  return {
    mgmtAvailable: status.available,
    clients: rows.map((r) => {
      const live = online.get(r.name);
      if (live && live.connectedSince) {
        // Opportunistically refresh last_seen.
        const iso = new Date((live.connectedSinceEpoch || 0) * 1000).toISOString();
        if (r.status === 'active') clientsDb.setLastSeen(r.name, iso);
      }
      return {
        name: r.name,
        status: r.status,
        certificateSerial: r.certificate_serial,
        createdAt: r.created_at,
        revokedAt: r.revoked_at,
        archivedAt: r.archived_at,
        expiresAt: r.expires_at,
        lastSeen: live ? new Date().toISOString() : r.last_seen,
        notes: r.notes,
        online: !!live,
        connection: live
          ? {
              realAddress: live.realAddress,
              virtualAddress: live.virtualAddress,
              bytesReceived: live.bytesReceived,
              bytesSent: live.bytesSent,
              connectedSince: live.connectedSince,
            }
          : null,
      };
    }),
  };
}

export async function getClient(rawName) {
  const name = validateClientName(rawName);
  const row = clientsDb.findByName(name);
  if (!row) throw new NotFoundError('Client not found', 'CLIENT_NOT_FOUND');
  const { clients: list } = await listClients();
  return list.find((c) => c.name === name);
}

export async function createClient(rawName, rawNotes, actor) {
  const name = validateClientName(rawName);
  const notes = validateNotes(rawNotes);

  const result = await buildClient(name, (n) => !!clientsDb.findByName(n));
  clientsDb.create({
    name,
    certificateSerial: result.serial,
    expiresAt: result.expiresAt,
    notes,
  });
  audit.record({
    adminId: actor?.id,
    adminName: actor?.username,
    action: 'CREATE_CLIENT',
    clientName: name,
    ip: actor?.ip,
    detail: result.serial ? `serial=${result.serial}` : null,
  });
  logger.info('client created', { client: name });
  return clientsDb.findByName(name);
}

export async function revoke(rawName, actor) {
  const name = validateClientName(rawName);
  const row = clientsDb.findByName(name);
  if (!row) throw new NotFoundError('Client not found', 'CLIENT_NOT_FOUND');
  if (row.status === 'revoked' || row.status === 'archived') {
    throw new ConflictError('Client is already revoked', 'ALREADY_REVOKED');
  }

  const { crl } = await revokeClient(name);
  clientsDb.markRevoked(name);
  audit.record({
    adminId: actor?.id,
    adminName: actor?.username,
    action: 'REVOKE_CLIENT',
    clientName: name,
    ip: actor?.ip,
    detail: `crl_size=${crl.size}`,
  });
  logger.info('client revoked', { client: name });
  return clientsDb.findByName(name);
}

/**
 * Archive: a metadata-only state change. Certificates/keys are left on disk
 * untouched (the filesystem stays the source of truth). Only revoked clients
 * may be archived.
 */
export async function archive(rawName, actor) {
  const name = validateClientName(rawName);
  const row = clientsDb.findByName(name);
  if (!row) throw new NotFoundError('Client not found', 'CLIENT_NOT_FOUND');
  if (row.status !== 'revoked') {
    throw new ConflictError('Only revoked clients can be archived', 'NOT_REVOKED');
  }
  clientsDb.markArchived(name);
  audit.record({
    adminId: actor?.id,
    adminName: actor?.username,
    action: 'ARCHIVE_CLIENT',
    clientName: name,
    ip: actor?.ip,
  });
  logger.info('client archived', { client: name });
  return clientsDb.findByName(name);
}

/**
 * Discover certificates already in the PKI and populate SQLite.
 * Never revokes, regenerates or deletes anything.
 */
export async function sync(actor) {
  const index = await readIndex();
  const summary = { discovered: 0, created: 0, updated: 0, skipped: 0, entries: [] };

  for (const entry of index) {
    if (entry.name === 'server') {
      summary.skipped += 1;
      continue;
    }
    try {
      validateClientName(entry.name);
    } catch {
      summary.skipped += 1;
      continue;
    }
    summary.discovered += 1;
    const res = clientsDb.upsertFromPki({
      name: entry.name,
      status: entry.status,
      certificateSerial: entry.serial,
      expiresAt: entry.expiresAt,
      revokedAt: entry.revokedAt,
    });
    if (res.created) summary.created += 1;
    else summary.updated += 1;
    summary.entries.push({ name: entry.name, status: entry.status, created: res.created });
  }

  audit.record({
    adminId: actor?.id,
    adminName: actor?.username,
    action: 'SYNC',
    ip: actor?.ip,
    detail: `discovered=${summary.discovered} created=${summary.created} updated=${summary.updated}`,
  });
  logger.info('sync complete', {
    discovered: summary.discovered,
    created: summary.created,
    updated: summary.updated,
  });
  return summary;
}
