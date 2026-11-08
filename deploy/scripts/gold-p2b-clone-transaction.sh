#!/usr/bin/env bash
# REAL rollback rehearsal, never a live deployment helper.
set -euo pipefail
umask 077
ROOT=/var/lib/light-remote-p2b
SQL="$ROOT/platform-v2/sql"
SYS=/etc/systemd/system
SERVICES=(light-remote-gold-operator light-remote-gold-process-supervisor light-remote-gold-plugin light-remote-gold-wall)
PREPARED=0
WORK=''
P2B_CANDIDATE_SHA=48cc61c323d050b20cf2535500b39393ac064f73
P2B_CANDIDATE=/opt/light-remote-gold-uat-candidates/$P2B_CANDIDATE_SHA
P2B_OVERRIDE_NAME="$(printf 'z%.0s' {1..212})-p2b-candidate.conf"
MODE=failure
pg(){ runuser -u postgres -- psql -AtX -v ON_ERROR_STOP=1 -d light_remote_gold_dev -c "$1"; }
stop_four(){ systemctl stop light-remote-gold-wall light-remote-gold-plugin light-remote-gold-process-supervisor light-remote-gold-operator; }
start_four(){ systemctl start light-remote-gold-operator light-remote-gold-process-supervisor light-remote-gold-plugin light-remote-gold-wall; }
clean_overrides(){
 for u in "${SERVICES[@]}";do
  rm -f "$SYS/$u.service.d/zzzzzzz-p2b-negative.conf"
  rm -f "$SYS/$u.service.d/$P2B_OVERRIDE_NAME"
 done
 rm -f "$SYS/light-remote-gold-wall.service.d/zzzzzzzz-p2b-loopback.conf"
 systemctl daemon-reload
}
redis(){
 python3 - "$@" <<'PY'
import os,shlex,subprocess,sys
password=None
for line in open('/etc/redis/redis.conf'):
 t=shlex.split(line,comments=True)
 if len(t)==2 and t[0]=='requirepass':password=t[1]
if not password:raise SystemExit('P2B_REDIS_AUTH_MISSING')
r=subprocess.run(['redis-cli','--raw',*sys.argv[1:]],capture_output=True,
 env={**os.environ,'REDISCLI_AUTH':password},timeout=15)
if r.returncode or r.stderr:raise SystemExit('P2B_REDIS_COMMAND_FAILED')
sys.stdout.buffer.write(r.stdout)
PY
}
guard(){
 [[ "$(id -u)" == 0 && "$(hostname)" == gold-p2a-runtime-rollback-20261030 ]] || { echo P2B_CLONE_ONLY;exit 3; }
 [[ "$(ls /sys/class/net | tr '\n' ' ')" == 'lo ' && -z "$(ip -4 route show default)" ]] || { echo P2B_NETWORK_GUARD_DENIED;exit 3; }
 [[ -f "$SQL/migrations.lock.json" ]] || { echo P2B_MANIFEST_MISSING;exit 3; }
 [[ "$(pg 'select max(version) from lr_schema_migrations')" == 39 && "$(pg 'select count(*) from lr_schema_migrations')" == 39 ]] || { echo P2B_NOT_SCHEMA039;exit 3; }
 [[ "$(pg 'select count(*) from lr_gold_device_resource_claims')" == 1 ]] || { echo P2B_FOREIGN_CLAIM_MISMATCH;exit 3; }
 [[ "$(pg "select count(*) from lr_gold_personal_agent_work where state='unknown'")" == 27 ]] || { echo P2B_HISTORICAL_WORK_MISMATCH;exit 3; }
 [[ "$(pg "select count(*) from lr_gold_job_records where status in ('queued','running')")" == 0 ]] || { echo P2B_ACTIVE_JOBS_DENIED;exit 3; }
 for u in "${SERVICES[@]}";do
  test -f "$SYS/$u.service"
  test ! -e "$SYS/$u.service.d/zzzzzzz-p2b-negative.conf"
  test ! -e "$SYS/$u.service.d/$P2B_OVERRIDE_NAME"
 done
 systemctl is-active --quiet postgresql
 systemctl is-active --quiet redis-server
 node - "$SQL" <<'JS'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const d=process.argv[2],m=JSON.parse(fs.readFileSync(path.join(d,'migrations.lock.json')));
if(m.migrations?.length!==42||m.migrations[39]?.version!==40||
 m.migrations[41]?.file!=='042_gold_wall_announcements_channel.sql')
 throw Error('P2B_MANIFEST_LOCK_INVALID');
for(let i=0;i<42;i++){
 const x=m.migrations[i];
 if(x.version!==i+1||!/^[0-9]{3}_[a-z0-9_]+[.]sql$/.test(x.file))throw Error('P2B_MANIFEST_SEQUENCE');
 const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(d,x.file))).digest('hex');
 if(hash!==x.sha256)throw Error('P2B_MANIFEST_HASH_DRIFT');
}
console.log('P2B_SQL_42_HASHES_VERIFIED');
JS
 echo P2B_NO_NIC_CLONE_SCHEMA039_GUARD=PASS
}
rollback(){
 local prior="$1" broken=0
 trap - EXIT
 if [[ "$PREPARED" != 1 ]];then
  echo P2B_NO_VALID_PAIRED_BACKUP_CLONE_FROZEN >&2
  exit 7
 fi
 echo P2B_PAIRED_ROLLBACK_STARTED
 stop_four || broken=1
 clean_overrides || broken=1
 tar -C "$SYS" -df "$WORK/four-units.tar" >/dev/null || broken=1
 runuser -u postgres -- dropdb --force light_remote_gold_dev || broken=1
 runuser -u postgres -- createdb -O lr_gold_migrator light_remote_gold_dev || broken=1
 echo P2B_RECOVERY_PG_RECREATE_BROKEN=$broken
 if [[ "$broken" == 0 ]];then
  runuser -u postgres -- pg_restore --no-owner --role=lr_gold_migrator --exit-on-error -d light_remote_gold_dev < "$WORK/preimage039.dump" || broken=1
 fi
 echo P2B_RECOVERY_PG_RESTORE_BROKEN=$broken
 systemctl stop redis-server || broken=1
 echo P2B_RECOVERY_REDIS_STOP_BROKEN=$broken
 if [[ "$broken" == 0 ]];then
  install -o redis -g redis -m 0600 "$WORK/redis-preimage.rdb" /var/lib/redis/dump.rdb || broken=1
 fi
 echo P2B_RECOVERY_REDIS_RDB_COPY_BROKEN=$broken
 systemctl start redis-server || broken=1
 echo P2B_RECOVERY_REDIS_RESTART_BROKEN=$broken
 if [[ "$broken" == 0 ]];then
  [[ "$(redis PING)" == PONG ]] || broken=1
  [[ "$(pg 'select max(version) from lr_schema_migrations')" == 39 ]] || broken=1
  [[ "$(pg 'select count(*) from lr_schema_migrations')" == 39 ]] || broken=1
  [[ "$(pg 'select count(*) from lr_gold_device_resource_claims')" == 1 ]] || broken=1
  [[ "$(pg "select count(*) from lr_gold_personal_agent_work where state='unknown'")" == 27 ]] || broken=1
  [[ "$(pg "select to_regclass('public.lr_gold_device_execution_epochs') is null")" == t ]] || broken=1
  echo P2B_RECOVERY_DB_REDIS_VALIDATION_BROKEN=$broken
 fi
 if [[ "$broken" == 0 ]];then
  printf '[Service]\nEnvironment=OPERATOR_AGENT_WALL_HOST=127.0.0.1\nEnvironment=OPERATOR_FLEET_WALL_HOST=127.0.0.1\n' > "$SYS/light-remote-gold-wall.service.d/zzzzzzzz-p2b-loopback.conf"
  systemctl daemon-reload
  start_four || broken=1
  echo P2B_RECOVERY_START_FOUR_BROKEN=$broken
 fi
 if [[ "$broken" == 0 ]];then
  ready=0
  for attempt in {1..25};do
   healthy=1
   for u in "${SERVICES[@]}" postgresql redis-server;do
    systemctl is-active --quiet "$u" || healthy=0
   done
   response="$(curl -m 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5491/ || :)"
   if [[ "$healthy" == 1 && "$response" == 303 ]];then ready=1;break;fi
   sleep 1
  done
  [[ "$ready" == 1 ]] || { echo P2B_ROLLBACK_SERVICE_READINESS_TIMEOUT >&2;broken=1; }
  echo P2B_RECOVERY_READINESS_BROKEN=$broken
  if [[ "$broken" == 0 ]];then
   for i in {1..12};do
    for u in "${SERVICES[@]}" postgresql redis-server;do
     systemctl is-active --quiet "$u" || broken=1
    done
    response="$(curl -m 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5491/ || :)"
    [[ "$response" == 303 ]] || broken=1
    [[ "$broken" == 0 ]] || break
    sleep 1
   done
  fi
 fi
 stop_four || broken=1
 clean_overrides || broken=1
 tar -C "$SYS" -df "$WORK/four-units.tar" >/dev/null || broken=1
 echo P2B_RECOVERY_FINAL_OUTCOME_BROKEN=$broken
 if [[ "$broken" != 0 ]];then
  echo P2B_ROLLBACK_FAILED_CLONE_REQUIRES_FORENSICS >&2
  exit 5
 fi
 echo P2B_PG039_REDIS_RDB_FOUR_SERVICE_ROLLBACK=PASS
 echo P2B_M4_CLAIM_AND_27_UNKNOWN_WORK_PRESERVED=PASS
 echo P2B_RESTART_HEALTH_12_SAMPLES=PASS
 echo P2B_ALL_ORIGINAL_UNIT_FILES_RESTORED=PASS
 exit "$prior"
}
guard
if [[ "${1:---preflight}" == '--preflight' && "$#" -le 1 ]];then
 echo P2B_READ_ONLY_CLONE_PREFLIGHT=PASS
 exit 0
fi
if [[ "$#" != 2 || "$2" != '--isolated-only' ]];then
 echo P2B_MUTATION_DENIED >&2;exit 3
fi
case "$1" in
 --rehearse-failure) MODE=failure;;
 --rehearse-success) MODE=success;;
 *) echo P2B_MUTATION_DENIED >&2;exit 3;;
esac
if [[ "$MODE" == success ]];then
 [[ -f "$P2B_CANDIDATE/.git-source-sha" && "$(cat "$P2B_CANDIDATE/.git-source-sha")" == "$P2B_CANDIDATE_SHA" ]] || { echo P2B_IMMUTABLE_CANDIDATE_DENIED;exit 3; }
 [[ -s "$P2B_CANDIDATE/.git-tracked-SHA256SUMS" ]] || { echo P2B_CANDIDATE_MANIFEST_DENIED;exit 3; }
 (cd "$P2B_CANDIDATE" && sha256sum -c .git-tracked-SHA256SUMS >/dev/null) || { echo P2B_CANDIDATE_SOURCE_HASH_DENIED;exit 3; }
 for f in operator-host/executor.mjs device-agent/process-supervisor.mjs plugin-server/server.mjs device-agent/operator-agent.mjs;do
  runuser -u gold-uat -- node --check "$P2B_CANDIDATE/$f" || { echo P2B_CANDIDATE_ENTRYPOINT_DENIED;exit 3; }
 done
 for u in "${SERVICES[@]}";do
  last=$(find "$SYS/$u.service.d" -maxdepth 1 -name '*.conf' -printf '%f\n' | LC_ALL=C sort | tail -1)
  [[ "$P2B_OVERRIDE_NAME" > "$last" ]] || { echo P2B_OVERRIDE_PRIORITY_DENIED;exit 3; }
 done
 echo P2B_CANDIDATE_HASH_AND_SYSTEMD_PRIORITY=PASS
fi
WORK="$(mktemp -d "$ROOT/p2b-transaction-XXXXXX")"
tar -C "$SYS" -cf "$WORK/four-units.tar" \
 light-remote-gold-operator.service light-remote-gold-operator.service.d \
 light-remote-gold-process-supervisor.service light-remote-gold-process-supervisor.service.d \
 light-remote-gold-plugin.service light-remote-gold-plugin.service.d \
 light-remote-gold-wall.service light-remote-gold-wall.service.d
stop_four
runuser -u postgres -- pg_dump -Fc -d light_remote_gold_dev > "$WORK/preimage039.dump"
pg_restore --list "$WORK/preimage039.dump" >/dev/null
[[ "$(redis PING)" == PONG ]]
redis SAVE >/dev/null
install -m 0600 /var/lib/redis/dump.rdb "$WORK/redis-preimage.rdb"
(cd "$WORK" && sha256sum four-units.tar preimage039.dump redis-preimage.rdb > SHA256SUMS.txt && sha256sum -c SHA256SUMS.txt >/dev/null)
PREPARED=1
trap 'rollback "$?"' EXIT
echo P2B_PRIVATE_PAIRED_PREIMAGE_VERIFIED=PASS
for v in 40 41 42;do
 case "$v" in
 40) file=040_gold_connection_job_gc_fences.sql;;
 41) file=041_gold_device_execution_epoch.sql;;
 42) file=042_gold_wall_announcements_channel.sql;;
 esac
 runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d light_remote_gold_dev \
  -c 'SET ROLE lr_gold_migrator' -f - -c "INSERT INTO lr_schema_migrations(version) VALUES($v)" \
  < "$SQL/$file" >/dev/null
done
[[ "$(pg 'select max(version) from lr_schema_migrations')" == 42 ]]
[[ "$(pg 'select count(*) from lr_schema_migrations')" == 42 ]]
[[ "$(pg "select to_regclass('public.lr_gold_device_execution_epochs') is not null")" == t ]]
echo P2B_REAL_SQL_039_TO_042=PASS
if [[ "$MODE" == success ]];then
 for u in "${SERVICES[@]}";do
  case "$u" in
   light-remote-gold-operator) entry=operator-host/executor.mjs;extra='';;
   light-remote-gold-process-supervisor) entry=device-agent/process-supervisor.mjs;extra='';;
   light-remote-gold-plugin) entry=plugin-server/server.mjs;extra='';;
   light-remote-gold-wall) entry=device-agent/operator-agent.mjs;extra=' daemon';;
  esac
  override="$SYS/$u.service.d/$P2B_OVERRIDE_NAME"
  printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=/usr/bin/node %s/%s%s\n' \
   "$P2B_CANDIDATE" "$P2B_CANDIDATE" "$entry" "$extra" > "$override"
  if [[ "$u" == light-remote-gold-wall ]];then
   printf 'Environment=OPERATOR_AGENT_WALL_HOST=127.0.0.1\nEnvironment=OPERATOR_FLEET_WALL_HOST=127.0.0.1\n' >> "$override"
  fi
 done
 systemctl daemon-reload
 for u in "${SERVICES[@]}";do
  [[ "$(systemctl show "$u" -p WorkingDirectory --value)" == "$P2B_CANDIDATE" ]] || { echo P2B_SOURCE_OVERRIDE_NOT_EFFECTIVE >&2;exit 6; }
  systemctl show "$u" -p ExecStart --value | grep -F "$P2B_CANDIDATE/" >/dev/null || { echo P2B_EXECSTART_OVERRIDE_NOT_EFFECTIVE >&2;exit 6; }
 done
 echo P2B_FOUR_SYSTEMD_OVERRIDES_EFFECTIVE=PASS
 start_four
 ready=0
 for attempt in {1..35};do
  healthy=1
  for u in "${SERVICES[@]}" postgresql redis-server;do systemctl is-active --quiet "$u" || healthy=0;done
  code="$(curl -m 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5491/ || :)"
  if [[ "$healthy" == 1 && "$code" == 303 ]];then ready=1;break;fi
  sleep 1
 done
 [[ "$ready" == 1 ]] || { echo P2B_SUCCESS_CANDIDATE_READINESS_FAILED >&2;exit 6; }
 [[ "$(pg 'select max(version) from lr_schema_migrations')" == 42 ]] || exit 6
 [[ "$(pg 'select count(*) from lr_gold_device_resource_claims')" == 1 ]] || exit 6
 for i in {1..15};do
  for u in "${SERVICES[@]}" postgresql redis-server;do systemctl is-active --quiet "$u" || { echo P2B_SUCCESS_CANDIDATE_HEALTH_WINDOW_FAILED >&2;exit 6;};done
  code="$(curl -m 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5491/ || :)"
  [[ "$code" == 303 ]] || { echo P2B_SUCCESS_CANDIDATE_HTTP_FAILED >&2;exit 6; }
  sleep 1
 done
 echo P2B_REAL_IMMUTABLE_FOUR_SERVICE_SCHEMA042_CANDIDATE=PASS
 echo P2B_SUCCESS_CANDIDATE_15_SAMPLES_HTTP303=PASS
 exit 43
fi
for u in "${SERVICES[@]}";do
 printf '[Unit]\nConditionPathExists=%s/never-created-candidate\n' "$WORK" > "$SYS/$u.service.d/zzzzzzz-p2b-negative.conf"
done
systemctl daemon-reload
start_four || :
unexpected=0
for u in "${SERVICES[@]}";do
 [[ "$(systemctl is-active "$u" || :)" != active ]] || unexpected=$((unexpected+1))
done
[[ "$unexpected" == 0 ]] || { echo P2B_FAIL_CLOSED_INJECTION_NOT_DETECTED >&2;exit 5; }
echo P2B_FOUR_SERVICE_BAD_CANDIDATE_DETECTED=PASS
exit 42
