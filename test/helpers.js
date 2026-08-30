/**
 * Test harness: builds a throwaway environment (temp DB, temp PKI fixtures,
 * a fake privileged helper) and configures process.env BEFORE any app module
 * is imported.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ovpnadmin-test-'));

const pkiDir = path.join(tmpRoot, 'pki');
const issuedDir = path.join(pkiDir, 'issued');
const privateDir = path.join(pkiDir, 'private');
const reqsDir = path.join(pkiDir, 'reqs');
fs.mkdirSync(issuedDir, { recursive: true });
fs.mkdirSync(privateDir, { recursive: true });
fs.mkdirSync(reqsDir, { recursive: true });

// --- CA + one client cert, via openssl (present on the build host) ---
function genCert(name, cnf) {
  const keyPath = path.join(tmpRoot, `${name}.key`);
  const crtPath = path.join(tmpRoot, `${name}.crt`);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', crtPath, '-days', '3650',
    '-subj', `/CN=${cnf}`,
  ], { stdio: 'ignore' });
  return { key: fs.readFileSync(keyPath, 'utf8'), crt: fs.readFileSync(crtPath, 'utf8') };
}

export const ca = genCert('ca', 'Test CA');
export const client = genCert('client', 'alice');

fs.writeFileSync(path.join(pkiDir, 'ca.crt'), ca.crt);
fs.writeFileSync(path.join(issuedDir, 'alice.crt'), client.crt);
fs.writeFileSync(path.join(privateDir, 'alice.key'), client.key);
fs.writeFileSync(path.join(reqsDir, 'alice.req'), '-----BEGIN CERTIFICATE REQUEST-----\nx\n-----END CERTIFICATE REQUEST-----\n');

// index.txt: one active (alice), one revoked (bob)
fs.writeFileSync(
  path.join(pkiDir, 'index.txt'),
  [
    `V\t${asn1(2)}\t\tAAAA1111\tunknown\t/CN=alice`,
    `R\t${asn1(2)}\t${asn1(-1)}\tBBBB2222\tunknown\t/CN=REVOKED-bob-${'0'.repeat(32)}`,
    `V\t${asn1(3)}\t\tCCCC3333\tunknown\t/CN=server`,
    '',
  ].join('\n'),
);

function asn1(yearsFromNow) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + yearsFromNow);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// --- valid tls-crypt key fixture ---
const tlsKeyFile = path.join(tmpRoot, 'tls-crypt.key');
fs.writeFileSync(
  tlsKeyFile,
  '#\n# 2048 bit OpenVPN static key\n#\n-----BEGIN OpenVPN Static key V1-----\n' +
    Array.from({ length: 16 }, () => 'a'.repeat(32)).join('\n') +
    '\n-----END OpenVPN Static key V1-----\n',
);

// --- fake helper script ---
const helperPath = path.join(tmpRoot, 'fake-helper.sh');
fs.writeFileSync(
  helperPath,
  `#!/usr/bin/env bash
set -e
PKI="${pkiDir}"
case "$1" in
  read-ca) cat "$PKI/ca.crt" ;;
  read-ta) cat "${tlsKeyFile}" ;;
  read-cert) cat "$PKI/issued/$2.crt" ;;
  read-key) cat "$PKI/private/$2.key" ;;
  read-index) cat "$PKI/index.txt" ;;
  pki-status)
     r=0;c=0;k=0
     [ -e "$PKI/reqs/$2.req" ] && r=1
     [ -e "$PKI/issued/$2.crt" ] && c=1
     [ -e "$PKI/private/$2.key" ] && k=1
     echo "req=$r cert=$c key=$k" ;;
  crl-status) echo "mtime=$(date +%s) size=100" ;;
  build)
     cp "$PKI/issued/alice.crt" "$PKI/issued/$2.crt"
     cp "$PKI/private/alice.key" "$PKI/private/$2.key"
     echo ok ;;
  revoke) echo ok ;;
  gen-crl) echo ok ;;
  *) echo "unknown $1" >&2; exit 1 ;;
esac
`,
);
fs.chmodSync(helperPath, 0o755);

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-value-not-used-in-production-000000';
process.env.DATABASE = path.join(tmpRoot, 'test.db');
process.env.EASYRSA_DIR = tmpRoot;
process.env.PKI_DIR = pkiDir;
process.env.EASYRSA_BIN = helperPath; // pkiHealthy just checks existence
process.env.HELPER_BIN = helperPath;
process.env.HELPER_NO_SUDO = 'true';
process.env.TLS_KEY_FILE = tlsKeyFile;
process.env.TLS_MODE = 'tls-crypt';
process.env.OPENVPN_HOST = 'ppp.mmazlomi.ir';
process.env.OPENVPN_PORT = '1194';
process.env.OPENVPN_PROTOCOL = 'udp';
process.env.OPENVPN_MGMT_ENABLED = 'false';
process.env.COOKIE_SECURE = 'false';
process.env.LOG_LEVEL = 'error';

export function cleanup() {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Tiny fetch-like client against an http.Server for integration tests. */
export async function request(server, method, urlPath, { body, headers = {}, cookie } = {}) {
  const { port } = server.address();
  const h = { 'content-type': 'application/json', ...headers };
  if (cookie) h.cookie = cookie;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, json, text, setCookie, headers: res.headers };
}

export function cookieFrom(setCookie) {
  return setCookie ? setCookie.split(';')[0] : '';
}
