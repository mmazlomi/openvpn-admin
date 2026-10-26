/**
 * Client management routes. All require an authenticated admin (guard is
 * applied where the router is mounted) and CSRF for state changes.
 */
import express from 'express';
import { audit, connections as connectionsDb } from '../database.js';
import {
  listClients,
  getClient,
  createClient,
  setClientIp,
  revoke,
  archive,
  deleteClient,
  extendClient,
  pauseClient,
  resumeClient,
} from '../services/clients.js';
import { generateClientConfig } from '../services/client-config.js';
import { getClientConnections } from '../services/connections.js';
import { clientIp } from '../middleware.js';

const router = express.Router();

function actor(req) {
  return { id: req.admin.id, username: req.admin.username, ip: clientIp(req) };
}

router.get('/', async (req, res, next) => {
  try {
    res.json(await listClients());
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, notes, staticIp, ip } = req.body || {};
    const row = await createClient(name, notes, staticIp !== undefined ? staticIp : ip, actor(req));
    res.status(201).json({
      ok: true,
      client: {
        name: row.name,
        status: row.status,
        certificateSerial: row.certificate_serial,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        staticIp: row.static_ip,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:name/ip', async (req, res, next) => {
  try {
    const { staticIp, ip } = req.body || {};
    const targetIp = staticIp !== undefined ? staticIp : ip;
    const row = await setClientIp(req.params.name, targetIp, actor(req));
    res.json({
      ok: true,
      client: {
        name: row.name,
        status: row.status,
        staticIp: row.static_ip,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:name', async (req, res, next) => {
  try {
    res.json({ client: await getClient(req.params.name) });
  } catch (err) {
    next(err);
  }
});

router.get('/:name/config', async (req, res, next) => {
  try {
    const client = await getClient(req.params.name);
    if (client.status !== 'active') {
      return res
        .status(409)
        .json({ error: 'CLIENT_NOT_ACTIVE', message: 'Config download is disabled for revoked/archived clients' });
    }
    const { filename, content } = await generateClientConfig(req.params.name);
    audit.record({
      adminId: req.admin.id,
      adminName: req.admin.username,
      action: 'DOWNLOAD_CONFIG',
      clientName: client.name,
      ip: clientIp(req),
    });
    res.setHeader('Content-Type', 'application/x-openvpn-profile');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(content);
  } catch (err) {
    next(err);
  }
});

router.post('/:name/revoke', async (req, res, next) => {
  try {
    const row = await revoke(req.params.name, actor(req));
    res.json({ ok: true, client: { name: row.name, status: row.status, revokedAt: row.revoked_at } });
  } catch (err) {
    next(err);
  }
});

router.post('/:name/archive', async (req, res, next) => {
  try {
    const row = await archive(req.params.name, actor(req));
    res.json({ ok: true, client: { name: row.name, status: row.status, archivedAt: row.archived_at } });
  } catch (err) {
    next(err);
  }
});

router.post('/:name/renew', async (req, res, next) => {
  try {
    const { days } = req.body || {};
    const row = await extendClient(req.params.name, days, actor(req));
    res.json({
      ok: true,
      client: {
        name: row.name,
        status: row.status,
        certificateSerial: row.certificate_serial,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        staticIp: row.static_ip,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:name/pause', async (req, res, next) => {
  try {
    const row = await pauseClient(req.params.name, actor(req));
    res.json({
      ok: true,
      client: {
        name: row.name,
        status: row.paused ? 'paused' : row.status,
        paused: !!row.paused,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:name/resume', async (req, res, next) => {
  try {
    const row = await resumeClient(req.params.name, actor(req));
    res.json({
      ok: true,
      client: {
        name: row.name,
        status: row.paused ? 'paused' : row.status,
        paused: !!row.paused,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Alias for resume
router.post('/:name/activate', async (req, res, next) => {
  try {
    const row = await resumeClient(req.params.name, actor(req));
    res.json({
      ok: true,
      client: {
        name: row.name,
        status: row.paused ? 'paused' : row.status,
        paused: !!row.paused,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:name/connections', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10) || 50;
    const { connections, summary } = await getClientConnections(req.params.name, limit);
    res.json({ client: req.params.name, connections, summary });
  } catch (err) {
    next(err);
  }
});

router.get('/:name/urls', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10) || 50;
    const client = await getClient(req.params.name);
    const urls = connectionsDb.getClientUrls(client.name, limit);
    res.json({ client: client.name, lastUrl: client.lastUrl, lastUrlTime: client.lastUrlTime, urls });
  } catch (err) {
    next(err);
  }
});

router.delete('/:name', async (req, res, next) => {
  try {
    const result = await deleteClient(req.params.name, actor(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Alias for clients that do not support DELETE methods easily
router.post('/:name/delete', async (req, res, next) => {
  try {
    const result = await deleteClient(req.params.name, actor(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
