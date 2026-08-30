/**
 * Minimal structured logger. Emits one JSON object per line to stdout
 * (systemd/journald captures it). Never pass secrets as fields.
 */
import config from '../config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

// Field names that must never be logged, even if a caller passes them.
const REDACT = new Set(['password', 'passwd', 'secret', 'cookie', 'authorization', 'key', 'privateKey', 'ovpn', 'config']);

function sanitize(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACT.has(k)) {
      out[k] = '[redacted]';
    } else if (typeof v === 'string' && v.length > 512) {
      out[k] = v.slice(0, 512) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit(level, msg, meta) {
  if ((LEVELS[level] ?? 2) > threshold) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...sanitize(meta),
  });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

const logger = {
  error: (msg, meta) => emit('error', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),
};

export default logger;
