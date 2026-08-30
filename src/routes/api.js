/**
 * Misc API routes: health, sync, audit log, server status.
 */
import express from 'express';
import config from '../config.js';
import { getDb, audit as auditDb } from '../database.js';
import { pkiHealthy } from '../services/easyrsa.js';
import { getStatus, detectServerUnit } from '../services/openvpn.js';
import { sync } from '../services/clients.js';
import { clientIp } from '../middleware.js';

export const healthRouter = express.Router();

// Unauthenticated, minimal — no filesystem detail leaked.
healthRouter.get('/health', async (_req, res) => {
  let database = false;
  try {
    getDb().prepare('SELECT 1').get();
    database = true;
  } catch {
    database = false;
  }
  const easyrsa = pkiHealthy();
  let openvpn = false;
  try {
    openvpn = !!(await detectServerUnit());
  } catch {
    openvpn = false;
  }
  const ok = database && easyrsa;
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', openvpn, easyrsa, database });
});

// Authenticated portion (guard applied at mount).
export const apiRouter = express.Router();

apiRouter.get('/status', async (_req, res, next) => {
  try {
    const [status, unit] = await Promise.all([getStatus(), detectServerUnit()]);
    res.json({
      server: {
        unit,
        running: !!unit,
        host: config.openvpn.host,
        port: config.openvpn.port,
        protocol: config.openvpn.protocol,
        network: config.vpnNetwork,
      },
      management: { available: status.available },
      onlineCount: status.clients.length,
      online: status.clients.map((c) => ({
        name: c.name,
        virtualAddress: c.virtualAddress,
        realAddress: c.realAddress,
        connectedSince: c.connectedSince,
        bytesReceived: c.bytesReceived,
        bytesSent: c.bytesSent,
      })),
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/sync', async (req, res, next) => {
  try {
    const summary = await sync({ id: req.admin.id, username: req.admin.username, ip: clientIp(req) });
    res.json({ ok: true, summary });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/audit', (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10) || 100;
  res.json({
    entries: auditDb.recent(limit).map((e) => ({
      id: e.id,
      admin: e.admin_name,
      action: e.action,
      client: e.client_name,
      ip: e.ip_address,
      detail: e.detail,
      at: e.created_at,
    })),
  });
});
