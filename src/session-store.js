/**
 * express-session store backed by the application's SQLite database.
 * Keeps one dependency-free store instead of pulling connect-* packages.
 */
import session from 'express-session';
import { getDb } from './database.js';
import logger from './utils/logger.js';

const Store = session.Store;

export default class SqliteSessionStore extends Store {
  constructor() {
    super();
    this.db = getDb();
    // Opportunistic cleanup of expired rows.
    this._sweep();
    this._timer = setInterval(() => this._sweep(), 10 * 60 * 1000);
    this._timer.unref?.();
  }

  _sweep() {
    try {
      this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    } catch (err) {
      logger.warn('session sweep failed', { error: err.message });
    }
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at < Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.data));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 8 * 60 * 60 * 1000;
      const expires = Date.now() + maxAge;
      this.db
        .prepare(
          `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
        )
        .run(sid, JSON.stringify(sess), expires);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 8 * 60 * 60 * 1000;
      this.db
        .prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?')
        .run(Date.now() + maxAge, sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  clearAll() {
    this.db.prepare('DELETE FROM sessions').run();
  }
}
