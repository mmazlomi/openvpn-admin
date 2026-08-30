/**
 * Dynamic .ovpn generation. Assembled in memory on an authenticated request
 * and streamed as an attachment — never written to a web-served directory.
 */
import config from '../config.js';
import {
  readCaCertificate,
  readClientCertificate,
  readClientKey,
  readTlsKey,
  resolveTlsMode,
} from './certificate.js';
import { validateClientName } from '../utils/validation.js';

function block(tag, body) {
  return `<${tag}>\n${body.trim()}\n</${tag}>`;
}

/**
 * Build the full .ovpn text for a client.
 * @param {string} rawName
 * @returns {Promise<{ filename: string, content: string }>}
 */
export async function generateClientConfig(rawName) {
  const name = validateClientName(rawName);
  const tlsMode = resolveTlsMode();

  const [ca, cert, key, tlsKey] = await Promise.all([
    readCaCertificate(),
    readClientCertificate(name),
    readClientKey(name),
    readTlsKey(),
  ]);

  const lines = [
    'client',
    'dev tun',
    `proto ${config.openvpn.protocol}`,
    `remote ${config.openvpn.host} ${config.openvpn.port}`,
    '',
    'resolv-retry infinite',
    'nobind',
    'persist-key',
    'persist-tun',
    '',
    'remote-cert-tls server',
    'auth SHA256',
    'data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305',
  ];

  // tls-auth is a directional shared secret and needs key-direction 1 on the
  // client. tls-crypt is non-directional and must NOT set key-direction.
  if (tlsMode === 'tls-auth') {
    lines.push('key-direction 1');
  }

  lines.push('', 'verb 3', '');
  lines.push(block('ca', ca));
  lines.push('');
  lines.push(block('cert', cert));
  lines.push('');
  lines.push(block('key', key));
  lines.push('');
  lines.push(block(tlsMode === 'tls-auth' ? 'tls-auth' : 'tls-crypt', tlsKey));
  lines.push('');

  const content = lines.join('\n');

  // Final self-check: the TLS block must not be empty.
  const tlsTag = tlsMode === 'tls-auth' ? 'tls-auth' : 'tls-crypt';
  const re = new RegExp(`<${tlsTag}>\\n([\\s\\S]*?)\\n</${tlsTag}>`);
  const inner = re.exec(content)?.[1]?.trim();
  if (!inner || !inner.includes('-----BEGIN OpenVPN Static key V1-----')) {
    throw new Error('Generated config has an empty or invalid TLS key block');
  }

  return { filename: `${name}.ovpn`, content };
}
