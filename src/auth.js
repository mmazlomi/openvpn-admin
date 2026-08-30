/**
 * Administrator authentication: password hashing (bcrypt), login/logout,
 * and the CLI `create-admin` flow.
 */
import crypto from 'node:crypto';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { admins, audit } from './database.js';
import { validateUsername, validatePassword } from './utils/validation.js';
import { AuthError } from './utils/errors.js';
import logger from './utils/logger.js';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Attempt a login. Returns the admin row on success.
 * Runs a bcrypt comparison even for unknown users to blunt timing enumeration.
 * @throws {AuthError}
 */
export async function login(username, password) {
  const admin = admins.findByUsername(String(username || '').trim());
  const hash = admin
    ? admin.password_hash
    : '$2a$12$0000000000000000000000000000000000000000000000000000o';
  const ok = await verifyPassword(String(password || ''), hash);
  if (!admin || !ok) {
    throw new AuthError('Invalid username or password', 'INVALID_CREDENTIALS');
  }
  admins.markLogin(admin.id);
  return admin;
}

export function createAdmin(username, password) {
  const u = validateUsername(username);
  validatePassword(password);
  if (admins.findByUsername(u)) {
    throw new Error(`Admin "${u}" already exists`);
  }
  return hashPassword(password).then((hash) => {
    const id = admins.create(u, hash);
    logger.info('admin created', { user: u });
    return id;
  });
}

export function setAdminPassword(username, password) {
  const u = validateUsername(username);
  validatePassword(password);
  const admin = admins.findByUsername(u);
  if (!admin) throw new Error(`Admin "${u}" not found`);
  return hashPassword(password).then((hash) => {
    admins.updatePassword(admin.id, hash);
    logger.info('admin password changed', { user: u });
  });
}

/* --------------------------- CSRF tokens -------------------------- */

export function issueCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function verifyCsrf(req) {
  const expected = req.session && req.session.csrfToken;
  const provided =
    req.get('x-csrf-token') || (req.body && req.body._csrf) || req.query._csrf;
  if (!expected || !provided) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ----------------------- interactive CLI ------------------------- */

/**
 * Prompt helper built on ONE readline interface so it works for both an
 * interactive TTY and piped stdin. `silent` suppresses the character echo.
 */
function makePrompter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: !!process.stdin.isTTY,
  });
  const origWrite = rl._writeToOutput ? rl._writeToOutput.bind(rl) : null;
  let muted = false;
  if (origWrite) {
    rl._writeToOutput = (str) => {
      if (muted) {
        if (str.includes('\n')) origWrite('\n');
        return;
      }
      origWrite(str);
    };
  }
  const ask = (question, { silent = false } = {}) =>
    new Promise((resolve) => {
      muted = false;
      rl.question(question, (answer) => {
        if (silent) process.stdout.write('\n');
        muted = false;
        resolve(answer.trim());
      });
      muted = silent;
    });
  return { ask, close: () => rl.close() };
}

export async function runCreateAdminCli() {
  const existing = admins.countAll();
  if (existing > 0) {
    process.stdout.write(`Note: ${existing} admin account(s) already exist.\n`);
  }

  // Non-interactive fallback for automated provisioning.
  let username = process.env.ADMIN_USERNAME;
  let password = process.env.ADMIN_PASSWORD;
  let confirm = password;

  if (!username || !password) {
    const { ask, close } = makePrompter();
    username = await ask('Username: ');
    password = await ask('Password: ', { silent: true });
    confirm = await ask('Confirm password: ', { silent: true });
    close();
  }

  if (password !== confirm) {
    process.stderr.write('Passwords do not match.\n');
    process.exitCode = 1;
    return;
  }
  try {
    validateUsername(username);
    validatePassword(password);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const reset = !!admins.findByUsername(username.trim());
  if (reset) {
    await setAdminPassword(username, password);
    process.stdout.write(`Password updated for "${username.trim()}".\n`);
  } else {
    await createAdmin(username, password);
    process.stdout.write(`Admin "${username.trim()}" created.\n`);
  }
  audit.record({ action: reset ? 'ADMIN_PASSWORD_RESET' : 'ADMIN_CREATED', detail: username.trim() });
}
