#!/usr/bin/env sh
# Owner-approved disposable PG044 source acceptance.
# No NIC, no Docker ports, no customer DB volume, no Gold UAT writes.
set -eu
[ "${LR_GOLD_PG044_DISPOSABLE_TEST:-0}" = "1" ] || {
 echo "Set LR_GOLD_PG044_DISPOSABLE_TEST=1 for disposable no-network test" >&2
 exit 2
}
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
name="lr-p2i4c-pg044-test-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
docker image inspect postgres:17-alpine >/dev/null 2>&1 || {
 echo "Requires cached postgres:17-alpine; never pull at test runtime" >&2
 exit 2
}
pass=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
docker run --pull never --rm -d --network none --cpus 1 --memory 512m \
 --name "$name" -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres \
 -e POSTGRES_PASSWORD="$pass" \
 -v "$repo/platform-v2/sql:/migrations:ro" \
 -v "$repo/deploy/scripts/selftest-gold-pro-share-pg044-disposable.sql:/fixture.sql:ro" \
 postgres:17-alpine -c listen_addresses='' >/dev/null
ready=0
i=0
while [ "$i" -lt 55 ]; do
 if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1;then ready=1;break;fi
 i=$((i+1));sleep 1
done
[ "$ready" = 1 ] || { echo "Disposable PostgreSQL not ready" >&2;exit 3; }
docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 \
 -qc "CREATE ROLE lr_gold_app LOGIN" postgres
docker exec "$name" sh -c '
set -eu
for f in /migrations/[0-9][0-9][0-9]_*.sql; do
 case "${f##*/}" in 044_*) break ;; esac
 psql -X -U postgres -v ON_ERROR_STOP=1 -q -f "$f" postgres \
  >/tmp/last-out 2>/tmp/last-err || {
   printf "MIGRATION_FAILURE:%s\n" "${f##*/}";tail -15 /tmp/last-err;exit 4;
  }
done
echo "DISPOSABLE_001_043=PASS"
psql -X -U postgres -v ON_ERROR_STOP=1 -q \
 -f /migrations/044_gold_pro_share.sql postgres >/tmp/last-out 2>/tmp/last-err || {
  echo "PG044_APPLY=FAIL";tail -15 /tmp/last-err;exit 5;
 }
echo "DISPOSABLE_PG044_APPLY=PASS"
psql -X -U postgres -v ON_ERROR_STOP=1 -q \
 -f /fixture.sql postgres >/tmp/last-out 2>/tmp/last-err || {
  echo "PG044_NATIVE_INTEGRITY=FAIL";tail -22 /tmp/last-err;exit 6;
 }
cat /tmp/last-out
'
