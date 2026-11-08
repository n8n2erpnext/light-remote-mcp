#!/usr/bin/env sh
# Operator owner-only structural acceptance of an EXISTING Gold UAT schema.
# Reads no rows: pg_dump --schema-only. Never writes to Gold UAT.
# Restore is in disposable PostgreSQL with --network none, no DB bind volume.
set -eu
[ "${LR_GOLD_PRO_SHARE_UAT_SCHEMA_CLONE_TEST:-0}" = '1' ] || {
  echo "Explicit LR_GOLD_PRO_SHARE_UAT_SCHEMA_CLONE_TEST=1 required" >&2
  exit 2
}
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
container='light-remote-gold-uat'
name="lr-p2i4c-uatclone-$$"
umask 077
tmp=$(mktemp -d "$repo/.light-remote/.uat-schema-XXXXXXXX")
cleanup(){
 docker rm -f "$name" >/dev/null 2>&1 || true
 [ -n "$tmp" ] && [ -d "$tmp" ] && rm -f "$tmp/schema.sql" && rmdir "$tmp" 2>/dev/null || :
}
trap cleanup EXIT HUP INT TERM
docker image inspect postgres:17-alpine >/dev/null 2>&1 || {
  echo "Cached postgres:17-alpine required; no pull permitted" >&2;exit 3
}
[ "$(lxc list --format=csv -c ns | grep -F "$container,RUNNING" | wc -l)" = 1 ] || {
 echo "Expected running Gold UAT" >&2;exit 3
}
ver=$(lxc exec "$container" -- runuser -u postgres -- psql -X -At -d light_remote_gold_dev \
 -c 'SELECT COUNT(*) FROM public.lr_schema_migrations')
[ "$ver" = 39 ] || {
  echo "Gold UAT schema changed; expected migration count 39, got $ver" >&2;exit 3
}
absent=$(lxc exec "$container" -- runuser -u postgres -- psql -X -At \
 -d light_remote_gold_dev \
 -c "SELECT to_regclass('public.lr_gold_pro_share_guest_jobs') IS NULL")
[ "$absent" = 't' ] || {
 echo "Guest already exists in UAT; abort structural clone test" >&2;exit 3
}
echo 'GOLD_UAT_SCHEMA_SOURCE_MIGRATION_039_READ_ONLY=PASS'
lxc exec "$container" -- runuser -u postgres -- pg_dump \
  --schema-only --no-owner --no-privileges --format=plain \
  --dbname=light_remote_gold_dev > "$tmp/schema.sql"
[ -s "$tmp/schema.sql" ] || { echo 'Empty UAT schema' >&2;exit 3; }
if grep -Ei '^COPY[[:space:]]|^INSERT[[:space:]]|^\\connect[[:space:]]' \
 "$tmp/schema.sql" >/dev/null;then
 echo 'Schema export unexpectedly contains data commands' >&2;exit 3
fi
echo 'GOLD_UAT_SCHEMA_ONLY_NO_ROW_DUMP=PASS'
pass=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
docker run --pull never --rm -d --network none --cpus 1 --memory 640m \
 --name "$name" -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres \
 -e POSTGRES_PASSWORD="$pass" \
 -v "$tmp/schema.sql:/source_schema.sql:ro" \
 -v "$repo/deploy/scripts/selftest-gold-guest-pre-effect-restart-pg044.sql:/restart-stage.sql:ro" \
 -v "$repo/deploy/scripts/selftest-gold-guest-pre-effect-restart-verify.sql:/restart-verify.sql:ro" \
 -v "$repo/deploy/scripts/selftest-gold-guest-cancel-billing-pg044.sql:/cancel-billing.sql:ro" \
 -v "$repo/platform-v2/sql:/migrations:ro" \
 -v "$repo/deploy/scripts/selftest-gold-pro-share-pg044-disposable.sql:/fixture.sql:ro" \
 postgres:17-alpine -c listen_addresses='' >/dev/null
ready=0;i=0
while [ "$i" -lt 55 ];do
 if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1;then ready=1;break;fi
 i=$((i+1));sleep 1
done
[ "$ready" = 1 ] || { echo 'Disposable postgres unavailable' >&2;exit 4; }
docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q \
 -c 'CREATE ROLE lr_gold_app LOGIN' postgres
docker exec "$name" sh -c '
 set -eu
 psql -X -U postgres -v ON_ERROR_STOP=1 -q -f /source_schema.sql postgres \
  >/tmp/restore-out 2>/tmp/restore-err || {
   echo GOLD_UAT_SCHEMA_RESTORE_FAIL
   tail -12 /tmp/restore-err;exit 5
  }
 echo GOLD_UAT_NATIVE_039_SCHEMA_RESTORE=PASS
 for i in 040 041 042 043 044;do
  f=/migrations/"$i"_*.sql
  psql -X -U postgres -v ON_ERROR_STOP=1 -q -f $f postgres \
    >/tmp/migrate-out 2>/tmp/migrate-err || {
     echo "GOLD_UAT_NATIVE_MIGRATION_$i=FAIL"
     tail -12 /tmp/migrate-err;exit 6
    }
  echo "GOLD_UAT_NATIVE_MIGRATION_$i=PASS"
 done
 psql -X -U postgres -v ON_ERROR_STOP=1 -q -f /fixture.sql postgres \
   >/tmp/fixture-out 2>/tmp/fixture-err || {
    echo GOLD_UAT_NATIVE_GUEST_M3_M4_M6_FIXTURE=FAIL
    tail -18 /tmp/fixture-err;exit 6
   }
 echo GOLD_UAT_NATIVE_GUEST_M3_M4_M6_FIXTURE=PASS
'
# Native PREPARE against REAL Gold UAT schema structure plus candidate 040–044.
for kind in launch terminal;do
 if [ "$kind" = launch ];then
  src="$repo/operator-host/pro-share-guest-launch-bind-pg.mjs"
 else
  src="$repo/operator-host/pro-share-guest-terminal-pg.mjs"
 fi
 query=$(node -e '
const fs=require("node:fs"),x=fs.readFileSync(process.argv[1],"utf8");
const k=process.argv[2];
const pattern=k==="launch"?
 /const r=await db\.query\(`(SELECT g\.job_id[\s\S]*?)`,\[jobId\]\)/:
 /const checked=await db\.query\(`(SELECT g\.job_id[\s\S]*?)`,\[jobId\]\)/;
const m=x.match(pattern);if(!m)process.exit(4);
process.stdout.write("PREPARE uat_clone_guest_"+k+"(text) AS "+m[1]);
' "$src" "$kind")
 [ -n "$query" ] || { echo "Missing source SQL for $kind" >&2;exit 7; }
 docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q \
  -c "$query" postgres || { echo "UAT_CLONE_GUEST_${kind}_PREPARE=FAIL" >&2;exit 7; }
 echo "UAT_CLONE_GUEST_${kind}_SOURCE_SQL=PASS"
done
# Compile M4 canonical owner bridge and both outbound pre-effect SELECTs
# against the UAT-derived structure. These are source-extracted queries,
# not separately hand-written SQL fixtures.
m4sql=$(node -e '
const fs=require("node:fs"),x=fs.readFileSync(process.argv[1],"utf8");
const m=x.match(/const q=await db\.query\(`(SELECT g\.job_id[\s\S]*?)`,\[e\.jobId\]\)/);
if(!m)process.exit(4);
process.stdout.write("PREPARE uat_clone_guest_m4(text) AS "+m[1]);
' "$repo/operator-host/pro-share-guest-owner-m4-pg.mjs")
docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q \
 -c "$m4sql" postgres
echo 'UAT_CLONE_GUEST_M4_OWNER_SCOPE_SQL=PASS'
for kind in prepare attempt;do
 sql=$(node -e '
const fs=require("node:fs"),x=fs.readFileSync(process.argv[1],"utf8"),
 kind=process.argv[2];
const m=x.match(kind==="prepare"?
 /const r=await db\.query\(`(SELECT g\.job_id[\s\S]*?)`,\[jobId\]\)/:
 /const q=await db\.query\(`(SELECT o\.job_id[\s\S]*?)`,\[jobId,commandId\]\)/);
if(!m)process.exit(4);
process.stdout.write("PREPARE uat_clone_guest_outbound_"+kind+
 (kind==="prepare"?"(text)":"(text,text)")+" AS "+m[1]);
' "$repo/operator-host/pro-share-guest-outbound-pg.mjs" "$kind")
 [ -n "$sql" ] || { echo "Missing source outbound SQL for $kind" >&2;exit 7; }
 docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q \
  -c "$sql" postgres || { echo "UAT_CLONE_GUEST_OUTBOUND_$kind=FAIL" >&2;exit 7; }
 echo "UAT_CLONE_GUEST_OUTBOUND_$kind=PASS"
done
# Run the exact source native schema-contract SELECTs against the restored
# UAT-derived PG039->044 structure, with no fake app catalog metadata.
for kind in short_id guest;do
 query=$(node -e '
const fs=require("node:fs"),x=fs.readFileSync(process.argv[1],"utf8");
const arr=[...x.matchAll(/const x=\(await pool\.query\(`(SELECT[\s\S]*?)`\)\)\.rows\?\.\[0\]/g)];
if(arr.length!==2)process.exit(4);
process.stdout.write(arr[process.argv[2]==="short_id"?0:1][1]);
' "$repo/lib/gold-schema-startup-gate.mjs" "$kind")
 [ -n "$query" ] || { echo "Guest startup probe source missing for $kind" >&2;exit 8; }
 result=$(docker exec "$name" psql -X -U postgres -Atq -v ON_ERROR_STOP=1 -c "$query" postgres) || {
  echo "UAT_CLONE_STARTUP_PROBE_$kind=FAIL" >&2;exit 8
 }
 case "$result" in
  t|t\|t|t\|t\|t|t\|t\|t\|t\|t\|t\|t\|t\|t) ;;
  *) echo "UAT_CLONE_STARTUP_PROBE_$kind=FALSE" >&2;exit 8;;
 esac
 echo "UAT_CLONE_STARTUP_PROBE_$kind=PASS"
done
echo 'GOLD_UAT_SCHEMA_CLONE_039_TO_044_NO_DATA_NO_NETWORK=PASS'

# Execute the exact source startup SQL on synthetic RESERVE(no outbound)
# and owner job rows, not a hand-written mock of Operator recovery.
docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q \
 -f /restart-stage.sql postgres || exit 11
restart_sql=$(node "$repo/deploy/scripts/selftest-gold-guest-restart-source-sql.mjs")
[ -n "$restart_sql" ] || { echo "Missing source recovery SQL" >&2;exit 11; }
printf '%s\n' "$restart_sql" |
 docker exec -i "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q postgres || exit 11
docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q \
 -f /restart-verify.sql postgres || exit 11
echo "GOLD_NATIVE_GUEST_PRE_EFFECT_RESTART_SOURCE_SQL=PASS"
docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q \
 -f /cancel-billing.sql postgres || exit 12
echo "GOLD_NATIVE_GUEST_CANCEL_AND_BILL_ONCE=PASS"

# Check the actual production-source cancellation SQL on the installed
# PostgreSQL column/FK schema. All statements are PREPARE only here.
for idx in select claim m3 ledger;do
 sql=$(node -e '
const fs=require("node:fs");
const x=fs.readFileSync(process.argv[1],"utf8");
const key=process.argv[2];
const patterns={
 select:/const locked=await db\.query\(`(SELECT g\.state AS queue_state,[\s\S]*?)`,\[jobId,ownerAccountId,deviceId\]\)/,
 claim:/const gone=await db\.query\(`(DELETE FROM lr_gold_device_resource_claims[\s\S]*?)`,\[jobId,ownerAccountId,deviceId\]\)/,
 m3:/const m3=await db\.query\(`(DELETE FROM lr_gold_personal_agent_work[\s\S]*?)`,[\s\S]*?\[jobId,ownerAccountId,deviceId\]\)/,
 ledger:/const ledger=await db\.query\(`(DELETE FROM lr_gold_job_records[\s\S]*?)`,[\s\S]*?\[jobId,ownerAccountId,deviceId\]\)/
};
const m=x.match(patterns[key]);if(!m)process.exit(4);
process.stdout.write("PREPARE guest_cancel_"+key+"(text,text,text) AS "+m[1]);
' "$repo/operator-host/pro-share-guest-owner-m4-pg.mjs" "$idx")
 [ -n "$sql" ] || { echo "Missing source cancellation SQL $idx" >&2;exit 13; }
 docker exec "$name" psql -X -U postgres -v ON_ERROR_STOP=1 -q \
 -c "$sql" postgres || exit 13
 echo "GOLD_NATIVE_GUEST_M4_CANCEL_SOURCE_SQL_$idx=PASS"
done
