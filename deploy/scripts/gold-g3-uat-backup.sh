#!/usr/bin/env bash
# Back up isolated UAT code, service config, Gold PostgreSQL business DB and
# local state BEFORE any G3 runtime transition. Does not change live services.
set -euo pipefail
umask 077
SHA="${G3_GOLD_SOURCE_SHA:?source SHA required}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
BACKUP_DIR="/var/backups/light-remote-gold-uat/pre-g3-$SHA"
if [[ -e "$BACKUP_DIR" ]];then
  echo "G3_GOLD_BACKUP_ALREADY_EXISTS";exit 3
fi
install -d -m 0700 "$BACKUP_DIR"
echo "$SHA" > "$BACKUP_DIR/source-sha.txt"
# LXD-scoped all-or-nothing snapshot artifacts, never copied to public host.
tar -C /opt -czf "$BACKUP_DIR/live-code.tgz" light-remote-gold-uat
tar -C /etc/systemd/system -czf "$BACKUP_DIR/systemd-config.tgz" \
  light-remote-gold-operator.service light-remote-gold-operator.service.d \
  light-remote-gold-plugin.service light-remote-gold-plugin.service.d \
  light-remote-gold-wall.service
tar -C /var/lib -czf "$BACKUP_DIR/local-state.tgz" light-remote-gold-uat
runuser -u postgres -- pg_dump --format=custom --no-owner --no-acl light_remote_gold_dev > "$BACKUP_DIR/postgresql.dump"
pg_restore --list "$BACKUP_DIR/postgresql.dump" >/dev/null
for f in live-code.tgz systemd-config.tgz local-state.tgz;do tar -tzf "$BACKUP_DIR/$f" >/dev/null;done
(cd "$BACKUP_DIR" && sha256sum live-code.tgz systemd-config.tgz local-state.tgz postgresql.dump > SHA256SUMS.txt)
(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS.txt >/dev/null)
chmod -R go-rwx "$BACKUP_DIR"
echo "G3_GOLD_BACKUP_VERIFIED=PASS"
echo "G3_GOLD_BACKUP_SOURCE=$SHA"
echo "G3_GOLD_BACKUP_COMPONENTS=code,systemd,local-state,pg_dump"
# Do not print or export credentials, database content or backup bytes.
