/**
 * Explicit error classes. Every error carries a stable machine `code`,
 * a safe `message` for the client, and an HTTP `status`. Anything else
 * (paths, stderr, stack traces) stays in the server logs only.
 */

export class AppError extends Error {
  constructor(message, { code = 'INTERNAL_ERROR', status = 500, cause } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(message, { code, status: 404 });
  }
}

export class ConflictError extends AppError {
  constructor(message, code = 'CONFLICT') {
    super(message, { code, status: 409 });
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHENTICATED') {
    super(message, { code, status: 401 });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, { code, status: 403 });
  }
}

/** Raised by the EasyRSA / PKI layer for operational failures. */
export class PkiError extends AppError {
  constructor(message, code = 'PKI_ERROR', status = 500) {
    super(message, { code, status });
  }
}
