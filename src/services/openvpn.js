/**
 * Live OpenVPN status via the management interface (read-only).
 * Opens a short-lived TCP connection, issues `status 3`, parses, disconnects.
 * The management socket only accepts one client at a time, so we never hold
 * it open.
 */
import net from 'node:net';
import { execFile } from 'node:child_process';
import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * @returns {Promise<{ available: boolean, clients: Array, since?: string }>}
 */
export function getStatus() {
  if (!config.mgmt.enabled) return Promise.resolve({ available: false, clients: [] });

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.mgmt.host, port: config.mgmt.port });
    let buf = '';
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(3000);
    socket.on('timeout', () => finish({ available: false, clients: [] }));
    socket.on('error', (err) => {
      logger.debug('mgmt connection failed', { error: err.message });
      finish({ available: false, clients: [] });
    });

    socket.on('connect', () => {
      socket.write('status 3\n');
    });

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (buf.includes('\nEND\r\n') || buf.includes('\nEND\n')) {
        socket.write('quit\n');
        finish(parseStatus3(buf));
      }
    });

    socket.on('close', () => finish(parseStatus3(buf)));
  });
}

export function parseStatus3(text) {
  const clients = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.split('\t');
    if (f[0] !== 'CLIENT_LIST') continue;
    // CLIENT_LIST, CN, Real Address, Virtual Address, Virtual IPv6,
    // Bytes Received, Bytes Sent, Connected Since, Connected Since (t), Username, ...
    clients.push({
      name: f[1],
      realAddress: f[2],
      virtualAddress: f[3],
      bytesReceived: Number(f[5]) || 0,
      bytesSent: Number(f[6]) || 0,
      connectedSince: f[7] || null,
      connectedSinceEpoch: Number(f[8]) || null,
    });
  }
  return { available: true, clients };
}

// Matches the OpenVPN daemon units — openvpn-server@<x>.service,
// openvpn-client@<x>.service, openvpn@<x>.service, openvpn.service — but NOT
// this panel's own openvpn-admin.service.
const OPENVPN_UNIT_RE = /^openvpn(-server|-client)?(@[^.\s]+)?\.service$/;

/** Detect the systemd unit name of the running OpenVPN server. */
export function detectServerUnit() {
  return new Promise((resolve) => {
    execFile(
      'systemctl',
      ['list-units', '--type=service', '--state=running', '--no-legend', '--plain'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const units = stdout
          .split('\n')
          .map((l) => l.trim().split(/\s+/)[0])
          .filter((u) => OPENVPN_UNIT_RE.test(u));
        // Prefer a server@ instance over a bare/legacy unit.
        resolve(units.find((u) => u.startsWith('openvpn-server@')) || units[0] || null);
      },
    );
  });
}

export function isServerRunning() {
  return detectServerUnit().then((u) => !!u);
}

export const _unitRe = OPENVPN_UNIT_RE;
