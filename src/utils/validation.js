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

export const IP_V4_RE = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

export function ipToInt(ip) {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

export function intToIp(int) {
  return [(int >>> 24) & 255, (int >>> 16) & 255, (int >>> 8) & 255, int & 255].join('.');
}

export function parseCidr(cidr) {
  if (typeof cidr !== 'string' || !cidr.includes('/')) {
    throw new ValidationError(`Invalid CIDR network format: ${cidr}`, 'INVALID_NETWORK');
  }
  const [ipPart, prefixStr] = cidr.trim().split('/');
  if (!IP_V4_RE.test(ipPart)) {
    throw new ValidationError(`Invalid CIDR network IP: ${ipPart}`, 'INVALID_NETWORK');
  }
  const prefix = Number.parseInt(prefixStr, 10);
  if (Number.isNaN(prefix) || prefix < 8 || prefix > 30) {
    throw new ValidationError(`Invalid CIDR prefix length (must be 8-30): ${prefixStr}`, 'INVALID_NETWORK');
  }
  const netmaskInt = prefix === 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
  const networkInt = (ipToInt(ipPart) & netmaskInt) >>> 0;
  const broadcastInt = (networkInt | (~netmaskInt >>> 0)) >>> 0;
  return {
    prefix,
    netmask: intToIp(netmaskInt),
    netmaskInt,
    network: intToIp(networkInt),
    networkInt,
    broadcast: intToIp(broadcastInt),
    broadcastInt,
    server: intToIp(networkInt + 1),
    serverInt: (networkInt + 1) >>> 0,
    minClient: intToIp(networkInt + 2),
    minClientInt: (networkInt + 2) >>> 0,
    maxClient: intToIp(broadcastInt - 1),
    maxClientInt: (broadcastInt - 1) >>> 0,
  };
}

/**
 * Validate an IPv4 address for static assignment.
 * Returns normalized string or null if empty/omitted.
 */
export function validateStaticIp(raw, networkCidr = '10.8.0.0/24', options = {}) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new ValidationError('IP address must be a string', 'INVALID_IP');
  }
  const ip = raw.trim();
  if (ip === '') return null;

  if (!IP_V4_RE.test(ip)) {
    throw new ValidationError('Invalid IPv4 address format (e.g. 10.8.0.50)', 'INVALID_IP');
  }

  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  for (const part of parts) {
    if (part < 0 || part > 255) {
      throw new ValidationError(`IP octet ${part} out of range (0-255)`, 'INVALID_IP');
    }
  }

  const parsed = parseCidr(networkCidr);
  const ipInt = ipToInt(ip);

  // Subnet match check
  if ((ipInt & parsed.netmaskInt) >>> 0 !== parsed.networkInt) {
    throw new ValidationError(
      `IP address ${ip} is outside the VPN network (${networkCidr})`,
      'IP_OUT_OF_RANGE',
    );
  }

  if (ipInt === parsed.networkInt) {
    throw new ValidationError(`IP ${ip} is the reserved network address`, 'IP_RESERVED');
  }

  if (ipInt === parsed.broadcastInt) {
    throw new ValidationError(`IP ${ip} is the reserved broadcast address`, 'IP_RESERVED');
  }

  if (ipInt === parsed.serverInt) {
    throw new ValidationError(`IP ${ip} is reserved for the VPN server gateway`, 'IP_RESERVED');
  }

  // Partitioned range check: static IPs are restricted to [minStaticIp, maxStaticIp]
  // Default: 10.8.0.2 to 10.8.0.50
  const minStaticIp = options.minIp !== undefined ? options.minIp : intToIp(parsed.networkInt + 2);
  const maxStaticIp = options.maxIp !== undefined ? options.maxIp : intToIp(parsed.networkInt + 50);

  if (minStaticIp) {
    const minStaticInt = ipToInt(minStaticIp);
    if (ipInt < minStaticInt) {
      throw new ValidationError(
        `IP ${ip} is below the minimum allowed static IP (${minStaticIp})`,
        'IP_OUT_OF_RANGE',
      );
    }
  }

  if (maxStaticIp) {
    const maxStaticInt = ipToInt(maxStaticIp);
    if (ipInt > maxStaticInt) {
      throw new ValidationError(
        `IP ${ip} is above the maximum allowed static IP (${maxStaticIp}). IPs above ${maxStaticIp} are reserved for dynamic assignment.`,
        'IP_OUT_OF_RANGE',
      );
    }
  }

  return ip;
}

/**
 * Validate duration in days for certificate renewal/extension.
 * Defaults to defaultDays (e.g. 825) if omitted/null/undefined.
 */
export function validateDays(raw, defaultDays = 825) {
  if (raw === undefined || raw === null || raw === '') {
    return defaultDays;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 3650) {
    throw new ValidationError('Renewal duration must be an integer between 1 and 3650 days', 'INVALID_DAYS');
  }
  return n;
}

