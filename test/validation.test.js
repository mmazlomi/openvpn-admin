import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClientName, isValidClientName, validatePassword } from '../src/utils/validation.js';

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
