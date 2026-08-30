/**
 * Thin wrapper around the privileged `ovpn-helper` script.
 * Uses execFile with an argument array — user input is never interpolated
 * into a shell string.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../config.js';
import { PkiError } from '../utils/errors.js';
import logger from '../utils/logger.js';

const execFileP = promisify(execFile);

/**
 * @param {string} sub  helper sub-command (build, revoke, read-cert, ...)
 * @param {string[]} args  additional argv (already validated by the caller)
 * @param {object} [opts]
 * @returns {Promise<string>} stdout
 */
export async function helper(sub, args = [], opts = {}) {
  const argv = config.helperNoSudo
    ? [config.helperBin, sub, ...args]
    : [config.sudoBin, '-n', config.helperBin, sub, ...args];
  const bin = config.helperNoSudo ? config.helperBin : config.sudoBin;

  try {
    const { stdout } = await execFileP(bin, argv.slice(1), {
      timeout: opts.timeout ?? 120_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' },
    });
    return stdout;
  } catch (err) {
    // stderr may contain EasyRSA/OpenSSL detail — log it, never return it raw.
    logger.error('helper invocation failed', {
      sub,
      argc: args.length,
      code: err.code,
      signal: err.signal,
      stderr: (err.stderr || '').toString().slice(0, 2000),
    });
    if (err.code === 'ENOENT') {
      throw new PkiError('Privileged helper is not installed or not executable', 'HELPER_MISSING');
    }
    const stderr = (err.stderr || '').toString();
    if (/invalid client name|reserved name/.test(stderr)) {
      throw new PkiError('Invalid client name', 'INVALID_CLIENT_NAME', 400);
    }
    if (/certificate already exists/.test(stderr)) {
      throw new PkiError('A certificate with this name already exists', 'CERT_EXISTS', 409);
    }
    if (/sudo:/.test(stderr) || /a password is required/.test(stderr)) {
      throw new PkiError('Privileged helper is not authorised (check sudoers)', 'HELPER_FORBIDDEN');
    }
    throw new PkiError('PKI operation failed', 'PKI_OP_FAILED');
  }
}
