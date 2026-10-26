/**
 * Real-time HTTP, HTTPS (TLS SNI), and DNS traffic sniffer.
 * Captures outgoing web requests on the OpenVPN tun interface (tun0),
 * attributes them to specific VPN clients by source IP, and logs the last
 * visited URL / domain to SQLite.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import config from '../config.js';
import logger from '../utils/logger.js';
import { clients as clientsDb, connections as connectionsDb } from '../database.js';
import { getStatus } from './openvpn.js';

let snifferProc = null;
let snifferStopped = false;
let restartTimer = null;
let refreshTimer = null;

// Map: virtualIp (e.g. '10.8.0.3') -> clientName (e.g. 'ghaffar')
const ipToClient = new Map();

// Throttle cache: `${clientName}:${url}` -> timestamp ms
const recentUrlVisits = new Map();
const THROTTLE_WINDOW_MS = 10_000; // 10s deduplication per client+URL

/**
 * Parse TLS Server Name Indication (SNI) from ClientHello handshake packet.
 * @param {Buffer} buf - TCP payload
 * @returns {string|null} - Hostname or null
 */
export function parseTlsSni(buf) {
  if (!buf || buf.length < 44 || buf[0] !== 0x16) return null; // Record Type: Handshake
  let pos = 5; // Skip ContentType (1), Version (2), Length (2)
  if (buf[pos] !== 0x01) return null; // Handshake Type: ClientHello
  pos += 4; // Skip type (1) + 3-byte handshake length
  pos += 2 + 32; // Skip TLS Version (2) + Random (32)
  if (pos >= buf.length) return null;

  // Session ID
  const sessionIdLen = buf[pos];
  pos += 1 + sessionIdLen;
  if (pos + 2 > buf.length) return null;

  // Cipher Suites
  const cipherSuitesLen = buf.readUInt16BE(pos);
  pos += 2 + cipherSuitesLen;
  if (pos + 1 > buf.length) return null;

  // Compression Methods
  const compMethodsLen = buf[pos];
  pos += 1 + compMethodsLen;
  if (pos + 2 > buf.length) return null;

  // Extensions
  const extensionsLen = buf.readUInt16BE(pos);
  pos += 2;
  const endExt = Math.min(pos + extensionsLen, buf.length);

  while (pos + 4 <= endExt) {
    const extType = buf.readUInt16BE(pos);
    const extLen = buf.readUInt16BE(pos + 2);
    pos += 4;

    if (extType === 0) {
      // server_name extension
      if (pos + 2 <= endExt) {
        let listPos = pos + 2; // skip server_name_list length
        if (listPos + 3 <= endExt) {
          const nameType = buf[listPos];
          const nameLen = buf.readUInt16BE(listPos + 1);
          listPos += 3;
          if (nameType === 0 && listPos + nameLen <= endExt && nameLen > 0 && nameLen < 256) {
            return buf.toString('utf8', listPos, listPos + nameLen);
          }
        }
      }
    }
    pos += extLen;
  }
  return null;
}

/**
 * Parse plain HTTP request URL (Method + Path + Host header).
 * @param {Buffer} buf - TCP payload
 * @returns {string|null} - URL or null
 */
export function parseHttpUrl(buf) {
  if (!buf || buf.length < 10) return null;
  const text = buf.toString('utf8', 0, Math.min(buf.length, 1024));
  const m = text.match(/^(GET|POST|HEAD|PUT|DELETE|OPTIONS|CONNECT)\s+([^\s]+)\s+HTTP\/[0-9.]+/i);
  if (!m) return null;

  const path = m[2];
  const hostMatch = text.match(/\r\n[Hh]ost:\s*([^\r\n:]+)(?::([0-9]+))?/);
  const host = hostMatch ? hostMatch[1].trim() : null;

  if (!host) {
    return path.startsWith('http') ? path : null;
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return `http://${host}${path}`;
}

/**
 * Parse DNS query domain name from UDP port 53 packet.
 * @param {Buffer} buf - UDP payload
 * @returns {string|null} - Domain or null
 */
export function parseDnsQuery(buf) {
  if (!buf || buf.length < 12) return null;
  const flags = buf.readUInt16BE(2);
  const isQuery = (flags & 0x8000) === 0;
  if (!isQuery) return null;
  const qdcount = buf.readUInt16BE(4);
  if (qdcount === 0) return null;

  let pos = 12;
  const parts = [];
  while (pos < buf.length) {
    const len = buf[pos++];
    if (len === 0) break;
    // Check for pointer compression or invalid length
    if ((len & 0xc0) !== 0 || pos + len > buf.length || len > 63) return null;
    parts.push(buf.toString('utf8', pos, pos + len));
    pos += len;
  }
  if (!parts.length) return null;
  const domain = parts.join('.');
  if (domain.endsWith('.arpa') || domain.endsWith('.local') || domain.length > 253) return null;
  return domain;
}

/**
 * Refresh virtualIp -> clientName lookup from OpenVPN management,
 * static IP configuration, and connection history.
 */
export async function refreshIpMapping() {
  try {
    // 1. Live status from OpenVPN management interface
    const status = await getStatus().catch(() => null);
    if (status && status.clients) {
      for (const c of status.clients) {
        if (c.virtualAddress && c.name) {
          ipToClient.set(c.virtualAddress, c.name);
        }
      }
    }

    // 2. Static IPs from SQLite database
    const allClients = clientsDb.all();
    for (const c of allClients) {
      if (c.static_ip && c.name) {
        ipToClient.set(c.static_ip, c.name);
      }
    }

    // 3. Active sessions in connection history
    const openConns = connectionsDb.getRecent(50);
    for (const conn of openConns) {
      if (conn.virtualIp && conn.clientName && conn.status === 'connected') {
        if (!ipToClient.has(conn.virtualIp)) {
          ipToClient.set(conn.virtualIp, conn.clientName);
        }
      }
    }
  } catch (err) {
    logger.debug('refreshIpMapping failed', { err: err.message });
  }
}

/**
 * Handle a detected URL or domain from a VPN client IP.
 */
function handleClientUrl(srcIp, url, urlType) {
  if (!url || !srcIp) return;
  const clientName = ipToClient.get(srcIp);
  if (!clientName) {
    // Unknown IP, trigger an opportunistic mapping refresh
    refreshIpMapping();
    return;
  }

  const now = Date.now();
  const cacheKey = `${clientName}:${url}`;
  const lastSeen = recentUrlVisits.get(cacheKey);

  // If this exact URL was recorded recently, skip duplicate DB write
  if (lastSeen && now - lastSeen < THROTTLE_WINDOW_MS) {
    return;
  }
  recentUrlVisits.set(cacheKey, now);

  // Clean cache periodically
  if (recentUrlVisits.size > 1000) {
    for (const [k, v] of recentUrlVisits.entries()) {
      if (now - v > 60_000) recentUrlVisits.delete(k);
    }
  }

  const isoTs = new Date(now).toISOString();
  try {
    connectionsDb.recordClientUrl(clientName, url, urlType, isoTs);
  } catch (err) {
    logger.debug('failed to record client URL', { clientName, url, err: err.message });
  }
}

/**
 * Start the background traffic sniffer on tun0 using tcpdump and pcap stream.
 */
export function startTrafficSniffer(iface = 'tun0') {
  if (snifferProc || snifferStopped) return;

  // Check if interface exists in sysfs
  if (!fs.existsSync(`/sys/class/net/${iface}`)) {
    logger.debug(`traffic sniffer: interface ${iface} not found, retrying in 15s`);
    restartTimer = setTimeout(() => startTrafficSniffer(iface), 15_000);
    restartTimer.unref();
    return;
  }

  refreshIpMapping();
  refreshTimer = setInterval(refreshIpMapping, 10_000);
  refreshTimer.unref();

  // BPF filter:
  // Port 80 (HTTP) OR Port 443 TLS ClientHello (0x16, 0x01) OR UDP Port 53 (DNS)
  const bpfFilter =
    'tcp dst port 80 or (tcp dst port 443 and tcp[((tcp[12:1] & 0xf0) >> 2):1] = 0x16 and tcp[((tcp[12:1] & 0xf0) >> 2) + 5:1] = 0x01) or (udp dst port 53)';

  try {
    const proc = spawn(
      'tcpdump',
      ['-i', iface, '-n', '-s', '1500', '-l', '-U', '-w', '-', bpfFilter],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    snifferProc = proc;

    let pcapBuf = Buffer.alloc(0);
    let headerParsed = false;

    proc.stdout.on('data', (chunk) => {
      pcapBuf = Buffer.concat([pcapBuf, chunk]);
      if (!headerParsed) {
        if (pcapBuf.length < 24) return;
        pcapBuf = pcapBuf.subarray(24); // Skip 24-byte pcap global header
        headerParsed = true;
      }

      while (pcapBuf.length >= 16) {
        const inclLen = pcapBuf.readUInt32LE(8);
        if (pcapBuf.length < 16 + inclLen) break;

        const pkt = pcapBuf.subarray(16, 16 + inclLen);
        pcapBuf = pcapBuf.subarray(16 + inclLen);

        // Parse raw IPv4 packet (tun0 is LINKTYPE_RAW 101)
        if (pkt.length >= 20 && (pkt[0] >> 4) === 4) {
          const ihl = (pkt[0] & 0x0f) * 4;
          const proto = pkt[9];
          const srcIp = `${pkt[12]}.${pkt[13]}.${pkt[14]}.${pkt[15]}`;

          // Only process packets from VPN subnet 10.8.0.x
          if (srcIp.startsWith('10.8.0.') && srcIp !== '10.8.0.1') {
            if (proto === 6 && pkt.length >= ihl + 20) {
              // TCP
              const dstPort = pkt.readUInt16BE(ihl + 2);
              const dataOffset = ((pkt[ihl + 12] >> 4) & 0x0f) * 4;
              const payload = pkt.subarray(ihl + dataOffset);

              if (payload.length > 0) {
                if (dstPort === 443) {
                  const sni = parseTlsSni(payload);
                  if (sni) {
                    handleClientUrl(srcIp, `https://${sni}`, 'https');
                  }
                } else if (dstPort === 80) {
                  const url = parseHttpUrl(payload);
                  if (url) {
                    handleClientUrl(srcIp, url, 'http');
                  }
                }
              }
            } else if (proto === 17 && pkt.length >= ihl + 8) {
              // UDP
              const dstPort = pkt.readUInt16BE(ihl + 2);
              if (dstPort === 53) {
                const payload = pkt.subarray(ihl + 8);
                const domain = parseDnsQuery(payload);
                if (domain) {
                  handleClientUrl(srcIp, `https://${domain}`, 'dns');
                }
              }
            }
          }
        }
      }
    });

    proc.stderr.on('data', (d) => {
      const msg = d.toString('utf8');
      if (msg.includes('error') || msg.includes('Permission denied')) {
        logger.debug('traffic sniffer stderr', { msg: msg.trim() });
      }
    });

    proc.on('error', (err) => {
      logger.debug('traffic sniffer process error', { err: err.message });
      snifferProc = null;
    });

    proc.on('close', (code) => {
      snifferProc = null;
      if (!snifferStopped) {
        logger.debug('traffic sniffer exited, restarting in 5s', { code });
        restartTimer = setTimeout(() => startTrafficSniffer(iface), 5000);
        restartTimer.unref();
      }
    });

    logger.info('traffic sniffer started', { interface: iface });
  } catch (err) {
    logger.debug('failed to spawn traffic sniffer', { err: err.message });
  }
}

/**
 * Stop traffic sniffer process on application shutdown.
 */
export function stopTrafficSniffer() {
  snifferStopped = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  if (snifferProc) {
    try {
      snifferProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    snifferProc = null;
  }
}
