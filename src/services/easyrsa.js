/**
 * EasyRSA integration. All actual `easyrsa` execution happens inside the
 * privileged helper; this module orchestrates validation, PKI-state checks
 * and the ordering required for a safe client lifecycle.
 */
import fs from 'node:fs';
import config, { pkiPath } from '../config.js';
import { helper } from './helper.js';
import { validateClientName } from '../utils/validation.js';
import { ConflictError, PkiError, NotFoundError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/** Raw parse of pki/index.txt (obtained via the helper). */
export async function readIndex() {
  const text = await helper('read-index');
  return parseIndex(text);
}

export function parseIndex(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 6) continue;
    const [flag, expiryRaw, revokeRaw, serial, , subject] = parts;
    const cnMatch = /\/CN=([^/]+)/.exec(subject);
    if (!cnMatch) continue;
    let cn = cnMatch[1];
    let revoked = flag === 'R';
    // EasyRSA 3.2 renames revoked entries to REVOKED-<name>-<32 hex>.
    const revMatch = /^REVOKED-(.+)-[0-9a-f]{32}$/.exec(cn);
    if (revMatch) {
      cn = revMatch[1];
      revoked = true;
    }
    entries.push({
      name: cn,
      serial,
      status: revoked ? 'revoked' : 'active',
      expiresAt: parseAsn1Time(expiryRaw),
      revokedAt: revoked ? parseAsn1Time(revokeRaw) : null,
    });
  }
  return entries;
}

/** Parse ASN.1 UTCTime (YYMMDDHHMMSSZ) or GeneralizedTime to ISO string. */
export function parseAsn1Time(raw) {
  if (!raw) return null;
  const s = raw.trim();
  let m;
  if ((m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s))) {
    const yy = Number(m[1]);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    return isoUTC(year, m[2], m[3], m[4], m[5], m[6]);
  }
  if ((m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s))) {
    return isoUTC(m[1], m[2], m[3], m[4], m[5], m[6]);
  }
  return null;
}

function isoUTC(y, mo, d, h, mi, s) {
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
}

/** Presence of req/cert/key on disk for a name (via helper). */
export async function pkiStatus(name) {
  const out = await helper('pki-status', [name]);
  const flag = (k) => new RegExp(`${k}=(\\d)`).exec(out)?.[1] === '1';
  return { req: flag('req'), cert: flag('cert'), key: flag('key') };
}

export async function crlStatus() {
  const out = await helper('crl-status');
  const mtime = Number(/mtime=(\d+)/.exec(out)?.[1] || 0);
  const size = Number(/size=(\d+)/.exec(out)?.[1] || 0);
  return { mtime, size, exists: size > 0 };
}

/**
 * Create a client certificate. Performs the full ordered safety sequence.
 * @param {string} rawName
 * @param {(name:string)=>boolean} existsInDb  callback: is the name already a DB row?
 * @returns {Promise<{name:string, serial:string|null, expiresAt:string|null}>}
 */
export async function buildClient(rawName, existsInDb) {
  const name = validateClientName(rawName);

  // 2. Check database.
  if (existsInDb(name)) {
    throw new ConflictError('Client already exists', 'CLIENT_ALREADY_EXISTS');
  }

  // 3 + 4. Check PKI state / existing request or certificate.
  const state = await pkiStatus(name);
  if (state.cert) {
    throw new ConflictError(
      'A certificate for this name already exists in the PKI but not in the database. Run "sync" or choose another name.',
      'PKI_CERT_EXISTS',
    );
  }
  if (state.req) {
    // 5. Refuse rather than blindly overwrite an orphaned request.
    throw new ConflictError(
      `A certificate request pki/reqs/${name}.req already exists but this client is not tracked. ` +
        'Resolve the conflict manually (inspect or remove the stale request) before reusing this name.',
      'PKI_REQ_EXISTS',
    );
  }

  // 6. Execute EasyRSA safely (inside the helper).
  logger.info('building client certificate', { client: name });
  await helper('build', [name], { timeout: 180_000 });

  // 7 + 8. Verify artefacts exist.
  const after = await pkiStatus(name);
  if (!after.cert || !after.key) {
    throw new PkiError('EasyRSA reported success but certificate/key are missing', 'PKI_ARTIFACT_MISSING');
  }

  // Pull serial + expiry from the freshly updated index.
  const entry = (await readIndex()).find((e) => e.name === name && e.status === 'active');
  return {
    name,
    serial: entry?.serial ?? null,
    expiresAt: entry?.expiresAt ?? null,
  };
}

/**
 * Revoke a client and regenerate the CRL.
 * @returns {Promise<{revokedAt:string|null, crl:{mtime:number,size:number,exists:boolean}}>}
 */
export async function revokeClient(rawName) {
  const name = validateClientName(rawName);

  const state = await pkiStatus(name);
  if (!state.cert) {
    throw new NotFoundError('No issued certificate for this client', 'CERT_NOT_FOUND');
  }

  const before = await crlStatus();
  logger.info('revoking client certificate', { client: name });
  await helper('revoke', [name], { timeout: 120_000 });

  const after = await crlStatus();
  if (!after.exists || after.mtime < before.mtime) {
    throw new PkiError('Revocation ran but the CRL was not regenerated', 'CRL_NOT_UPDATED');
  }

  const entry = (await readIndex()).find((e) => e.name === name);
  return { revokedAt: entry?.revokedAt ?? new Date().toISOString(), crl: after };
}

/** Sanity check that the PKI is usable at all. */
export function pkiHealthy() {
  try {
    return (
      fs.existsSync(config.easyrsaBin) &&
      fs.existsSync(pkiPath('ca.crt')) &&
      fs.existsSync(pkiPath('index.txt'))
    );
  } catch {
    return false;
  }
}
