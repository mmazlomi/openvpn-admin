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

test('static IP assignment and duplicate checking', async () => {
  const { cookie, csrf } = await loginSession();
  const H = { 'x-csrf-token': csrf };

  // 1. Create client with static IP
  const c1 = await request(server, 'POST', '/api/clients', {
    cookie,
    headers: H,
    body: { name: 'static-user1', staticIp: '10.8.0.50' },
  });
  assert.equal(c1.status, 201);
  assert.equal(c1.json.client.staticIp, '10.8.0.50');

  // 2. Reject creating another client with the duplicate IP
  const dupCreate = await request(server, 'POST', '/api/clients', {
    cookie,
    headers: H,
    body: { name: 'static-user2', staticIp: '10.8.0.50' },
  });
  assert.equal(dupCreate.status, 409);
  assert.equal(dupCreate.json.error, 'IP_DUPLICATE');

  // 3. Create second client with dynamic IP (no static IP)
  const c2 = await request(server, 'POST', '/api/clients', {
    cookie,
    headers: H,
    body: { name: 'static-user2' },
  });
  assert.equal(c2.status, 201);
  assert.equal(c2.json.client.staticIp, null);

  // 4. Reject assigning existing IP to static-user2
  const dupAssign = await request(server, 'POST', '/api/clients/static-user2/ip', {
    cookie,
    headers: H,
    body: { staticIp: '10.8.0.50' },
  });
  assert.equal(dupAssign.status, 409);
  assert.equal(dupAssign.json.error, 'IP_DUPLICATE');

  // 5. Reject invalid IP format or out-of-range IP
  const badIp = await request(server, 'POST', '/api/clients/static-user2/ip', {
    cookie,
    headers: H,
    body: { staticIp: '192.168.1.1' },
  });
  assert.equal(badIp.status, 400);

  // 5b. Reject IP in dynamic range (> 50)
  const dynamicRangeIp = await request(server, 'POST', '/api/clients/static-user2/ip', {
    cookie,
    headers: H,
    body: { staticIp: '10.8.0.51' },
  });
  assert.equal(dynamicRangeIp.status, 400);

  // 6. Assign free static IP within 2-50 to static-user2
  const assignOk = await request(server, 'POST', '/api/clients/static-user2/ip', {
    cookie,
    headers: H,
    body: { staticIp: '10.8.0.49' },
  });
  assert.equal(assignOk.status, 200);
  assert.equal(assignOk.json.client.staticIp, '10.8.0.49');

  // 7. Verify list endpoint returns static IPs
  const list = await request(server, 'GET', '/api/clients', { cookie });
  assert.equal(list.status, 200);
  const u1 = list.json.clients.find((c) => c.name === 'static-user1');
  const u2 = list.json.clients.find((c) => c.name === 'static-user2');
  assert.equal(u1.staticIp, '10.8.0.50');
  assert.equal(u2.staticIp, '10.8.0.49');

  // 8. Idempotent: assigning the same IP to the same client succeeds
  const reassignSame = await request(server, 'POST', '/api/clients/static-user2/ip', {
    cookie,
    headers: H,
    body: { staticIp: '10.8.0.49' },
  });
  assert.equal(reassignSame.status, 200);

  // 9. Unassign static IP (convert back to dynamic)
  const unassign = await request(server, 'POST', '/api/clients/static-user2/ip', {
    cookie,
    headers: H,
    body: { staticIp: '' },
  });
  assert.equal(unassign.status, 200);
  assert.equal(unassign.json.client.staticIp, null);

  // 10. Revoking static-user1 frees 10.8.0.50
  const rev = await request(server, 'POST', '/api/clients/static-user1/revoke', {
    cookie,
    headers: H,
    body: '{}',
  });
  assert.equal(rev.status, 200);

  // Now 10.8.0.50 can be assigned to static-user2 because static-user1 was revoked!
  const assignFreed = await request(server, 'POST', '/api/clients/static-user2/ip', {
    cookie,
    headers: H,
    body: { staticIp: '10.8.0.50' },
  });
  assert.equal(assignFreed.status, 200);
  assert.equal(assignFreed.json.client.staticIp, '10.8.0.50');

  // 11. Extend expiration on static-user2
  const renewRes = await request(server, 'POST', '/api/clients/static-user2/renew', {
    cookie,
    headers: H,
    body: { days: 365 },
  });
  assert.equal(renewRes.status, 200);
  assert.ok(renewRes.json.client.expiresAt);

  // 12. Cannot renew a revoked client
  const renewRevoked = await request(server, 'POST', '/api/clients/static-user1/renew', {
    cookie,
    headers: H,
    body: { days: 365 },
  });
  assert.equal(renewRevoked.status, 409);

  // 12b. Pause and resume static-user2
  const pauseRes = await request(server, 'POST', '/api/clients/static-user2/pause', {
    cookie,
    headers: H,
    body: '{}',
  });
  assert.equal(pauseRes.status, 200);
  assert.equal(pauseRes.json.client.status, 'paused');
  assert.equal(pauseRes.json.client.paused, true);

  // Cannot pause revoked client
  const pauseRevoked = await request(server, 'POST', '/api/clients/static-user1/pause', {
    cookie,
    headers: H,
    body: '{}',
  });
  assert.equal(pauseRevoked.status, 409);

  // Resume static-user2
  const resumeRes = await request(server, 'POST', '/api/clients/static-user2/resume', {
    cookie,
    headers: H,
    body: '{}',
  });
  assert.equal(resumeRes.status, 200);
  assert.equal(resumeRes.json.client.status, 'active');
  assert.equal(resumeRes.json.client.paused, false);

  // 13. Delete client static-user1 (revoked) and static-user2 (active)
  const del1 = await request(server, 'DELETE', '/api/clients/static-user1', {
    cookie,
    headers: H,
  });
  assert.equal(del1.status, 200);

  const del2 = await request(server, 'DELETE', '/api/clients/static-user2', {
    cookie,
    headers: H,
  });
  assert.equal(del2.status, 200);

  // 14. Verify they no longer exist
  const getDel = await request(server, 'GET', '/api/clients/static-user2', { cookie });
  assert.equal(getDel.status, 404);
});
