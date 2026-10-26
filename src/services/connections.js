/**
 * Service for tracking and querying client connection history.
 */
import { connections as connectionsDb } from '../database.js';
import { getStatus } from './openvpn.js';
import { validateClientName } from '../utils/validation.js';
import logger from '../utils/logger.js';

/**
 * Poll current OpenVPN management status and sync active/closed sessions.
 */
export async function syncConnectionHistory() {
  try {
    const status = await getStatus();
    if (!status || !status.available) return;

    const activeSessions = [];
    for (const c of status.clients || []) {
      const connTime = c.connectedSince || new Date().toISOString();
      connectionsDb.recordConnection({
        clientName: c.name,
        realAddress: c.realAddress,
        virtualIp: c.virtualAddress,
        connectedAt: connTime,
        bytesReceived: c.bytesReceived || 0,
        bytesSent: c.bytesSent || 0,
      });
      activeSessions.push({
        clientName: c.name,
        connectedAt: connTime,
      });
    }

    connectionsDb.markDisconnected(activeSessions);
  } catch (err) {
    logger.debug('syncConnectionHistory error', { err: err.message });
  }
}

/**
 * Get 10 (or configured limit) recent connections across all users.
 */
export async function getRecentConnections(limit = 10) {
  await syncConnectionHistory();
  return connectionsDb.getRecent(limit);
}

/**
 * Get connection history for a specific user, along with traffic summary.
 */
export async function getClientConnections(rawName, limit = 50) {
  const name = validateClientName(rawName);
  await syncConnectionHistory();
  const connections = connectionsDb.getForClient(name, limit);
  const summary = connectionsDb.getClientTrafficSummary(name);
  return { connections, summary };
}
