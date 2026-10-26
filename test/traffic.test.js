import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { parseTlsSni, parseHttpUrl, parseDnsQuery } from '../src/services/trafficSniffer.js';
import { connections, clients, getDb } from '../src/database.js';

test('parseHttpUrl parses standard GET / POST requests with Host header', () => {
  const req1 = Buffer.from(
    'GET /api/v1/users?page=2 HTTP/1.1\r\nHost: example.com:8080\r\nUser-Agent: curl\r\n\r\n',
  );
  assert.equal(parseHttpUrl(req1), 'http://example.com/api/v1/users?page=2');

  const req2 = Buffer.from(
    'POST /submit HTTP/1.1\r\nHost: test.org\r\nContent-Length: 0\r\n\r\n',
  );
  assert.equal(parseHttpUrl(req2), 'http://test.org/submit');

  const proxyReq = Buffer.from(
    'GET http://other.com/index.html HTTP/1.1\r\nHost: other.com\r\n\r\n',
  );
  assert.equal(parseHttpUrl(proxyReq), 'http://other.com/index.html');

  assert.equal(parseHttpUrl(Buffer.from('not http payload')), null);
});

test('parseTlsSni extracts Server Name Indication from TLS ClientHello', () => {
  // Construct a valid TLS 1.2 / 1.3 ClientHello record with SNI
  const hostname = 'secure.example.com';
  const sniBuf = Buffer.from(hostname, 'utf8');

  const tlsPkt = Buffer.alloc(150);
  tlsPkt[0] = 0x16; // Handshake
  tlsPkt[1] = 0x03; tlsPkt[2] = 0x01; // Version TLS 1.0 in record header
  tlsPkt[5] = 0x01; // Handshake type: ClientHello

  let pos = 9 + 34; // skip record header + handshake header + version + 32-byte random
  tlsPkt[pos++] = 0; // Session ID length = 0
  tlsPkt.writeUInt16BE(2, pos); pos += 2; // Cipher suites length = 2
  tlsPkt.writeUInt16BE(0x1301, pos); pos += 2; // AES-128-GCM-SHA256
  tlsPkt[pos++] = 1; tlsPkt[pos++] = 0; // Compression methods length = 1, method = 0 (null)

  const extLenPos = pos; pos += 2; // Total extensions length position
  // Extension: server_name (0x0000)
  tlsPkt.writeUInt16BE(0, pos); pos += 2; // extType = 0
  const sniExtDataLen = 2 + 1 + 2 + sniBuf.length;
  tlsPkt.writeUInt16BE(sniExtDataLen, pos); pos += 2; // extLen
  tlsPkt.writeUInt16BE(sniExtDataLen - 2, pos); pos += 2; // server_name_list length
  tlsPkt[pos++] = 0; // host_name type 0
  tlsPkt.writeUInt16BE(sniBuf.length, pos); pos += 2; // name length
  sniBuf.copy(tlsPkt, pos); pos += sniBuf.length;

  tlsPkt.writeUInt16BE(pos - extLenPos - 2, extLenPos); // fill extensions length
  tlsPkt.writeUInt16BE(pos - 5, 3); // fill TLS record length

  const sni = parseTlsSni(tlsPkt.subarray(0, pos));
  assert.equal(sni, hostname);

  assert.equal(parseTlsSni(Buffer.from('random data')), null);
});

test('parseDnsQuery extracts query domain name from DNS question', () => {
  // DNS query for "api.google.com"
  const dnsPkt = Buffer.alloc(40);
  dnsPkt.writeUInt16BE(0x1234, 0); // Transaction ID
  dnsPkt.writeUInt16BE(0x0100, 2); // Standard query flags
  dnsPkt.writeUInt16BE(1, 4); // Questions count = 1

  let pos = 12;
  // \x03api\x06google\x03com\x00
  dnsPkt[pos++] = 3; dnsPkt.write('api', pos); pos += 3;
  dnsPkt[pos++] = 6; dnsPkt.write('google', pos); pos += 6;
  dnsPkt[pos++] = 3; dnsPkt.write('com', pos); pos += 3;
  dnsPkt[pos++] = 0; // Null terminator
  dnsPkt.writeUInt16BE(1, pos); pos += 2; // Type A
  dnsPkt.writeUInt16BE(1, pos); pos += 2; // Class IN

  const domain = parseDnsQuery(dnsPkt);
  assert.equal(domain, 'api.google.com');

  assert.equal(parseDnsQuery(Buffer.from('short')), null);
});

test('client URL recording and history querying in SQLite', () => {
  getDb();
  const testClient = 'test-url-client-' + Date.now();
  clients.create({ name: testClient });

  connections.recordClientUrl(testClient, 'https://github.com', 'https');
  connections.recordClientUrl(testClient, 'http://example.com/test', 'http');

  const history = connections.getClientUrls(testClient, 10);
  assert.equal(history.length, 2);
  assert.equal(history[0].url, 'http://example.com/test');
  assert.equal(history[0].urlType, 'http');
  assert.equal(history[1].url, 'https://github.com');
  assert.equal(history[1].urlType, 'https');

  const clientRow = clients.findByName(testClient);
  assert.equal(clientRow.last_url, 'http://example.com/test');
  assert.ok(clientRow.last_url_time);

  // Clean up
  clients.deleteByName(testClient);
  assert.equal(connections.getClientUrls(testClient, 10).length, 0);
});
