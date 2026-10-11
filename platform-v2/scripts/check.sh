#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check src/storage/postgres.mjs
node --check src/storage/redis.mjs
node --check src/storage/worker-uat.mjs
node --test test/*.test.mjs

project=lightremote-rc50-v2
pg() {
  docker compose -p "$project" -f compose.yml exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U lr_rc50_uat -d light_remote_rc50_uat -f /dev/stdin
}
for file in sql/001_core.sql sql/002_usage_monthly.sql sql/003_auth_device_communications.sql \
  sql/004_tenant_binding_guards.sql sql/005_team_seat_guard.sql \
  sql/006_worker_outbox_leases.sql sql/007_worker_function_permissions.sql; do
  pg < "$file" >/dev/null
done
echo 'RC50_SCHEMA_MIGRATIONS_1_TO_7_PASS'
for file in sql/test_core_rollback.sql sql/test_auth_device_rollback.sql \
  sql/test_tenant_binding_rollback.sql sql/test_team_seats_rollback.sql \
  sql/test_worker_outbox_rollback.sql; do
  pg < "$file" | grep -E 'RC50_.*PASS'
done
pg < sql/test_worker_function_acl.sql | grep RC50_WORKER_OUTBOX_FUNCTION_ACL_PASS
python3 test/concurrent_team_seats.py
python3 test/concurrent_worker_outbox.py

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
