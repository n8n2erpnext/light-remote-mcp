#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check src/storage/postgres.mjs
node --check src/storage/redis.mjs
node --test test/storage.test.mjs
docker compose -p lightremote-rc50-v2 -f compose.yml exec -T postgres   psql -v ON_ERROR_STOP=1 -U lr_rc50_uat -d light_remote_rc50_uat -f /dev/stdin < sql/001_core.sql >/dev/null
docker compose -p lightremote-rc50-v2 -f compose.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U lr_rc50_uat -d light_remote_rc50_uat -f /dev/stdin < sql/002_usage_monthly.sql >/dev/null
docker compose -p lightremote-rc50-v2 -f compose.yml exec -T postgres   psql -v ON_ERROR_STOP=1 -U lr_rc50_uat -d light_remote_rc50_uat -f /dev/stdin < sql/test_core_rollback.sql | tail -8
docker inspect lightremote-rc50-v2-postgres-1 lightremote-rc50-v2-redis-1   --format '{{.Name}} health={{.State.Health.Status}} ports={{json .NetworkSettings.Ports}}'
if [ "$(docker network inspect lightremote-rc50-v2_private --format '{{.Internal}}')" != true ];then
  echo "ERROR: UAT network must remain internal-only" >&2;exit 1
fi
if docker inspect lightremote-rc50-v2-postgres-1 lightremote-rc50-v2-redis-1   --format '{{range $k,$v := .NetworkSettings.Ports}}{{if $v}}EXPOSED{{end}}{{end}}' | grep -q EXPOSED;then
  echo "ERROR: UAT must have zero published ports" >&2;exit 1
fi
echo "RC50_V2_PLATFORM_UAT_PASS"
