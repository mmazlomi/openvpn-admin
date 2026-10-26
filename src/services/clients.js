/**
 * Client lifecycle orchestration: create / list / revoke / archive / sync.
 * Combines the SQLite metadata store, the EasyRSA layer and live status.
 */
import config from '../config.js';
import { clients as clientsDb, audit } from '../database.js';
import { buildClient, revokeClient, readIndex } from './easyrsa.js';
import { helper } from './helper.js';
import { getStatus, killClient } from './openvpn.js';
import { validateClientName, validateNotes, validateStaticIp, parseCidr, validateDays } from '../utils/validation.js';
import { ConflictError, NotFoundError, PkiError } from '../utils/errors.js';
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
        staticIp: r.static_ip || null,
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

export async function createClient(rawName, rawNotes, rawStaticIpOrActor, maybeActor) {
  let rawStaticIp;
  let actor;
  if (maybeActor !== undefined || (typeof rawStaticIpOrActor === 'string' || rawStaticIpOrActor === null)) {
    rawStaticIp = rawStaticIpOrActor;
    actor = maybeActor;
  } else {
    rawStaticIp = null;
    actor = rawStaticIpOrActor;
  }

  const name = validateClientName(rawName);
  const notes = validateNotes(rawNotes);
  const staticIp = validateStaticIp(rawStaticIp, config.vpnNetwork, {
    minIp: config.staticIpMin,
    maxIp: config.staticIpMax,
  });

  if (staticIp) {
    const dup = clientsDb.findByStaticIp(staticIp);
    if (dup) {
      throw new ConflictError(`IP ${staticIp} is already assigned to client "${dup.name}"`, 'IP_DUPLICATE');
    }

    try {
      const status = await getStatus();
      const activeOnline = status.clients.find((c) => c.virtualAddress === staticIp);
      if (activeOnline) {
        throw new ConflictError(`IP ${staticIp} is currently active on client "${activeOnline.name}"`, 'IP_IN_USE');
      }
    } catch {
      /* status check is best-effort */
    }
  }

  const result = await buildClient(name, (n) => !!clientsDb.findByName(n));

  if (staticIp) {
    const { netmask } = parseCidr(config.vpnNetwork);
    await helper('set-ip', [name, staticIp, netmask]);
  }

  clientsDb.create({
    name,
    certificateSerial: result.serial,
    expiresAt: result.expiresAt,
    notes,
    staticIp,
  });

  const details = [];
  if (result.serial) details.push(`serial=${result.serial}`);
  if (staticIp) details.push(`ip=${staticIp}`);

  audit.record({
    adminId: actor?.id,
    adminName: actor?.username,
    action: 'CREATE_CLIENT',
    clientName: name,
    ip: actor?.ip,
    detail: details.length ? details.join(' ') : null,
  });
  logger.info('client created', { client: name, staticIp });
  return clientsDb.findByName(name);
}

export async function setClientIp(rawName, rawStaticIp, actor) {
  const name = validateClientName(rawName);
  const row = clientsDb.findByName(name);
  if (!row) throw new NotFoundError('Client not found', 'CLIENT_NOT_FOUND');
  if (row.status !== 'active') {
    throw new ConflictError('Cannot assign IP to a revoked or archived client', 'CLIENT_NOT_ACTIVE');
  }

  const staticIp = validateStaticIp(rawStaticIp, config.vpnNetwork, {
    minIp: config.staticIpMin,
    maxIp: config.staticIpMax,
  });

  if (staticIp === null) {
    if (row.static_ip) {
      try {
        await helper('delete-ip', [name]);
      } catch (err) {
        logger.warn('failed to delete ccd file', { client: name, err: err.message });
      }
      clientsDb.setStaticIp(name, null);
      audit.record({
        adminId: actor?.id,
        adminName: actor?.username,
        action: 'UNASSIGN_STATIC_IP',
        clientName: name,
        ip: actor?.ip,
      });
      logger.info('client static IP unassigned', { client: name });
    }
    return clientsDb.findByName(name);
  }

  const dup = clientsDb.findByStaticIp(staticIp);
  if (dup && dup.name !== name) {
    throw new ConflictError(`IP ${staticIp} is already assigned to client "${dup.name}"`, 'IP_DUPLICATE');
  }

  try {
    const status = await getStatus();
    const activeOnline = status.clients.find((c) => c.virtualAddress === staticIp && c.name !== name);
    if (activeOnline) {
      throw new ConflictError(`IP ${staticIp} is currently active on client "${activeOnline.name}"`, 'IP_IN_USE');
    }
  } catch {
    /* status check is best-effort */
  }

  const { netmask } = parseCidr(config.vpnNetwork);
  await helper('set-ip', [name, staticIp, netmask]);
  clientsDb.setStaticIp(name, staticIp);

  audit.record({
    adminId: actor?.id,
    adminName: actor?.username,
    action: 'SET_STATIC_IP',
    clientName: name,
    ip: actor?.ip,
    detail: `ip=${staticIp}`,
  });
  logger.info('client static IP assigned', { client: name, ip: staticIp });
  return clientsDb.findByName(name);
}

export async function revoke(rawName, actor) {
  const name = validateClientName(rawName);
  const row = clientsDb.findByName(name);
  if (!row) throw new NotFoundError('Client not found', 'CLIENT_NOT_FOUND');
  if (row.status === 'revoked' || row.status === 'archived') {
    throw new ConflictError('Client is already revoked', 'ALREADY_REVOKED');
  }

  if (row.static_ip) {
    try {
      await helper('delete-ip', [name]);
    } catch (err) {
      logger.warn('failed to delete ccd file on revoke', { client: name, err: err.message });
    }
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
  if (row.static_ip) {
    try {
      await helper('delete-ip', [name]);
    } catch (err) {
      logger.warn('failed to delete ccd file on archive', { client: name, err: err.message });
    }
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
 * Permanently delete a client: disconnect if online, revoke certificate,
 * remove PKI files and CCD file, and remove from the database.
 */
export async function deleteClient(rawName, actor) {
  const name = validateClientName(rawName);
  const row = clientsDb.findByName(name);
  if (!row) throw new NotFoundError('Client not found', 'CLIENT_NOT_FOUND');

  // 1. Disconnect if online
  try {
    await killClient(name);
  } catch (err) {
    logger.debug('killClient failed on delete', { client: name, err: err.message });
  }

  // 2. Remove PKI artefacts and CCD file via helper
  try {
    await helper('delete-client', [name]);
  } catch (err) {
    logger.warn('delete-client helper warning', { client: name, err: err.message });
  }

  // 3. Remove from database
  clientsDb.deleteByName(name);

  // 4. Record audit log
  audit.record({
    adminId: actor?.id,
    adminName: actor?.username,
    action: 'DELETE_CLIENT',
    clientName: name,
    ip: actor?.ip,
  });

  logger.info('client deleted', { client: name });
  return { name, ok: true };
}

/**
 * Extend expiration date for an active or expired client account.
 */
export async function extendClient(rawName, rawDays, actor) {
  const name = validateClientName(rawName);
  const row = clientsDb.findByName(name);
  if (!row) throw new NotFoundError('Client not found', 'CLIENT_NOT_FOUND');
  if (row.status === 'revoked' || row.status === 'archived') {
    throw new ConflictError('Cannot extend an archived or revoked client', 'CLIENT_NOT_ACTIVE');
  }

  const days = validateDays(rawDays, config.clientCertDays);

  logger.info('extending client certificate expiry', { client: name, days });
  await helper('renew', [name, String(days)]);

  const entries = await readIndex();
  const entry = entries.findLast((e) => e.name === name && e.status === 'active');
  if (!entry) {
    throw new PkiError('Certificate renewed but active entry not found in index', 'PKI_ENTRY_MISSING');
  }

  const updated = clientsDb.updateExpiry(name, {
    certificateSerial: entry.serial,
    expiresAt: entry.expiresAt,
  });

  audit.record({
    adminId: actor?.id,
    adminName: actor?.username,
    action: 'EXTEND_EXPIRY',
    clientName: name,
    ip: actor?.ip,
    detail: `days=${days} expires=${entry.expiresAt}`,
  });

  logger.info('client expiry extended', { client: name, expiresAt: entry.expiresAt });
  return updated;
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
