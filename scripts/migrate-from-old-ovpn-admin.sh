#!/usr/bin/env bash
#
# migrate-from-old-ovpn-admin.sh
#
# Run this ONLY after the new panel has been tested and confirmed working.
# It disables the legacy /usr/local/bin/ovpn-admin service. It does NOT
# delete the binary or touch the PKI.
#
set -euo pipefail

OLD_UNIT=ovpn-admin.service
NEW_UNIT=openvpn-admin.service

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

echo "This will:"
echo "  1. verify the new panel ($NEW_UNIT) is active and healthy"
echo "  2. systemctl disable --now $OLD_UNIT"
echo "  3. leave /usr/local/bin/ovpn-admin in place (not deleted)"
echo
read -r -p "Type 'MIGRATE' to continue: " confirm
[ "$confirm" = "MIGRATE" ] || { echo "aborted"; exit 1; }

echo "==> checking new panel"
systemctl is-active --quiet "$NEW_UNIT" || { echo "new panel is not active — aborting"; exit 1; }

port=$(grep -E '^PORT=' /etc/openvpn-admin.env 2>/dev/null | cut -d= -f2); port=${port:-8282}
host=$(grep -E '^HOST=' /etc/openvpn-admin.env 2>/dev/null | cut -d= -f2); host=${host:-127.0.0.1}
if ! curl -fsS "http://$host:$port/api/health" >/dev/null; then
  echo "new panel health check failed — aborting"; exit 1
fi
echo "  new panel healthy on $host:$port"

if systemctl list-unit-files | grep -q "^$OLD_UNIT"; then
  echo "==> disabling $OLD_UNIT"
  systemctl disable --now "$OLD_UNIT"
  echo "  done. Old binary still at /usr/local/bin/ovpn-admin (remove manually if desired)."
else
  echo "  $OLD_UNIT not present — nothing to do"
fi

echo
echo "If the new panel binds the same port (8282), restart it now:"
echo "  systemctl restart $NEW_UNIT"
