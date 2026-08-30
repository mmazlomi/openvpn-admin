/**
 * Input validation helpers. The client-name rules are security-critical:
 * the name becomes an EasyRSA X509 CommonName, several filesystem paths
 * (pki/issued/<name>.crt, pki/private/<name>.key, pki/reqs/<name>.req) and
 * an argv element passed to the privileged helper.
 */

// Only ASCII letters, digits, underscore and hyphen. No dot, no slash,
// no whitespace, no shell metacharacters. 1..64 characters.
export const CLIENT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// Reserved names that must never be issued/managed as clients.
const RESERVED = new Set(['ca', 'server', 'ta', 'dh', 'crl']);

export class ValidationError extends Error {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.status = 400;
  }
}

/**
 * Validate and normalise a client name. Returns the name unchanged on success.
 * @throws {ValidationError}
 */
export function validateClientName(raw) {
  if (typeof raw !== 'string') {
    throw new ValidationError('Client name is required', 'INVALID_CLIENT_NAME');
  }
  const name = raw.trim();
  if (name.length === 0) {
    throw new ValidationError('Client name is required', 'INVALID_CLIENT_NAME');
  }
  if (name.length > 64) {
    throw new ValidationError('Client name must be at most 64 characters', 'INVALID_CLIENT_NAME');
  }
  if (!CLIENT_NAME_RE.test(name)) {
    throw new ValidationError(
      'Client name may only contain letters, digits, underscore and hyphen',
      'INVALID_CLIENT_NAME',
    );
  }
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new ValidationError('Client name contains an illegal path character', 'INVALID_CLIENT_NAME');
  }
  if (RESERVED.has(name.toLowerCase())) {
    throw new ValidationError(`"${name}" is a reserved name`, 'RESERVED_CLIENT_NAME');
  }
  return name;
}

export function isValidClientName(raw) {
  try {
    validateClientName(raw);
    return true;
  } catch {
    return false;
  }
}

/** Validate a username for the admin account. */
export function validateUsername(raw) {
  if (typeof raw !== 'string') throw new ValidationError('Username is required', 'INVALID_USERNAME');
  const name = raw.trim();
  if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(name)) {
    throw new ValidationError('Username must be 2-64 chars of [a-zA-Z0-9_.-]', 'INVALID_USERNAME');
  }
  return name;
}

/** Minimum password policy for admin accounts. */
export function validatePassword(raw) {
  if (typeof raw !== 'string' || raw.length < 12) {
    throw new ValidationError('Password must be at least 12 characters', 'WEAK_PASSWORD');
  }
  if (raw.length > 1024) {
    throw new ValidationError('Password is too long', 'WEAK_PASSWORD');
  }
  return raw;
}

/** Optional free-text notes field. */
export function validateNotes(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new ValidationError('Notes must be text', 'INVALID_NOTES');
  const notes = raw.trim();
  if (notes.length > 500) throw new ValidationError('Notes must be at most 500 characters', 'INVALID_NOTES');
  return notes || null;
}
