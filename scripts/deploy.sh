#!/usr/bin/env bash
#
# deploy.sh — install / update the OpenVPN admin panel on this host.
#
# Idempotent and non-destructive:
#   * never touches the OpenVPN server config or the existing PKI contents
#   * never disables the old ovpn-admin service (use migrate-from-old-ovpn-admin.sh)
#   * only restores /etc/openvpn/server/ta.key if it is empty AND a valid
#     key is recoverable from an existing client .ovpn (asks first)
#
set -euo pipefail

APP_DIR=/opt/openvpn-admin
SERVICE_USER=openvpn-admin
ENV_FILE=/etc/openvpn-admin.env
DATA_DIR=/var/lib/openvpn-admin
HELPER_CONF_DIR=/etc/openvpn-admin
EASYRSA_DIR=${EASYRSA_DIR:-/etc/openvpn/easy-rsa}
PKI_DIR=${PKI_DIR:-$EASYRSA_DIR/pki}

say()  { printf '\033[36m==>\033[0m %s\n' "$1"; }
die()  { printf '\033[31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }
ask()  { local a; read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy]$ ]]; }

[ "$(id -u)" -eq 0 ] || die "run as root"

# 1. Debian version
say "1/13  Verifying OS"
. /etc/os-release
[[ "${VERSION_ID:-}" == 13* ]] || echo "  warning: expected Debian 13, found ${PRETTY_NAME:-unknown}"

# 2. Node.js
say "2/13  Verifying Node.js"
command -v node >/dev/null || die "Node.js not installed (see README: NodeSource setup_22.x)"
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 20 ] || die "Node.js >= 20 required (found $(node -v))"
echo "  $(node -v)"

# 3. EasyRSA
say "3/13  Verifying EasyRSA"
[ -x "$EASYRSA_DIR/easyrsa" ] || die "$EASYRSA_DIR/easyrsa not found"

# 4. PKI
say "4/13  Verifying PKI"
for f in ca.crt index.txt private/ca.key; do
  [ -e "$PKI_DIR/$f" ] || die "missing $PKI_DIR/$f"
done

# 5. OpenVPN server
say "5/13  Verifying OpenVPN server"
[ -d /etc/openvpn/server ] || die "/etc/openvpn/server missing"
systemctl list-units --type=service --all | grep -q openvpn || echo "  warning: no openvpn unit found"

# 6. Directories
say "6/13  Creating directories"
install -d -m 0750 "$DATA_DIR"
install -d -m 0750 "$HELPER_CONF_DIR"
# ownership set in step 7 once the service user exists

# 7. Service user
say "7/13  Creating service user"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  adduser --system --group --no-create-home --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
else
  echo "  user $SERVICE_USER already exists"
fi

# 8. Dependencies
say "8/13  Installing npm dependencies"
( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund )

# 9. Permissions
say "9/13  Configuring permissions"
chown -R root:root "$APP_DIR"
chmod 0755 "$APP_DIR/bin/ovpn-helper"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
# Config dir: group-readable by the service so CLI runs (create-admin, sync)
# and the sandboxed service can read helper.conf / tls-crypt.key.
chown root:"$SERVICE_USER" "$HELPER_CONF_DIR"
chmod 0750 "$HELPER_CONF_DIR"

# helper.conf
cat > "$HELPER_CONF_DIR/helper.conf" <<EOF
# Read by /opt/openvpn-admin/bin/ovpn-helper (running as root via sudo).
EASYRSA_DIR=$EASYRSA_DIR
PKI_DIR=$PKI_DIR
EASYRSA_BIN=$EASYRSA_DIR/easyrsa
CA_PASS_FILE=$EASYRSA_DIR/ca.pass
CERT_DAYS=${CLIENT_CERT_DAYS:-825}
EOF
chmod 0640 "$HELPER_CONF_DIR/helper.conf"
chown root:"$SERVICE_USER" "$HELPER_CONF_DIR/helper.conf"

# sudoers
install -m 0440 -o root -g root "$APP_DIR/systemd/sudoers.openvpn-admin" /etc/sudoers.d/openvpn-admin
visudo -cf /etc/sudoers.d/openvpn-admin >/dev/null || die "sudoers file failed validation"

# TLS key: panel copy
say "     Ensuring panel TLS-key copy"
TLS_KEY_FILE=${TLS_KEY_FILE:-$HELPER_CONF_DIR/tls-crypt.key}
ta="$PKI_DIR/ta.key"; [ -e "$ta" ] || ta=/etc/openvpn/server/ta.key
if [ -s "$ta" ] && grep -q 'BEGIN OpenVPN Static key V1' "$ta"; then
  install -m 0640 -o root -g "$SERVICE_USER" "$ta" "$TLS_KEY_FILE"
  echo "  copied from $ta"
elif [ -s "$TLS_KEY_FILE" ] && grep -q 'BEGIN OpenVPN Static key V1' "$TLS_KEY_FILE"; then
  chown root:"$SERVICE_USER" "$TLS_KEY_FILE"; chmod 0640 "$TLS_KEY_FILE"
  echo "  keeping existing $TLS_KEY_FILE"
else
  recovered=$(grep -rl 'BEGIN OpenVPN Static key V1' /root/*.ovpn 2>/dev/null | head -1 || true)
  if [ -n "$recovered" ]; then
    echo "  ta.key is empty; a valid key was found in $recovered"
    if ask "  Restore the tls-crypt key from $recovered ?"; then
      awk '/BEGIN OpenVPN Static key V1/,/END OpenVPN Static key V1/' "$recovered" > "$TLS_KEY_FILE"
      chmod 0640 "$TLS_KEY_FILE"; chown root:"$SERVICE_USER" "$TLS_KEY_FILE"
      if [ ! -s "$ta" ] && ask "  Also restore $ta (fixes OpenVPN's next restart)?"; then
        cp -a "$ta" "$ta.empty-backup-$(date +%s)" 2>/dev/null || true
        install -m 600 -o root -g root "$TLS_KEY_FILE" "$ta"
        echo "  restored $ta (OpenVPN NOT restarted)"
      fi
    fi
  else
    echo "  WARNING: no tls-crypt/tls-auth key available. Config downloads will"
    echo "           be refused until $TLS_KEY_FILE is populated."
  fi
fi

# env file
say "10/13  Environment file"
if [ ! -e "$ENV_FILE" ]; then
  secret=$(openssl rand -hex 48)
  sed "s|^SESSION_SECRET=.*|SESSION_SECRET=$secret|" "$APP_DIR/.env.example" > "$ENV_FILE"
  # 0640 root:openvpn-admin — systemd reads it as root; CLI sub-commands run
  # as the service user and need read access too.
  chmod 640 "$ENV_FILE"; chown root:"$SERVICE_USER" "$ENV_FILE"
  echo "  created $ENV_FILE with a fresh SESSION_SECRET"
else
  echo "  $ENV_FILE exists — leaving as is"
fi

# 11. systemd
say "11/13  Installing systemd unit"
install -m 0644 "$APP_DIR/systemd/openvpn-admin.service" /etc/systemd/system/openvpn-admin.service
systemctl daemon-reload
systemctl enable openvpn-admin.service >/dev/null

# 12. Start
say "12/13  Starting service"
systemctl restart openvpn-admin.service
sleep 2

# 13. Test endpoint
say "13/13  Testing HTTP endpoint"
port=$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2)
host=$(grep -E '^HOST=' "$ENV_FILE" | cut -d= -f2)
if curl -fsS "http://${host:-127.0.0.1}:${port:-8282}/api/health" >/tmp/oa-health.json; then
  echo "  health: $(cat /tmp/oa-health.json)"
else
  die "health check failed — see: journalctl -u openvpn-admin -n 50"
fi

echo
systemctl --no-pager --full status openvpn-admin.service | head -n 12
echo
say "Done. Next steps:"
echo "  sudo -u $SERVICE_USER node $APP_DIR/src/server.js create-admin   # first admin"
echo "  sudo -u $SERVICE_USER node $APP_DIR/src/server.js sync            # import existing certs"
echo "  configure nginx (see $APP_DIR/systemd/nginx.openvpn-admin.conf)"
