/**
 * Certificate / key material handling.
 *
 * Files are read verbatim as PEM. We never run `openssl x509 -text` or any
 * transform that would turn the certificate into human-readable output —
 * the .ovpn must contain the raw base64 PEM block only.
 */
import fs from 'node:fs';
import config, { tlsKeyFileExists } from '../config.js';
import { helper } from './helper.js';
import { validateClientName } from '../utils/validation.js';
import { PkiError, NotFoundError } from '../utils/errors.js';

const CERT_BEGIN = '-----BEGIN CERTIFICATE-----';
const CERT_END = '-----END CERTIFICATE-----';
const KEY_HEADERS = [
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN EC PRIVATE KEY-----',
  '-----BEGIN ENCRYPTED PRIVATE KEY-----',
];
const STATIC_KEY_HEADER = '-----BEGIN OpenVPN Static key V1-----';

// Markers that must NOT appear — they indicate `openssl x509 -text` output.
const HUMAN_READABLE_MARKERS = [/^\s*Certificate:\s*$/m, /^\s*Data:\s*$/m, /Signature Algorithm:/, /Issuer:/, /Subject:/];

function assertPemCertificate(pem, label) {
  if (!pem || !pem.includes(CERT_BEGIN) || !pem.includes(CERT_END)) {
    throw new PkiError(`${label} is not a valid PEM certificate`, 'BAD_CERTIFICATE');
  }
}

/**
 * The extracted PEM block itself must be pure base64 — no `openssl x509 -text`
 * leakage. EasyRSA's issued/*.crt files legitimately carry a human-readable
 * preamble BEFORE the PEM, so this check only runs on the extracted block.
 */
function assertCleanPemBlock(block, label) {
  for (const re of HUMAN_READABLE_MARKERS) {
    if (re.test(block)) {
      throw new PkiError(`${label} contains human-readable output, refusing`, 'BAD_CERTIFICATE');
    }
  }
}

function assertPemPrivateKey(pem, label) {
  if (!pem || !KEY_HEADERS.some((h) => pem.includes(h))) {
    throw new PkiError(`${label} is not a valid PEM private key`, 'BAD_PRIVATE_KEY');
  }
}

/** Extract only the first PEM certificate block (drop any preamble). */
function extractFirstCertificate(pem, label = 'Certificate') {
  const start = pem.indexOf(CERT_BEGIN);
  const end = pem.indexOf(CERT_END);
  if (start === -1 || end === -1) {
    throw new PkiError('Certificate block not found', 'BAD_CERTIFICATE');
  }
  const block = pem.slice(start, end + CERT_END.length).trim() + '\n';
  assertCleanPemBlock(block, label);
  return block;
}

export async function readCaCertificate() {
  const pem = await helper('read-ca');
  assertPemCertificate(pem, 'CA certificate');
  return extractFirstCertificate(pem, 'CA certificate');
}

export async function readClientCertificate(rawName) {
  const name = validateClientName(rawName);
  let pem;
  try {
    pem = await helper('read-cert', [name]);
  } catch {
    throw new NotFoundError('Client certificate not found', 'CERT_NOT_FOUND');
  }
  assertPemCertificate(pem, 'Client certificate');
  return extractFirstCertificate(pem, 'Client certificate');
}

export async function readClientKey(rawName) {
  const name = validateClientName(rawName);
  let pem;
  try {
    pem = await helper('read-key', [name]);
  } catch {
    throw new NotFoundError('Client private key not found', 'KEY_NOT_FOUND');
  }
  assertPemPrivateKey(pem, 'Client private key');
  return pem.trim() + '\n';
}

/**
 * Read the TLS control-channel key (tls-crypt or tls-auth).
 * Prefers the panel's own copy (config.tlsKeyFile); falls back to reading
 * the OpenVPN key via the helper. REJECTS an empty / malformed key — this is
 * the bug the previous ovpn-admin shipped.
 */
export async function readTlsKey() {
  let content;
  if (tlsKeyFileExists()) {
    content = fs.readFileSync(config.tlsKeyFile, 'utf8');
  } else {
    content = await helper('read-ta');
  }
  if (!content || content.trim() === '') {
    throw new PkiError(
      'TLS control-channel key is empty — refusing to generate a broken client config',
      'TLS_KEY_EMPTY',
    );
  }
  if (!content.includes(STATIC_KEY_HEADER)) {
    throw new PkiError(
      'TLS control-channel key does not contain an OpenVPN static key header',
      'TLS_KEY_INVALID',
    );
  }
  return content.trim() + '\n';
}

/** Determine whether the server uses tls-crypt or tls-auth. */
export function resolveTlsMode() {
  if (config.tlsMode === 'tls-crypt' || config.tlsMode === 'tls-auth') {
    return config.tlsMode;
  }
  try {
    const conf = fs.readFileSync(config.serverConf, 'utf8');
    if (/^\s*tls-crypt\s+/m.test(conf)) return 'tls-crypt';
    if (/^\s*tls-auth\s+/m.test(conf)) return 'tls-auth';
  } catch {
    /* fall through */
  }
  // Safe modern default for this deployment.
  return 'tls-crypt';
}

export const _internal = {
  assertPemCertificate,
  assertPemPrivateKey,
  assertCleanPemBlock,
  extractFirstCertificate,
};
