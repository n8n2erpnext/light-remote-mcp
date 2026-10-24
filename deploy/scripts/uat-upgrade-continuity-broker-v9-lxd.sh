#!/usr/bin/env bash
# Dedicated LXD-only cold upgrade; never touch production Gold or personal device.
set -euo pipefail
[[ "$#" == 1 && "$1" == --explicit-isolated-uat-upgrade ]] || { echo EXPLICIT_UAT_APPROVAL_REQUIRED; exit 2; }
INSTANCE=light-remote-continuity-uat
[[ "$(git branch --show-current)" == feature/project-continuity-plan-20261023 ]] || exit 2
[[ "$(lxc list "$INSTANCE" --format csv -c s)" == RUNNING ]] || exit 2
lxc exec "$INSTANCE" -- test -f /opt/light-remote-continuity/.uat-installed
lxc exec "$INSTANCE" -- test -f /opt/light-remote-gold-continuity-candidate/client-core.json
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-continuity-uat.service
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-gold-continuity-agent-uat.service
PREV="$(lxc exec "$INSTANCE" -- /usr/local/bin/light-remote-continuity-node --input-type=module -e "import {DatabaseSync} from 'node:sqlite';let db=new DatabaseSync('/var/lib/light-remote-continuity/controller/continuity.db',{readOnly:true});console.log(db.prepare('PRAGMA user_version').get().user_version);db.close()" 2>/dev/null)"
[[ "$PREV" == 8 ]] || { echo "REQUIRE_SCHEMA_8_FOUND_$PREV"; exit 3; }
lxc exec "$INSTANCE" -- systemctl stop light-remote-gold-continuity-agent-uat.service
lxc exec "$INSTANCE" -- systemctl stop light-remote-continuity-uat.service
lxc exec -T "$INSTANCE" -- /bin/bash -s <<'INNER'
set -euo pipefail
backup="/root/continuity-lxd-pre-v9-$(date +%Y%m%dT%H%M%SZ).tar.gz"
umask 077
tar -czf "$backup" -C /var/lib light-remote-continuity
test "$(stat -c %a "$backup")" = 600
echo "ISOLATED_BROKER_COLD_BACKUP_CREATED $(basename "$backup")"
for file in project-continuity-store.mjs project-continuity-owner-broker.mjs project-continuity-owner-broker-cli.mjs project-continuity-client.mjs project-continuity-owner-grants.mjs; do
 src="/opt/light-remote-gold-continuity-candidate/device-agent/$file"
 dst="/opt/light-remote-continuity/device-agent/$file"
 test -s "$src" && test -s "$dst"
 install -o root -g root -m 0644 "$src" "$dst"
done
install -o root -g root -m 0644 /opt/light-remote-gold-continuity-candidate/lib/project-continuity-session-proof.mjs /opt/light-remote-continuity/lib/project-continuity-session-proof.mjs
echo ISOLATED_BROKER_SOURCE_UPDATED_WITH_FULL_GOLD_PACKAGE
INNER
lxc exec "$INSTANCE" -- systemctl start light-remote-continuity-uat.service
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-continuity-uat.service
lxc exec "$INSTANCE" -- systemctl start light-remote-gold-continuity-agent-uat.service
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-gold-continuity-agent-uat.service
AFTER="$(lxc exec "$INSTANCE" -- /usr/local/bin/light-remote-continuity-node --input-type=module -e "import {DatabaseSync} from 'node:sqlite';let db=new DatabaseSync('/var/lib/light-remote-continuity/controller/continuity.db',{readOnly:true});console.log(db.prepare('PRAGMA user_version').get().user_version);db.close()" 2>/dev/null)"
test "$AFTER" = 9
echo ISOLATED_BROKER_V8_TO_V9_MIGRATION_WITH_BACKUP_PASS
