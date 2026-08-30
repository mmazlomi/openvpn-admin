/**
 * Express application factory. Kept separate from server.js so tests can
 * import the app without binding a port.
 */
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import config from './config.js';
import SqliteSessionStore from './session-store.js';
import {
  loadAdmin,
  requireAuth,
  requireCsrf,
  requestLogger,
  apiNotFound,
  errorHandler,
} from './middleware.js';
import authRoutes from './routes/auth.js';
import clientRoutes from './routes/clients.js';
import dashboardRoutes, { publicDir } from './routes/dashboard.js';
import { healthRouter, apiRouter } from './routes/api.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.cookieSecure ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );

  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));

  app.use(
    session({
      name: 'ovpnadmin.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: new SqliteSessionStore(),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        maxAge: config.sessionMaxAgeMs,
        path: '/',
      },
    }),
  );

  app.use(requestLogger);
  app.use(loadAdmin);

  // Unauthenticated.
  app.use('/api', healthRouter);
  // Login itself is not CSRF-protected (no session yet; valid credentials +
  // SameSite=lax cookie are the anti-CSRF proof). /logout and /me enforce it
  // inside the router.
  app.use('/api/auth', authRoutes);

  // Authenticated API.
  app.use('/api/clients', requireAuth, requireCsrf, clientRoutes);
  app.use('/api', requireAuth, requireCsrf, apiRouter);

  app.use(apiNotFound);

  // HTML + static assets.
  app.use(dashboardRoutes);
  app.use(
    express.static(publicDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );

  app.use(errorHandler);
  return app;
}
