import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { request, cookieFrom, cleanup } from './helpers.js';
import { createApp } from '../src/app.js';
import { getDb } from '../src/database.js';
import { createAdmin } from '../src/auth.js';

const ADMIN = 'tester';
const PASS = 'correct-horse-battery-staple';

let server;

test.before(async () => {
  getDb();
  await createAdmin(ADMIN, PASS);
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
});

test.after(() => {
  server?.close();
  cleanup();
});

async function loginSession() {
  const res = await request(server, 'POST', '/api/auth/login', { body: { username: ADMIN, password: PASS } });
  assert.equal(res.status, 200);
  return { cookie: cookieFrom(res.setCookie), csrf: res.json.csrfToken };
}

test('health endpoint is public', async () => {
  const res = await request(server, 'GET', '/api/health');
  assert.ok(res.status === 200 || res.status === 503);
  assert.equal(typeof res.json.database, 'boolean');
  assert.equal(res.text.includes('/etc/'), false, 'no filesystem paths leaked');
});

test('valid login sets a session cookie', async () => {
  const res = await request(server, 'POST', '/api/auth/login', { body: { username: ADMIN, password: PASS } });
  assert.equal(res.status, 200);
  assert.match(res.setCookie, /ovpnadmin\.sid=/);
  assert.match(res.setCookie, /HttpOnly/i);
  assert.match(res.setCookie, /SameSite=Lax/i);
  assert.ok(res.json.csrfToken);
});

test('invalid login is rejected', async () => {
  const res = await request(server, 'POST', '/api/auth/login', { body: { username: ADMIN, password: 'wrong' } });
  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'INVALID_CREDENTIALS');
});

test('protected endpoint requires authentication', async () => {
  const res = await request(server, 'GET', '/api/clients');
  assert.equal(res.status, 401);
});

test('state change without CSRF token is forbidden', async () => {
  const { cookie } = await loginSession();
  const res = await request(server, 'POST', '/api/clients', { cookie, body: { name: 'nocsrf' } });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'CSRF_FAILED');
});

test('create → list → download → revoke lifecycle', async () => {
  const { cookie, csrf } = await loginSession();
  const H = { 'x-csrf-token': csrf };

  // sync first (imports alice active, bob revoked from fixture index.txt)
  const sync = await request(server, 'POST', '/api/sync', { cookie, headers: H, body: '{}' });
  assert.equal(sync.status, 200);
  assert.ok(sync.json.summary.discovered >= 2);

  // create
  const create = await request(server, 'POST', '/api/clients', { cookie, headers: H, body: { name: 'charlie' } });
  assert.equal(create.status, 201);
  assert.equal(create.json.client.name, 'charlie');

  // duplicate rejected
  const dup = await request(server, 'POST', '/api/clients', { cookie, headers: H, body: { name: 'charlie' } });
  assert.equal(dup.status, 409);

  // list
  const list = await request(server, 'GET', '/api/clients', { cookie });
  assert.equal(list.status, 200);
  const names = list.json.clients.map((c) => c.name);
  assert.ok(names.includes('charlie'));
  assert.ok(names.includes('alice'));

  // download config
  const cfg = await request(server, 'GET', '/api/clients/charlie/config', { cookie });
  assert.equal(cfg.status, 200);
  assert.match(cfg.headers.get('content-disposition') || '', /attachment; filename="charlie\.ovpn"/);
  assert.match(cfg.text, /<tls-crypt>/);
  assert.match(cfg.text, /-----BEGIN OpenVPN Static key V1-----/);

  // revoke
  const rev = await request(server, 'POST', '/api/clients/charlie/revoke', { cookie, headers: H, body: '{}' });
  assert.equal(rev.status, 200);
  assert.equal(rev.json.client.status, 'revoked');

  // download now refused
  const cfg2 = await request(server, 'GET', '/api/clients/charlie/config', { cookie });
  assert.equal(cfg2.status, 409);

  // audit log recorded the actions
  const audit = await request(server, 'GET', '/api/audit', { cookie });
  const actions = audit.json.entries.map((e) => e.action);
  assert.ok(actions.includes('CREATE_CLIENT'));
  assert.ok(actions.includes('REVOKE_CLIENT'));
  assert.ok(actions.includes('DOWNLOAD_CONFIG'));
  assert.ok(actions.includes('LOGIN'));
});

test('shell-injection style names are rejected by the API', async () => {
  const { cookie, csrf } = await loginSession();
  for (const name of ['a;id', 'a b', '../x', 'a$(id)', 'a`id`']) {
    const res = await request(server, 'POST', '/api/clients', {
      cookie,
      headers: { 'x-csrf-token': csrf },
      body: { name },
    });
    assert.equal(res.status, 400, `expected 400 for ${name}`);
  }
});

test('logout clears the session', async () => {
  const { cookie, csrf } = await loginSession();
  const out = await request(server, 'POST', '/api/auth/logout', { cookie, headers: { 'x-csrf-token': csrf }, body: '{}' });
  assert.equal(out.status, 200);
  const after = await request(server, 'GET', '/api/clients', { cookie });
  assert.equal(after.status, 401);
});
