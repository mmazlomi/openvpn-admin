/**
 * Authentication routes: /api/auth/login, /logout, /me
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { login, issueCsrfToken } from '../auth.js';
import { audit } from '../database.js';
import { clientIp, requireCsrf } from '../middleware.js';
import logger from '../utils/logger.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: config.loginRateWindowMs,
  max: config.loginRateMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  handler: (req, res) => {
    logger.warn('login rate limit hit', { ip: clientIp(req) });
    res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many login attempts, try again later' });
  },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const admin = await login(username, password);

    // Prevent session fixation: new session id on privilege change.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.adminId = admin.id;
      req.session.username = admin.username;
      const csrf = issueCsrfToken(req);
      audit.record({
        adminId: admin.id,
        adminName: admin.username,
        action: 'LOGIN',
        ip: clientIp(req),
      });
      logger.info('login successful', { user: admin.username, ip: clientIp(req) });
      res.json({ ok: true, user: { username: admin.username }, csrfToken: csrf });
    });
  } catch (err) {
    if (err.status === 401) {
      logger.warn('login failed', { ip: clientIp(req), user: String(req.body?.username || '').slice(0, 64) });
      return res.status(401).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

router.post('/logout', requireCsrf, (req, res) => {
  const user = req.session?.username;
  const id = req.session?.adminId;
  if (id) {
    audit.record({ adminId: id, adminName: user, action: 'LOGOUT', ip: clientIp(req) });
    logger.info('logout', { user });
  }
  req.session.destroy(() => {
    res.clearCookie('ovpnadmin.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.admin) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Not logged in' });
  }
  res.json({
    user: { username: req.admin.username },
    csrfToken: issueCsrfToken(req),
  });
});

export default router;
