/**
 * Central configuration. All values come from the environment.
 * Never hard-code secrets here.
 *
 * In production the environment is populated by systemd via
 * EnvironmentFile=/etc/openvpn-admin.env . For local development a .env
 * file in the project root is loaded automatically.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// systemd injects the environment via EnvironmentFile. For CLI invocations
// (create-admin, sync) load, in order of preference: a project .env, then the
// production env file. Existing process.env always wins (dotenv never
// overrides).
dotenv.config();
if (!process.env.SESSION_SECRET) {
  const prodEnv = process.env.OPENVPN_ADMIN_ENV || '/etc/openvpn-admin.env';
  if (fs.existsSync(prodEnv)) dotenv.config({ path: prodEnv });
}

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function bool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function int(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer`);
  return n;
}

const NODE_ENV = process.env.NODE_ENV || 'production';
const isProd = NODE_ENV === 'production';

const EASYRSA_DIR = required('EASYRSA_DIR', '/etc/openvpn/easy-rsa');
const PKI_DIR = required('PKI_DIR', path.join(EASYRSA_DIR, 'pki'));

const config = {
  NODE_ENV,
  isProd,

  host: process.env.HOST || '127.0.0.1',
  port: int('PORT', 8282),

  // Secret used to sign the session cookie.
  sessionSecret: required('SESSION_SECRET'),
  // Session idle lifetime in milliseconds (default 8h).
  sessionMaxAgeMs: int('SESSION_MAX_AGE_MS', 8 * 60 * 60 * 1000),
  // Set true only when the panel is served over HTTPS end-to-end OR behind a
  // trusted TLS-terminating proxy that sets X-Forwarded-Proto.
  cookieSecure: bool('COOKIE_SECURE', isProd),
  // Trust the first proxy hop (nginx) for X-Forwarded-* headers.
  trustProxy: bool('TRUST_PROXY', true),

  easyrsaDir: EASYRSA_DIR,
  pkiDir: PKI_DIR,
  easyrsaBin: process.env.EASYRSA_BIN || path.join(EASYRSA_DIR, 'easyrsa'),
  // File containing the CA private-key passphrase (EasyRSA --passin=file:...).
  // Optional: only needed when the CA key is encrypted.
  caPassFile: process.env.EASYRSA_PASS_FILE || path.join(EASYRSA_DIR, 'ca.pass'),

  // Privileged helper invoked through sudo for all PKI mutations / reads.
  helperBin: process.env.HELPER_BIN || '/opt/openvpn-admin/bin/ovpn-helper',
  sudoBin: process.env.SUDO_BIN || '/usr/bin/sudo',
  // When true the panel calls the helper directly (used when the panel itself
  // runs as root, e.g. in tests or a root deployment).
  helperNoSudo: bool('HELPER_NO_SUDO', false),

  // TLS control-channel key used for inline <tls-crypt> / <tls-auth>.
  // Defaults to the panel's own copy so the OpenVPN dir is never depended on
  // for readability. Falls back to reading via the helper if unset/!exists.
  tlsKeyFile: process.env.TLS_KEY_FILE || '/etc/openvpn-admin/tls-crypt.key',
  // 'tls-crypt' | 'tls-auth' | 'auto'. 'auto' inspects the server .conf.
  tlsMode: process.env.TLS_MODE || 'auto',
  serverConf: process.env.OPENVPN_SERVER_CONF || '/etc/openvpn/server/server.conf',

  openvpn: {
    host: required('OPENVPN_HOST', 'ppp.mmazlomi.ir'),
    port: int('OPENVPN_PORT', 1194),
    protocol: (process.env.OPENVPN_PROTOCOL || 'udp').toLowerCase(),
  },
  vpnNetwork: process.env.VPN_NETWORK || '10.8.0.0/24',

  // OpenVPN management interface for live connection status.
  mgmt: {
    host: process.env.OPENVPN_MGMT_HOST || '127.0.0.1',
    port: int('OPENVPN_MGMT_PORT', 8989),
    enabled: bool('OPENVPN_MGMT_ENABLED', true),
  },

  database: process.env.DATABASE || '/var/lib/openvpn-admin/openvpn-admin.db',

  clientCertDays: int('CLIENT_CERT_DAYS', 825),

  // Login rate limiting.
  loginRateWindowMs: int('LOGIN_RATE_WINDOW_MS', 15 * 60 * 1000),
  loginRateMax: int('LOGIN_RATE_MAX', 10),

  logLevel: process.env.LOG_LEVEL || 'info',
};

/** Resolve a path inside the PKI, guarding against traversal. */
export function pkiPath(...parts) {
  const p = path.resolve(config.pkiDir, ...parts);
  if (p !== config.pkiDir && !p.startsWith(config.pkiDir + path.sep)) {
    throw new Error('Refusing path outside PKI directory');
  }
  return p;
}

export function tlsKeyFileExists() {
  try {
    return fs.statSync(config.tlsKeyFile).size > 0;
  } catch {
    return false;
  }
}

export default config;
