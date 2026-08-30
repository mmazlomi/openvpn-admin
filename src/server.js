#!/usr/bin/env node
/**
 * Entry point.
 *
 *   node src/server.js                 start the HTTP server
 *   node src/server.js create-admin    interactively create/reset an admin
 *   node src/server.js sync            import existing PKI certs into SQLite
 *   node src/server.js health          print a health summary and exit
 */
import http from 'node:http';
import config from './config.js';
import logger from './utils/logger.js';
import { getDb, closeDb } from './database.js';

const cmd = process.argv[2];

async function main() {
  switch (cmd) {
    case undefined:
    case 'start':
      return startServer();
    case 'create-admin': {
      getDb();
      const { runCreateAdminCli } = await import('./auth.js');
      await runCreateAdminCli();
      closeDb();
      return;
    }
    case 'sync': {
      getDb();
      const { sync } = await import('./services/clients.js');
      const summary = await sync({ username: 'cli' });
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      closeDb();
      return;
    }
    case 'health': {
      getDb();
      const { pkiHealthy } = await import('./services/easyrsa.js');
      const { detectServerUnit } = await import('./services/openvpn.js');
      const unit = await detectServerUnit();
      const out = { easyrsa: pkiHealthy(), openvpn: !!unit, openvpnUnit: unit, database: true };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      closeDb();
      return;
    }
    default:
      process.stderr.write(`Unknown command: ${cmd}\n`);
      process.exitCode = 1;
  }
}

function startServer() {
  getDb();
  return import('./app.js').then(({ createApp }) => {
    const app = createApp();
    const server = http.createServer(app);

    server.listen(config.port, config.host, () => {
      logger.info('server listening', {
        host: config.host,
        port: config.port,
        env: config.NODE_ENV,
      });
    });

    const shutdown = (signal) => {
      logger.info('shutting down', { signal });
      server.close(() => {
        closeDb();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });
}

main().catch((err) => {
  logger.error('fatal', { error: err.message, stack: err.stack });
  process.exitCode = 1;
});
