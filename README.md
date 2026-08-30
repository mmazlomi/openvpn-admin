# openvpn-admin

A small, production-oriented web panel for an **existing** OpenVPN + EasyRSA
server. It creates, lists, revokes and archives client certificates, generates
inline `.ovpn` profiles on demand, and shows live connection status.

It never recreates the CA, the server certificate, `ta.key` or any existing PKI
material. The filesystem PKI remains the single source of truth; SQLite only
stores metadata and the audit log.

---

## 1. Architecture

```
Browser ──HTTPS──► nginx (:443) ──HTTP──► node (127.0.0.1:8282)
                                             │
                        ┌────────────────────┼─────────────────────┐
                        │                    │                     │
                  SQLite (metadata)   sudo ovpn-helper (root)   OpenVPN mgmt
                  /var/lib/...         │                        127.0.0.1:8989
                                       ▼                         (read-only)
                              /etc/openvpn/easy-rsa  (root-owned PKI)
```

| Layer | Responsibility |
|-------|----------------|
| `src/server.js` | entry point + CLI subcommands (`create-admin`, `sync`, `health`) |
| `src/app.js` | Express app: sessions, helmet CSP, CSRF, routing |
| `src/routes/*` | HTTP endpoints (auth, clients, api, page routing) |
| `src/services/easyrsa.js` | ordered client-lifecycle logic, `index.txt` parsing |
| `src/services/certificate.js` | reads PEM files **verbatim**, validates headers |
| `src/services/client-config.js` | assembles the `.ovpn` in memory |
| `src/services/openvpn.js` | live status via the management interface |
| `src/services/helper.js` | `execFile` wrapper around the privileged helper |
| `bin/ovpn-helper` | the **only** privileged entry point (root via sudo) |

### Privilege model

The Node service runs as the unprivileged `openvpn-admin` user. The EasyRSA PKI
stays 100 % root-owned (no world/group-readable private keys, no `chmod` of
`/etc/openvpn`). All operations that need root — running `easyrsa`, reading
`ca.crt` / `ta.key` / issued certs / private keys — go through **one** shell
script, `/opt/openvpn-admin/bin/ovpn-helper`, allowed by a single locked-down
sudoers rule. The helper re-validates every argument itself.

---

## 2. Installation

Prerequisites: Debian 13, an already-working OpenVPN server + EasyRSA 3.x.

```bash
# 1. Node.js 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Put this project at /opt/openvpn-admin, then:
cd /opt/openvpn-admin
sudo bash scripts/preflight.sh        # read-only environment check
sudo bash scripts/deploy.sh           # idempotent installer (see step list below)
```

`deploy.sh` performs: OS/Node/EasyRSA/PKI/server checks → create
`/var/lib/openvpn-admin` and `/etc/openvpn-admin` → create the `openvpn-admin`
system user → `npm install --omit=dev` → install `helper.conf`, the sudoers
rule and the panel's `tls-crypt.key` copy → generate `/etc/openvpn-admin.env`
with a random `SESSION_SECRET` → install + enable the systemd unit → start →
`curl /api/health`.

It never touches the OpenVPN server config and never disables the old
`ovpn-admin` service.

---

## 3. Configuration

All configuration is environment variables in **`/etc/openvpn-admin.env`**
(mode `0640`, `root:openvpn-admin`). See `.env.example` for the full annotated
list. Key values:

| Variable | Meaning |
|----------|---------|
| `HOST` / `PORT` | must stay `127.0.0.1` / `8282` (behind nginx) |
| `SESSION_SECRET` | long random string — `openssl rand -hex 48` |
| `COOKIE_SECURE` | `true` in production (served over HTTPS) |
| `TRUST_PROXY` | `true` — trust one proxy hop (nginx `X-Forwarded-*`) |
| `EASYRSA_DIR` / `PKI_DIR` | existing paths, do not change contents |
| `TLS_MODE` | `auto` (inspect `server.conf`), or `tls-crypt` / `tls-auth` |
| `TLS_KEY_FILE` | panel's own copy of the control-channel key |
| `OPENVPN_HOST/PORT/PROTOCOL` | written into generated `.ovpn` `remote` line |
| `CLIENT_CERT_DAYS` | default `825` |

After editing: `sudo systemctl restart openvpn-admin`.

---

## 4. Creating the first admin

No password is ever stored in source or config. Create the admin interactively:

```bash
sudo -u openvpn-admin node /opt/openvpn-admin/src/server.js create-admin
# Username:
# Password:
# Confirm password:
```

Passwords are hashed with bcrypt (cost 12). Re-running with an existing
username resets that admin's password. For automated provisioning only, the
command also honours `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables.

---

## 5. Starting the service

```bash
sudo systemctl enable --now openvpn-admin
sudo systemctl status openvpn-admin
curl http://127.0.0.1:8282/api/health
journalctl -u openvpn-admin -f          # structured JSON logs
```

The unit is hardened (`ProtectSystem=strict`, `PrivateTmp`, `ProtectHome`,
restricted syscalls, …). `NoNewPrivileges` is deliberately **false** because the
panel escalates through the single sudoers rule; `/etc/openvpn/easy-rsa` is in
`ReadWritePaths` so the sandboxed helper can run `easyrsa`.

---

## 6. nginx configuration

The app listens only on `127.0.0.1:8282`. Terminate TLS in nginx and proxy to
it. A ready template is at
`systemd/nginx.openvpn-admin.conf` — **edit the three `CHANGE ME` lines**
(your domain, cert paths):

```bash
sudo cp systemd/nginx.openvpn-admin.conf /etc/nginx/sites-available/openvpn-admin.conf
sudo ln -s ../sites-available/openvpn-admin.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Always run `sudo nginx -T` first and confirm your `server_name` does not collide
with an existing block. Do not edit unrelated vhosts.

> On this host an existing vhost `ovpn.mmazlomi.ir` already proxies
> `127.0.0.1:8282` over HTTPS, so the panel is reachable there immediately with
> no nginx change. Point a fresh subdomain at it using the template if you
> prefer a clean vhost.

---

## 7. HTTPS

Use a real certificate. With certbot:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d vpn-admin.example.com
```

Or drop an existing cert/key into the paths referenced by the vhost. Keep
`COOKIE_SECURE=true` so the session cookie is only sent over TLS. HSTS is
emitted by the app when `COOKIE_SECURE=true` and by the nginx template.

---

## 8. Creating clients

**UI:** *ایجاد کاربر* → enter a name (`[a-zA-Z0-9_-]`, ≤64 chars) → *Download
OpenVPN file*.

**API:**

```bash
curl -b cookies -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
     -d '{"name":"laptop-01"}' https://DOMAIN/api/clients

curl -b cookies -OJ https://DOMAIN/api/clients/laptop-01/config   # laptop-01.ovpn
```

Creation sequence (all enforced server-side): validate name → check DB →
check PKI state → refuse if `pki/reqs/<name>.req` or `pki/issued/<name>.crt`
already exists but the client is untracked (reported as a conflict, never
overwritten) → `easyrsa build-client-full <name> nopass` → verify cert + key
exist → store metadata.

The `.ovpn` is generated **in memory** on each authenticated request and sent
with `Content-Disposition: attachment`. It is never written under `public/`.
It contains inline `<ca> <cert> <key>` and `<tls-crypt>` (or `<tls-auth>` +
`key-direction 1` if the server uses tls-auth). Config generation is **refused**
if the control-channel key is empty or lacks
`-----BEGIN OpenVPN Static key V1-----`.

---

## 9. Revoking clients

**UI:** *لغو* on an active row (confirmation required). **API:**
`POST /api/clients/:name/revoke`.

Runs `easyrsa revoke <name>` then `easyrsa gen-crl`, verifies the CRL file was
regenerated, sets `status=revoked`, `revoked_at=now`. The certificate/key are
**not** deleted. Download is disabled for revoked clients.

Lifecycle: `ACTIVE → REVOKED → ARCHIVED`. *Archive* (`POST …/archive`) is a
metadata-only state for revoked clients; it never removes files. Deleting a DB
row is intentionally not exposed — revocation is the security operation.

> **Enforcement note:** this server's `server.conf` currently has **no
> `crl-verify` directive**. Generating the CRL is not enough to disconnect a
> revoked client. To enforce revocation, add
> `crl-verify /etc/openvpn/easy-rsa/pki/crl.pem` to `server.conf` and reload
> OpenVPN — a change to the OpenVPN config that must be made deliberately by an
> operator, not by this panel.

---

## 10. Backup

```bash
sudo bash scripts/backup.sh            # -> /var/backups/openvpn-admin/*.tar.gz (0600)
```

Includes the SQLite DB, `/etc/openvpn-admin.env`, `/etc/openvpn-admin/`, the
systemd unit and sudoers snippet. The archive contains `SESSION_SECRET` and the
`tls-crypt.key` copy — **store it encrypted**.

The OpenVPN PKI (`ca.key`, `issued/`, `private/`, `ta.key`) is **not** included.
Back it up separately and securely, e.g.:

```bash
sudo tar -C /etc/openvpn -czf easy-rsa-pki-$(date +%F).tgz easy-rsa/pki server
sudo gpg -c easy-rsa-pki-*.tgz && sudo shred -u easy-rsa-pki-*.tgz
```

---

## 11. Restore

```bash
# panel state
sudo systemctl stop openvpn-admin
sudo tar -C /tmp -xzf openvpn-admin-YYYYMMDD-HHMMSS.tar.gz
sudo cp /tmp/openvpn-admin-*/openvpn-admin.db /var/lib/openvpn-admin/
sudo cp /tmp/openvpn-admin-*/openvpn-admin.env /etc/openvpn-admin.env
sudo chown openvpn-admin:openvpn-admin /var/lib/openvpn-admin/openvpn-admin.db
sudo systemctl start openvpn-admin

# then reconcile with the on-disk PKI:
sudo -u openvpn-admin node /opt/openvpn-admin/src/server.js sync
```

`sync` discovers every certificate in `pki/index.txt`, adds missing rows and
updates statuses. It never revokes, regenerates or deletes anything.

---

## 12. Security

- bcrypt password hashing; sessions in SQLite; cookie `HttpOnly`, `SameSite=Lax`,
  `Secure` (prod); session regenerated on login; rolling idle expiry.
- CSRF: synchronizer token in the session, required on every state-changing
  request (`X-CSRF-Token`). Login is exempt (no session yet; credentials +
  SameSite are the proof).
- Login rate limiting (`LOGIN_RATE_MAX` / window, per IP).
- helmet CSP: `default-src 'self'`, no inline script, `frame-ancestors 'none'`.
- Every `/api` endpoint except `/api/health` requires authentication.
- Client names: `^[a-zA-Z0-9_-]{1,64}$`, no `.` `/` space or shell metacharacter;
  reserved names (`ca`, `server`, …) rejected. Validated in Node **and** again
  in the helper.
- No shell string interpolation anywhere — `execFile` with argv arrays.
- Private keys are never logged, never shown in the UI, never stored in SQLite,
  never served from `public/`, never returned by an unauthenticated endpoint.
- Errors returned to clients are `{error, message}` only — no stack traces, no
  paths, no EasyRSA/OpenSSL detail. Full detail goes to the journal.
- Audit log (`audit_logs`): `LOGIN`, `LOGOUT`, `CREATE_CLIENT`,
  `DOWNLOAD_CONFIG`, `REVOKE_CLIENT`, `ARCHIVE_CLIENT`, `SYNC` with admin, IP,
  timestamp.

---

## 13. Troubleshooting

| Symptom | Check |
|---------|-------|
| `502` from nginx | `systemctl status openvpn-admin`; `curl 127.0.0.1:8282/api/health` |
| login works, next request `401` | `COOKIE_SECURE=true` but not actually on HTTPS → set `false` for plain-HTTP testing, or fix the proxy `X-Forwarded-Proto` |
| `HELPER_FORBIDDEN` / `sudo: a password is required` | `sudo -n -l -U openvpn-admin` must list `ovpn-helper`; reinstall `/etc/sudoers.d/openvpn-admin` (mode 0440) and `visudo -c` |
| `TLS_KEY_EMPTY` / `TLS_KEY_INVALID` on download | `/etc/openvpn-admin/tls-crypt.key` missing or empty — repopulate from a known-good client `.ovpn` `<tls-crypt>`/`<tls-auth>` block |
| `PKI_REQ_EXISTS` on create | `pki/reqs/<name>.req` exists but the client isn't tracked — inspect it, remove if stale, or pick another name |
| client creation hangs / `PKI_OP_FAILED` | CA key passphrase: `EASYRSA_PASS_FILE` must point at a file `easyrsa --passin=file:` can read |
| live status always empty | management iface: `ss -lntp | grep 8989`; only one client at a time may use it (old `ovpn-admin` must be stopped) |
| service won't start after hardening | `journalctl -u openvpn-admin`; a denied syscall shows as `EPERM` — relax `SystemCallFilter` if needed |

Health detail: `sudo -u openvpn-admin node src/server.js health`.

---

## 14. Migrating off the old `ovpn-admin`

The legacy binary (`/usr/local/bin/ovpn-admin`) and its unit are left untouched
by the installer. After you have tested this panel:

```bash
sudo bash scripts/migrate-from-old-ovpn-admin.sh   # asks for confirmation
```

It verifies the new panel is healthy, then `systemctl disable --now
ovpn-admin.service`. The old binary is not deleted.

---

## 15. Tests

```bash
npm test        # node:test — validation, PEM handling, .ovpn generation,
                # index.txt parsing, auth/session/CSRF, create→download→revoke
npm run lint    # eslint
```

## API summary

```
GET  /api/health                     (public)
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
GET  /api/clients
POST /api/clients
GET  /api/clients/:name
GET  /api/clients/:name/config        -> attachment
POST /api/clients/:name/revoke
POST /api/clients/:name/archive
POST /api/sync
GET  /api/status                      live server + connections
GET  /api/audit
```
