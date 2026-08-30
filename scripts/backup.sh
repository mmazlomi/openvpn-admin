#!/usr/bin/env bash
#
# backup.sh — back up the panel's own state.
#
# Includes:   SQLite database, /etc/openvpn-admin.env, /etc/openvpn-admin/,
#             the systemd unit and sudoers snippet.
# Excludes:   the OpenVPN PKI (ca.key, issued/, private/, ta.key). Those are
#             far more sensitive and MUST be backed up separately with their
#             own encryption and access controls — see README "Backup".
#
set -euo pipefail

DATA_DIR=${DATA_DIR:-/var/lib/openvpn-admin}
DB=${DATABASE:-$DATA_DIR/openvpn-admin.db}
OUT_DIR=${1:-/var/backups/openvpn-admin}
STAMP=$(date +%Y%m%d-%H%M%S)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

install -d -m 0700 "$OUT_DIR"
install -d -m 0700 "$TMP/openvpn-admin-$STAMP"
DEST="$TMP/openvpn-admin-$STAMP"

# Consistent SQLite copy (handles WAL).
if [ -f "$DB" ]; then
  if command -v sqlite3 >/dev/null; then
    sqlite3 "$DB" ".backup '$DEST/openvpn-admin.db'"
  else
    cp "$DB" "$DEST/openvpn-admin.db"
  fi
fi

for f in /etc/openvpn-admin.env; do
  [ -e "$f" ] && cp -a "$f" "$DEST/"
done
[ -d /etc/openvpn-admin ] && cp -a /etc/openvpn-admin "$DEST/etc-openvpn-admin"
[ -e /etc/systemd/system/openvpn-admin.service ] && cp -a /etc/systemd/system/openvpn-admin.service "$DEST/"
[ -e /etc/sudoers.d/openvpn-admin ] && cp -a /etc/sudoers.d/openvpn-admin "$DEST/"

TARBALL="$OUT_DIR/openvpn-admin-$STAMP.tar.gz"
tar -C "$TMP" -czf "$TARBALL" "openvpn-admin-$STAMP"
chmod 0600 "$TARBALL"

echo "Backup written: $TARBALL"
echo "NOTE: this archive contains SESSION_SECRET and the tls-crypt key copy."
echo "      Store it encrypted. The OpenVPN PKI is NOT included — back it up separately."
