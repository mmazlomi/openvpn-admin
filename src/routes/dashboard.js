/**
 * HTML page routing. The panel is a small server-rendered shell plus a
 * vanilla-JS front-end; these routes just decide which static file to send
 * and keep unauthenticated users away from the dashboard.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.resolve(fileURLToPath(new URL('../../public', import.meta.url)));
const router = express.Router();

router.get('/', (req, res) => {
  if (req.admin) return res.sendFile(path.join(publicDir, 'index.html'));
  return res.redirect('/login.html');
});

router.get('/login.html', (req, res) => {
  if (req.admin) return res.redirect('/');
  res.sendFile(path.join(publicDir, 'login.html'));
});

router.get('/index.html', (req, res) => {
  if (!req.admin) return res.redirect('/login.html');
  res.sendFile(path.join(publicDir, 'index.html'));
});

export default router;
export { publicDir };
