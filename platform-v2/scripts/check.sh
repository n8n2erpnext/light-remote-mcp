#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check src/storage/postgres.mjs
node --check src/storage/redis.mjs
node --test test/storage.test.mjs

project=lightremote-rc50-v2
pg() {
  docker compose -p "$project" -f compose.yml exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U lr_rc50_uat -d light_remote_rc50_uat -f /dev/stdin
}
for file in sql/001_core.sql sql/002_usage_monthly.sql sql/003_auth_device_communications.sql \
  sql/004_tenant_binding_guards.sql sql/005_team_seat_guard.sql; do
  pg < "$file" >/dev/null
done
echo 'RC50_SCHEMA_MIGRATIONS_1_TO_5_PASS'
for file in sql/test_core_rollback.sql sql/test_auth_device_rollback.sql \
  sql/test_tenant_binding_rollback.sql sql/test_team_seats_rollback.sql; do
  pg < "$file" | grep -E 'RC50_.*PASS'
done
python3 test/concurrent_team_seats.py

docker inspect lightremote-rc50-v2-postgres-1 lightremote-rc50-v2-redis-1 \
  --format '{{.Name}} health={{.State.Health.Status}} ports={{json .NetworkSettings.Ports}}'
if [ "$(docker network inspect lightremote-rc50-v2_private --format '{{.Internal}}')" != true ]; then
  echo "ERROR: UAT network must remain internal-only" >&2; exit 1
fi
if docker inspect lightremote-rc50-v2-postgres-1 lightremote-rc50-v2-redis-1 \
  --format '{{range $k,$v := .NetworkSettings.Ports}}{{if $v}}EXPOSED{{end}}{{end}}' | grep -q EXPOSED; then
  echo "ERROR: UAT must have zero published ports" >&2; exit 1
fi
echo 'RC50_V2_PLATFORM_UAT_PASS'
