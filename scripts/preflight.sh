#!/usr/bin/env bash
# Preflight checks. Read-only: verifies the environment the panel depends on.
# Exit non-zero if a hard requirement is missing.
set -u

OK=0; FAIL=0
green() { printf '  \033[32m✓\033[0m %s\n' "$1"; OK=$((OK+1)); }
red()   { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
warn()  { printf '  \033[33m!\033[0m %s\n' "$1"; }

EASYRSA_DIR=${EASYRSA_DIR:-/etc/openvpn/easy-rsa}
PKI_DIR=${PKI_DIR:-$EASYRSA_DIR/pki}
OPENVPN_HOST=${OPENVPN_HOST:-ppp.mmazlomi.ir}

echo "== OS =="
if [ -r /etc/os-release ]; then . /etc/os-release; echo "  $PRETTY_NAME"; fi
case "$(. /etc/os-release; echo "$VERSION_ID")" in
  13*) green "Debian 13 (trixie)";;
  *)   warn "Not Debian 13 — proceed with care";;
esac

echo "== Node.js =="
if command -v node >/dev/null; then
  v=$(node -p 'process.versions.node')
  major=${v%%.*}
  if [ "$major" -ge 20 ]; then green "node $v"; else red "node $v (need >= 20)"; fi
else
  red "node not found"
fi

echo "== EasyRSA =="
[ -x "$EASYRSA_DIR/easyrsa" ] && green "$EASYRSA_DIR/easyrsa" || red "$EASYRSA_DIR/easyrsa missing"
"$EASYRSA_DIR/easyrsa" --version 2>/dev/null | awk '/Version:/{print "    "$0}'

echo "== PKI =="
for f in ca.crt index.txt; do
  [ -e "$PKI_DIR/$f" ] && green "pki/$f" || red "pki/$f missing"
done
if [ -e "$PKI_DIR/private/ca.key" ]; then green "pki/private/ca.key"; else red "pki/private/ca.key missing"; fi

echo "== TLS control-channel key =="
ta="$PKI_DIR/ta.key"; [ -e "$ta" ] || ta=/etc/openvpn/server/ta.key
if [ -s "$ta" ] && grep -q 'BEGIN OpenVPN Static key V1' "$ta" 2>/dev/null; then
  green "$ta contains a valid static key"
elif [ -s /etc/openvpn-admin/tls-crypt.key ] && grep -q 'BEGIN OpenVPN Static key V1' /etc/openvpn-admin/tls-crypt.key; then
  green "/etc/openvpn-admin/tls-crypt.key present (panel copy)"
else
  red "No usable tls-crypt/tls-auth key (ta.key empty AND no panel copy)"
fi

echo "== OpenVPN server =="
if [ -d /etc/openvpn/server ]; then green "/etc/openvpn/server/"; else red "/etc/openvpn/server/ missing"; fi
unit=$(systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null \
        | awk '$1 ~ /^openvpn(-server@|@|\.)/ {print $1; exit}')
if [ -n "$unit" ]; then
  green "running unit: $unit"
elif systemctl is-active --quiet openvpn-server@server; then
  green "openvpn-server@server active"
else
  warn "no running openvpn unit detected"
fi

echo "== DNS =="
if getent hosts "$OPENVPN_HOST" >/dev/null; then
  green "$OPENVPN_HOST resolves ($(getent hosts "$OPENVPN_HOST" | awk '{print $1}' | tr '\n' ' '))"
else
  red "$OPENVPN_HOST does not resolve"
fi

echo
echo "== helper / sudoers (if installed) =="
[ -x /opt/openvpn-admin/bin/ovpn-helper ] && green "helper installed" || warn "helper not installed yet"
if id openvpn-admin >/dev/null 2>&1; then
  if sudo -n -l -U openvpn-admin 2>/dev/null | grep -q ovpn-helper; then
    green "sudoers rule active"
  else
    warn "sudoers rule not active yet"
  fi
else
  warn "service user openvpn-admin does not exist yet"
fi

echo
echo "Passed: $OK   Failed: $FAIL"
[ "$FAIL" -eq 0 ]
