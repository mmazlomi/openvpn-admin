import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { parseIndex, parseAsn1Time } from '../src/services/easyrsa.js';
import { parseStatus3, _unitRe } from '../src/services/openvpn.js';

test('parseAsn1Time handles UTCTime and GeneralizedTime', () => {
  assert.equal(parseAsn1Time('281202064051Z'), '2028-12-02T06:40:51.000Z');
  assert.equal(parseAsn1Time('20281202064051Z'), '2028-12-02T06:40:51.000Z');
  assert.equal(parseAsn1Time(''), null);
});

test('parseIndex extracts names, serials, revoked state', () => {
  const text = [
    'V\t281202064051Z\t\t9D2F\tunknown\t/CN=maz2',
    'R\t281202061738Z\t260830062352Z\tBCFE\tunknown\t/CN=REVOKED-maz-fb78781b2fa04f1aafb33a7e530a3b6a',
    'V\t281201182402Z\t\t9A78\tunknown\t/CN=server',
    '',
  ].join('\n');
  const entries = parseIndex(text);
  const maz2 = entries.find((e) => e.name === 'maz2');
  const maz = entries.find((e) => e.name === 'maz');
  assert.equal(maz2.status, 'active');
  assert.equal(maz2.serial, '9D2F');
  assert.equal(maz.status, 'revoked');
  assert.ok(maz.revokedAt);
});

test('OpenVPN unit regex matches the daemon but not the panel', () => {
  assert.ok(_unitRe.test('openvpn-server@server.service'));
  assert.ok(_unitRe.test('openvpn@server.service'));
  assert.ok(_unitRe.test('openvpn.service'));
  assert.equal(_unitRe.test('openvpn-admin.service'), false);
  assert.equal(_unitRe.test('nginx.service'), false);
});

test('parseStatus3 extracts connected clients', () => {
  const text = [
    'TITLE\tOpenVPN 2.6',
    'HEADER\tCLIENT_LIST\tCommon Name\tReal Address',
    'CLIENT_LIST\tclient1\t46.100.50.147:57717\t10.8.0.2\t\t42628231\t39602790\t2026-08-30 00:57:24\t1788065844\tUNDEF\t5\t0\tAES-256-GCM',
    'END',
  ].join('\n');
  const { available, clients } = parseStatus3(text);
  assert.equal(available, true);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].name, 'client1');
  assert.equal(clients[0].virtualAddress, '10.8.0.2');
  assert.equal(clients[0].bytesReceived, 42628231);
});
