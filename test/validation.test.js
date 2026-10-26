import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateClientName,
  isValidClientName,
  validatePassword,
  validateStaticIp,
  parseCidr,
} from '../src/utils/validation.js';

test('valid client names', () => {
  for (const n of ['maz1', 'test-client', 'a_b-C9', 'x'.repeat(64)]) {
    assert.equal(validateClientName(n), n);
  }
});

test('rejects invalid / dangerous client names', () => {
  const bad = [
    '', ' ', 'a b', 'a/b', '../etc/passwd', 'a.b', 'a;rm -rf /', 'a$(id)', 'a`id`',
    'a|b', 'a&b', 'a\\b', 'a\nb', 'x'.repeat(65), 'صاد', 'ca', 'server',
  ];
  for (const n of bad) {
    assert.equal(isValidClientName(n), false, `should reject: ${JSON.stringify(n)}`);
  }
});

test('path traversal is rejected', () => {
  assert.throws(() => validateClientName('../../root'));
  assert.throws(() => validateClientName('..'));
  assert.throws(() => validateClientName('foo/bar'));
});

test('password policy', () => {
  assert.throws(() => validatePassword('short'));
  assert.equal(validatePassword('a-long-enough-password'), 'a-long-enough-password');
});

test('CIDR parsing and netmask calculation', () => {
  const res = parseCidr('10.8.0.0/24');
  assert.equal(res.netmask, '255.255.255.0');
  assert.equal(res.network, '10.8.0.0');
  assert.equal(res.broadcast, '10.8.0.255');
  assert.equal(res.server, '10.8.0.1');
  assert.equal(res.minClient, '10.8.0.2');
  assert.equal(res.maxClient, '10.8.0.254');
});

test('valid static IPs within subnet', () => {
  assert.equal(validateStaticIp('10.8.0.2', '10.8.0.0/24'), '10.8.0.2');
  assert.equal(validateStaticIp('10.8.0.50', '10.8.0.0/24'), '10.8.0.50');
  assert.equal(validateStaticIp('10.8.0.254', '10.8.0.0/24'), '10.8.0.254');
  assert.equal(validateStaticIp('  10.8.0.100  ', '10.8.0.0/24'), '10.8.0.100');
  assert.equal(validateStaticIp(null, '10.8.0.0/24'), null);
  assert.equal(validateStaticIp('', '10.8.0.0/24'), null);
  assert.equal(validateStaticIp(undefined, '10.8.0.0/24'), null);
});

test('rejects invalid or reserved static IPs', () => {
  // invalid format
  assert.throws(() => validateStaticIp('invalid', '10.8.0.0/24'));
  assert.throws(() => validateStaticIp('10.8.0.999', '10.8.0.0/24'));
  assert.throws(() => validateStaticIp('10.8.0.01', '10.8.0.0/24')); // leading zero
  assert.throws(() => validateStaticIp('10.8.0', '10.8.0.0/24'));
  assert.throws(() => validateStaticIp('10.8.0.1.2', '10.8.0.0/24'));

  // outside subnet
  assert.throws(() => validateStaticIp('192.168.1.1', '10.8.0.0/24'));
  assert.throws(() => validateStaticIp('10.8.1.5', '10.8.0.0/24'));

  // reserved IPs
  assert.throws(() => validateStaticIp('10.8.0.0', '10.8.0.0/24')); // network
  assert.throws(() => validateStaticIp('10.8.0.1', '10.8.0.0/24')); // server gateway
  assert.throws(() => validateStaticIp('10.8.0.255', '10.8.0.0/24')); // broadcast
});
