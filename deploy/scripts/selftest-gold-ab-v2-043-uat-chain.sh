#!/usr/bin/env sh
# Strictly read-only Gold UAT 039 export; candidate 040-043 only in disposable
# local no-NIC PostgreSQL 17. Never an installer or --apply entrypoint.
set -eu
[ "$#" -eq 0 ] || { echo "This fixture does not support arguments or --apply" >&2;exit 2; }
[ "${LR_GOLD_ABV2_043_SCHEMA_CHAIN_TEST:-0}" = 1 ] || {
 echo "Explicit LR_GOLD_ABV2_043_SCHEMA_CHAIN_TEST=1 required" >&2; exit 2; }
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
container='light-remote-gold-uat'
name="lr-abv2-043-chain-$$"
umask 077
tmp=$(mktemp -d "$repo/.light-remote/.abv2-schema-043-XXXXXXXX")
cleanup(){
 docker rm -f "$name" >/dev/null 2>&1 || :
 if [ -d "$tmp" ];then rm -f "$tmp/schema.sql";rmdir "$tmp" 2>/dev/null || :;fi
}
trap cleanup EXIT HUP INT TERM
docker image inspect postgres:17-alpine >/dev/null 2>&1 || {
 echo "Cached PG17 only; no pull" >&2;exit 3; }
[ "$(lxc list --format=csv -c ns | grep -Fc "$container,RUNNING")" = 1 ] || {
 echo "Gold UAT not RUNNING" >&2;exit 3; }
result=$(lxc exec "$container" -- runuser -u postgres -- psql -X -At  -d light_remote_gold_dev -c "SELECT count(*),max(version),
 to_regclass('public.lr_gold_device_short_ids') IS NULL,
 to_regclass('public.lr_gold_pro_share_guest_jobs') IS NULL
 FROM public.lr_schema_migrations")
[ "$result" = '39|39|t|t' ] || {
 echo "Gold UAT version/schema changed: abort" >&2;exit 3; }
echo GOLD_ABV2_043_CHAIN_UAT039_READ_ONLY=PASS
# Lock 040-042 to exact shipped signed manifest; 043 is a candidate, NOT
# approved or inserted in migrations.lock.json.
node - "$repo" <<'JS'
const fs=require('fs'),crypto=require('crypto'),path=require('path');
const root=process.argv[2];
const m=JSON.parse(fs.readFileSync(path.join(root,'platform-v2/sql/migrations.lock.json')));
if(m.migrations.length!==42||m.migrations.some((r,i)=>r.version!==i+1))process.exit(5);
for(let i=40;i<=42;i++){
const e=m.migrations[i-1];
const data=fs.readFileSync(path.join(root,'platform-v2/sql',e.file));
if(crypto.createHash('sha256').update(data).digest('hex')!==e.sha256)process.exit(6);
}
if(m.migrations.some(r=>r.version===43))process.exit(7);
console.log('GOLD_ABV2_040_042_SIGNED_LOCK_HASH_AND_043_UNREGISTERED=PASS');
JS
lxc exec "$container" -- runuser -u postgres -- pg_dump  --schema-only --no-owner --no-privileges --format=plain  --dbname=light_remote_gold_dev > "$tmp/schema.sql"
[ -s "$tmp/schema.sql" ] || exit 4
if grep -Ei '^COPY[[:space:]]|^INSERT[[:space:]]|^\\connect[[:space:]]'  "$tmp/schema.sql" >/dev/null;then
 echo 'UAT export contained data; abort' >&2;exit 4;fi
pass=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
docker run --pull never --rm -d --network none --cpus 1 --memory 640m  --name "$name" -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres  -e POSTGRES_PASSWORD="$pass"  -v "$tmp/schema.sql:/schema.sql:ro"  -v "$repo/platform-v2/sql:/sql:ro"  -v "$repo/deploy/scripts/selftest-gold-ab-v2-043-uat-chain.sql:/fixture.sql:ro"  postgres:17-alpine -c listen_addresses='' >/dev/null
i=0
until docker exec "$name" pg_isready -U postgres >/dev/null 2>&1;do
 i=$((i+1));[ "$i" -lt 60 ] || exit 5;sleep 1
done
docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q  -c 'CREATE ROLE lr_gold_app LOGIN' postgres
docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q  -f /schema.sql postgres >/dev/null
echo GOLD_ABV2_UAT039_SCHEMA_RESTORED_NO_DATA=PASS
for n in 040 041 042 043;do
 case "$n" in
  040) filename=040_gold_connection_job_gc_fences.sql;;
  041) filename=041_gold_device_execution_epoch.sql;;
  042) filename=042_gold_wall_announcements_channel.sql;;
  043) filename=043_gold_device_short_ids.sql;;
  *) exit 9;;
 esac
 docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q  -f "/sql/$filename" postgres >/dev/null
 echo "GOLD_ABV2_NATIVE_MIGRATION_${n}=PASS"
 if [ "$n" = 042 ];then
  missing=$(docker exec "$name" psql -X -U postgres -Atq -v ON_ERROR_STOP=1 \
   -c "SELECT to_regclass('public.lr_gold_device_short_ids') IS NULL" postgres)
  [ "$missing" = t ] || { echo "Short ID exists before migration 043" >&2;exit 8; }
  echo GOLD_ABV2_042_TO_043_STRICT_BOUNDARY=PASS
 fi
done
# Test candidate native schema and exact 043 trigger on post-042 catalog.
docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -Atq -f /fixture.sql postgres | grep '^GOLD_ABV2_NATIVE_039_TO_043_OWNER_SCOPE_IMMUTABLE_TOMBSTONE=PASS'
# The startup schema probe is extracted from actual deployed source, rather
# than a reimplemented hand-written SELECT.
probe=$(node - "$repo/lib/gold-schema-startup-gate.mjs" <<'JS'
const fs=require('fs');
const x=fs.readFileSync(process.argv[2],'utf8');
const m=x.match(/if\(version>=43\)\{\s+const x=\(await pool\.query\(`(SELECT[\s\S]*?)`\)\)\.rows/);
if(!m)process.exit(8);
process.stdout.write(m[1]);
JS
)
[ -n "$probe" ] || exit 9
result=$(docker exec "$name" psql -X -U postgres -Atq -v ON_ERROR_STOP=1  -c "$probe" postgres)
[ "$result" = 't|t' ] || { echo "043 startup probe failed: $result" >&2;exit 9; }
echo GOLD_ABV2_NATIVE_043_SOURCE_STARTUP_SCHEMA_PROBE=PASS
echo GOLD_ABV2_039_040_041_042_043_DISPOSABLE_NO_NIC=PASS
