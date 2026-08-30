/**
 * Shared Express middleware: authentication guard, CSRF guard,
 * request logging and the central error handler.
 */
import { verifyCsrf } from './auth.js';
import { admins } from './database.js';
import { AppError, AuthError, ForbiddenError } from './utils/errors.js';
import logger from './utils/logger.js';

/** Real client IP (nginx sets X-Forwarded-For; app trusts one proxy hop). */
export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** True for API requests. Uses originalUrl so it works inside mounted routers
 *  (req.path is relative to the mount point). */
export function isApiRequest(req) {
  return (req.originalUrl || req.url || '').split('?')[0].startsWith('/api/');
}

/** Attach req.admin from the session, if any. */
export function loadAdmin(req, _res, next) {
  if (req.session && req.session.adminId) {
    const admin = admins.findById(req.session.adminId);
    if (admin) {
      req.admin = { id: admin.id, username: admin.username };
    } else {
      // Session references a deleted admin: drop it.
      req.session.destroy(() => {});
    }
  }
  next();
}

/** Require an authenticated admin. JSON 401 for /api, redirect for pages. */
export function requireAuth(req, res, next) {
  if (req.admin) return next();
  if (isApiRequest(req)) {
    return next(new AuthError());
  }
  return res.redirect('/login.html');
}

/** Reject state-changing requests without a valid CSRF token. */
export function requireCsrf(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!verifyCsrf(req)) {
    return next(new ForbiddenError('Invalid or missing CSRF token', 'CSRF_FAILED'));
  }
  next();
}

/** One structured log line per request. */
export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(ms),
      ip: clientIp(req),
      user: req.admin?.username,
    });
  });
  next();
}

/** 404 for unknown API routes. */
export function apiNotFound(req, res, next) {
  if (isApiRequest(req)) {
    return next(new AppError('Endpoint not found', { code: 'NOT_FOUND', status: 404 }));
  }
  next();
}

/** Central error handler. Detailed info goes to logs; clients get clean JSON. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';

  if (status >= 500) {
    logger.error('unhandled error', {
      code,
      path: req.path,
      method: req.method,
      error: err.message,
      stack: err.stack,
    });
  } else {
    logger.warn('request error', { code, path: req.path, status, error: err.message });
  }

  const body = {
    error: code,
    message:
      status >= 500 ? 'Internal server error' : err.message || 'Request failed',
  };

  if (isApiRequest(req) || req.accepts(['html', 'json']) === 'json') {
    return res.status(status).json(body);
  }
  res.status(status).type('text/plain').send(`${status} ${code}`);
}
