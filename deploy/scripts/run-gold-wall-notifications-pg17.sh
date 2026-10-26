#!/usr/bin/env bash
# UAT-only standalone PostgreSQL integration for Notification Bell.
# No connection to main Light Remote PostgreSQL or existing agents.
set -euo pipefail
umask 077
[[ "$(hostname)" == "light-remote-gold-uat" && "$(id -u)" == "0" ]] ||
 { echo GOLD_NOTIFICATION_ISOLATED_UAT_ONLY >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
[[ -f "$ROOT/deploy/scripts/integration-gold-wall-notifications-pg17.mjs" ]] ||
 { echo GOLD_NOTIFICATION_INTEGRATION_MISSING >&2; exit 2; }
PG_BIN=/usr/lib/postgresql/17/bin
for bin in initdb pg_ctl createdb; do
 [[ -x "$PG_BIN/$bin" ]] || { echo "GOLD_NOTIFICATION_PG17_MISSING:$bin" >&2; exit 2; }
done
SCRATCH="$(mktemp -d /tmp/gold-noti-pg-XXXXXXXX)"
chown postgres:postgres "$SCRATCH";chmod 0700 "$SCRATCH"
DATA="$SCRATCH/data"
cleanup(){
 if [[ -d "$DATA" ]];then runuser -u postgres -- "$PG_BIN/pg_ctl" -D "$DATA" -m immediate -w stop >/dev/null 2>&1 || :;fi
 rm -rf -- "$SCRATCH"
}
trap cleanup EXIT
runuser -u postgres -- "$PG_BIN/initdb" -D "$DATA" -A trust --no-instructions >/dev/null
printf "\nunix_socket_directories = '%s'\nlisten_addresses = ''\nport = 55997\n" "$SCRATCH" >> "$DATA/postgresql.conf"
runuser -u postgres -- "$PG_BIN/pg_ctl" -D "$DATA" -l "$SCRATCH/postmaster.log" -w start >/dev/null
runuser -u postgres -- "$PG_BIN/createdb" -h "$SCRATCH" -p 55997 gold_noti_scratch_acceptance
runuser -u postgres -- env -u PGHOST -u DATABASE_URL \
 GOLD_NOTI_SCRATCH_SOCKET="$SCRATCH" \
 GOLD_NOTI_SCRATCH_DATABASE=gold_noti_scratch_acceptance \
 node "$ROOT/deploy/scripts/integration-gold-wall-notifications-pg17.mjs"
echo GOLD_NOTIFICATIONS_STANDALONE_PG17_DISPOSABLE_CLEANUP_ARMED=PASS
