import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { generateClientConfig } from '../src/services/client-config.js';

test('generates a valid .ovpn', async () => {
  const { filename, content } = await generateClientConfig('alice');
  assert.equal(filename, 'alice.ovpn');

  for (const needle of [
    'client',
    'dev tun',
    'proto udp',
    'remote ppp.mmazlomi.ir 1194',
    'resolv-retry infinite',
    'nobind',
    'persist-key',
    'persist-tun',
    'remote-cert-tls server',
    '<ca>',
    '<cert>',
    '<key>',
  ]) {
    assert.ok(content.includes(needle), `missing: ${needle}`);
  }
});

test('tls-crypt mode: <tls-crypt> block present and non-empty, no key-direction', async () => {
  const { content } = await generateClientConfig('alice');
  assert.ok(content.includes('<tls-crypt>'));
  assert.doesNotMatch(content, /key-direction/);
  const inner = /<tls-crypt>\n([\s\S]*?)\n<\/tls-crypt>/.exec(content)[1].trim();
  assert.ok(inner.length > 0, '<tls-crypt> must not be empty');
  assert.match(inner, /-----BEGIN OpenVPN Static key V1-----/);
});

test('<cert> block contains only PEM certificate data', async () => {
  const { content } = await generateClientConfig('alice');
  const inner = /<cert>\n([\s\S]*?)\n<\/cert>/.exec(content)[1];
  assert.match(inner, /-----BEGIN CERTIFICATE-----/);
  assert.doesNotMatch(inner, /Certificate:/);
  assert.doesNotMatch(inner, /Issuer:/);
  assert.doesNotMatch(inner, /Subject:/);
});

test('<key> block contains a private key', async () => {
  const { content } = await generateClientConfig('alice');
  const inner = /<key>\n([\s\S]*?)\n<\/key>/.exec(content)[1];
  assert.match(inner, /-----BEGIN (RSA )?PRIVATE KEY-----/);
});

test('rejects an invalid client name before touching the PKI', async () => {
  await assert.rejects(() => generateClientConfig('../../etc/passwd'));
  await assert.rejects(() => generateClientConfig('a b'));
});
