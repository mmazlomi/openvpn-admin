import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import {
  readCaCertificate,
  readClientCertificate,
  readClientKey,
  readTlsKey,
  resolveTlsMode,
  _internal,
} from '../src/services/certificate.js';

test('reads CA certificate as PEM', async () => {
  const pem = await readCaCertificate();
  assert.match(pem, /-----BEGIN CERTIFICATE-----/);
  assert.match(pem, /-----END CERTIFICATE-----/);
  assert.doesNotMatch(pem, /Signature Algorithm:/);
});

test('reads client certificate as PEM only', async () => {
  const pem = await readClientCertificate('alice');
  assert.match(pem, /-----BEGIN CERTIFICATE-----/);
  assert.doesNotMatch(pem, /^\s*Certificate:\s*$/m);
  assert.doesNotMatch(pem, /Issuer:/);
});

test('reads client private key as PEM', async () => {
  const pem = await readClientKey('alice');
  assert.match(pem, /-----BEGIN (RSA )?PRIVATE KEY-----/);
});

test('extraction drops an openssl -text preamble but keeps the PEM', () => {
  const withPreamble =
    'Certificate:\n    Data:\n        Version: 3 (0x2)\n        Issuer: CN=Test\n' +
    '-----BEGIN CERTIFICATE-----\nMIIBdummy\n-----END CERTIFICATE-----\n';
  const block = _internal.extractFirstCertificate(withPreamble, 'x');
  assert.match(block, /^-----BEGIN CERTIFICATE-----/);
  assert.doesNotMatch(block, /Issuer:/);
  assert.doesNotMatch(block, /Certificate:/);
});

test('rejects human-readable markers found INSIDE the PEM block', () => {
  const poisoned = '-----BEGIN CERTIFICATE-----\nIssuer: CN=x\nSignature Algorithm: foo\n-----END CERTIFICATE-----';
  assert.throws(() => _internal.extractFirstCertificate(poisoned, 'x'), /human-readable/);
});

test('missing file yields NOT_FOUND', async () => {
  await assert.rejects(() => readClientCertificate('doesnotexist'), (e) => e.code === 'CERT_NOT_FOUND');
});

test('tls key must contain the static key header and be non-empty', async () => {
  const key = await readTlsKey();
  assert.match(key, /-----BEGIN OpenVPN Static key V1-----/);
  assert.ok(key.trim().length > 50);
});

test('resolveTlsMode honours env override', () => {
  assert.equal(resolveTlsMode(), 'tls-crypt');
});
