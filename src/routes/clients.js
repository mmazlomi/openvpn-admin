/**
 * Client management routes. All require an authenticated admin (guard is
 * applied where the router is mounted) and CSRF for state changes.
 */
import express from 'express';
import { audit } from '../database.js';
import {
  listClients,
  getClient,
  createClient,
  revoke,
  archive,
} from '../services/clients.js';
import { generateClientConfig } from '../services/client-config.js';
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
    const { name, notes } = req.body || {};
    const row = await createClient(name, notes, actor(req));
    res.status(201).json({
      ok: true,
      client: {
        name: row.name,
        status: row.status,
        certificateSerial: row.certificate_serial,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
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

export default router;
