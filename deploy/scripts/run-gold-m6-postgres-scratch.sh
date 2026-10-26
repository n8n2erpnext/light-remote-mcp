#!/usr/bin/env bash
# Opt-in integration of Gold M6 recovery/terminal-ACK logic on a private,
# disposable PostgreSQL 17 cluster. Does not connect to live Gold UAT DB.
set -euo pipefail
umask 077
[[ "$(hostname)" == 'light-remote-gold-uat' ]] ||
  { echo 'GOLD_SCRATCH_TEST_REQUIRES_UAT_CONTAINER' >&2; exit 2; }
[[ "$(id -u)" == 0 ]] ||
  { echo 'GOLD_SCRATCH_TEST_NEEDS_CONTAINER_ROOT' >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
[[ -f "$ROOT/deploy/scripts/integration-gold-m6-postgres-scratch.mjs" &&
   -f "$ROOT/lib/gold-device-resource-locks.mjs" ]] ||
  { echo 'GOLD_SCRATCH_TEST_CODE_MISSING' >&2; exit 2; }
PG_BIN=/usr/lib/postgresql/17/bin
for item in initdb pg_ctl createdb; do
  [[ -x "$PG_BIN/$item" ]] || { echo "GOLD_SCRATCH_PG17_MISSING:$item" >&2; exit 2; }
done
SCRATCH="$(mktemp -d /tmp/gold-pr4-pg-XXXXXXXX)"
chmod 0700 "$SCRATCH"
chown postgres:postgres "$SCRATCH"
DATA="$SCRATCH/data"
cleanup(){
  if [[ -d "$DATA" ]]; then
    runuser -u postgres -- "$PG_BIN/pg_ctl" -D "$DATA" -m immediate -w stop >/dev/null 2>&1 || :
  fi
  rm -rf -- "$SCRATCH"
}
trap cleanup EXIT
runuser -u postgres -- "$PG_BIN/initdb" -D "$DATA" -A trust --no-instructions >/dev/null
printf "\nunix_socket_directories = '%s'\nlisten_addresses = ''\nport = 55998\n" "$SCRATCH" >> "$DATA/postgresql.conf"
runuser -u postgres -- "$PG_BIN/pg_ctl" -D "$DATA" -l "$SCRATCH/postmaster.log" -w start >/dev/null
runuser -u postgres -- "$PG_BIN/createdb" -h "$SCRATCH" -p 55998 gold_pr4_scratch_acceptance
runuser -u postgres -- env -u PGHOST -u DATABASE_URL \
  GOLD_PR4_SCRATCH_SOCKET="$SCRATCH" \
  GOLD_PR4_SCRATCH_DATABASE=gold_pr4_scratch_acceptance \
  GOLD_PR4_SCRATCH_PORT=55998 \
  node "$ROOT/deploy/scripts/integration-gold-m6-postgres-scratch.mjs"
echo 'GOLD_PR4_SCRATCH_INTEGRATION_PASS_ISOLATED_CLUSTER=PASS'
