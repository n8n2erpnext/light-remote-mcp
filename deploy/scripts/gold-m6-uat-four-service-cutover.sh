#!/usr/bin/env bash
# Gold M6 four-service UAT-only cutover. Safe default is preflight.
set -euo pipefail
umask 077
[[ -v GOLD_M6_SOURCE_SHA ]] || { echo M6_SHA_REQUIRED >&2; exit 2; }
SHA="$GOLD_M6_SOURCE_SHA"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ "$(hostname)" == "light-remote-gold-uat" ]] || { echo M6_NOT_UAT_HOST >&2; exit 2; }
TARGET="/opt/light-remote-gold-uat-candidates/$SHA"
BACKUP="/var/backups/light-remote-gold-uat/pre-g3-$SHA"
SOCKET="/run/light-remote-gold-uat/operator.sock"
ROOT="/etc/systemd/system"
# A prior owner-permissions UAT upgrade uses zz/zzz-prefixed drop-ins.
# M6 must explicitly win systemd lexicographic override order when opted in.
OVERRIDE_NAME="zzzz-m6-candidate.conf"
[[ -f "$TARGET/.git-source-sha" && "$(cat "$TARGET/.git-source-sha")" == "$SHA" ]] || { echo M6_CANDIDATE_UNVERIFIED >&2; exit 3; }
[[ -f "$BACKUP/SHA256SUMS.txt" && -f "$BACKUP/process-supervisor-units.tgz" ]] || { echo M6_BACKUP_REQUIRED >&2; exit 3; }
(cd "$BACKUP" && sha256sum -c SHA256SUMS.txt >/dev/null)
[[ -L "$TARGET/node_modules" && -L "$TARGET/plugin-server/node_modules" && -L "$TARGET/secrets" ]] || { echo M6_DEPS_MISSING >&2; exit 3; }
for entry in operator-host/executor.mjs plugin-server/server.mjs device-agent/operator-agent.mjs device-agent/process-supervisor.mjs; do
 runuser -u gold-uat -- node --check "$TARGET/$entry"
done
v="$(runuser -u postgres -- psql -d light_remote_gold_dev -AtX -v ON_ERROR_STOP=1 -c 'SELECT max(version) FROM lr_schema_migrations')"
[[ "$v" == 35 || "$v" == 36 ]] || { echo M6_SCHEMA_35_OR_36_REQUIRED >&2; exit 3; }
t="$(runuser -u postgres -- psql -d light_remote_gold_dev -AtX -c "SELECT to_regclass('public.lr_gold_terminal_receipt_acks')")"
[[ "$t" == lr_gold_terminal_receipt_acks ]] || { echo M6_ACK_TABLE_REQUIRED >&2; exit 3; }
for unit in light-remote-gold-operator light-remote-gold-plugin light-remote-gold-wall light-remote-gold-process-supervisor; do
 [[ -f "$ROOT/$unit.service" ]] || { echo M6_UNIT_MISSING >&2; exit 3; }
 [[ ! -e "$ROOT/$unit.service.d/99-m6-candidate.conf" && ! -e "$ROOT/$unit.service.d/$OVERRIDE_NAME" ]] || { echo M6_OVERRIDE_ALREADY_PRESENT >&2; exit 3; }
done
# Historic pre-dispatch requests interrupted by Operator restart are durable
# UNKNOWN tombstones, not running workers. Retain them unchanged across cutover.
# A row is eligible for this classification ONLY when it was never dispatched,
# the durable job status agrees, and no resource claim is attached.
# Any other UNKNOWN, admitted/queued work, or live resource claim still blocks.
gate="$(runuser -u postgres -- psql -d light_remote_gold_dev -AtX -F '|' -v ON_ERROR_STOP=1 -c "
WITH work AS (
 SELECT w.job_id,
   (w.state='unknown'
    AND w.started_at IS NULL
    AND w.queue_reason IN ('QUEUED_AGENT_SLOT','RESOURCE_LOCKED')
    AND w.disposition='operator_restart_reconcile'
    AND j.status='interrupted'
    AND NOT EXISTS (
      SELECT 1 FROM lr_gold_device_resource_claims c
      WHERE c.job_id=w.job_id AND c.account_id=w.account_id AND c.device_id=w.device_id
    )) AS retained_pre_dispatch_unknown
 FROM lr_gold_personal_agent_work w
 LEFT JOIN lr_gold_job_records j
   ON j.job_id=w.job_id AND j.account_id=w.account_id AND j.device_id=w.device_id
 WHERE w.state<>'finished'
)
SELECT
  (SELECT count(*) FROM lr_gold_device_resource_claims)
    + count(*) FILTER (WHERE NOT retained_pre_dispatch_unknown),
  count(*) FILTER (WHERE retained_pre_dispatch_unknown)
FROM work;")"
IFS='|' read -r active historical_unknown <<< "$gate"
[[ "$active" =~ ^[0-9]+$ && "$historical_unknown" =~ ^[0-9]+$ ]] || { echo M6_PG_GATE_INVALID >&2; exit 4; }
echo "M6_RETAINED_PRE_DISPATCH_UNKNOWN:$historical_unknown"
[[ "$active" == 0 ]] || { echo "M6_PG_WORK_BUSY:$active" >&2; exit 4; }
node - "$SOCKET" <<'JS'
const http=require('node:http');
const req=http.get({socketPath:process.argv[2],path:'/v1/fleet',timeout:4000},res=>{
 let text='';res.on('data',v=>text+=v);res.on('end',()=>{
  try{
   const obj=JSON.parse(text),nodes=obj.nodes||[];
   if(res.statusCode!==200||obj.ok!==true)throw Error('unhealthy');
   if(obj.requireExecutorReady!==true)throw Error('strict_admission_changed');
   if(nodes.some(n=>Number(n.activeSessions)||Number(n.inFlightCommands)||Number(n.queuedCommands)))
    throw Error('session_or_job_active');
   const leaves=nodes.filter(n=>n.mode==='outbound-leaf');
   if(leaves.length!==2||leaves.some(n=>!n.executorReady||!n.channelFresh||n.draining))
    throw Error('leaf_unready');
   console.log('M6_UAT_FLEET_IDLE=PASS');
  }catch(e){console.error('M6_FLEET_GATE_DENIED:'+e.message);process.exitCode=4;}
 });
});
req.on('timeout',()=>req.destroy(Error('timeout')));
req.on('error',e=>{console.error('M6_FLEET_GATE_DENIED:'+e.message);process.exitCode=4;});
JS
echo M6_UAT_PREFLIGHT=PASS
if [[ ! -v GOLD_M6_CUTOVER_MODE || "$GOLD_M6_CUTOVER_MODE" != apply ]]; then
 echo M6_PREFLIGHT_ONLY_NO_MUTATIONS=PASS
 exit 0
fi
[[ -v GOLD_M6_CUTOVER_OPT_IN && "$GOLD_M6_CUTOVER_OPT_IN" == 1 ]] || { echo M6_EXPLICIT_OPT_IN_REQUIRED >&2; exit 2; }
PREIMAGE="$BACKUP/m6-units-before-cutover.tgz"
[[ ! -e "$PREIMAGE" ]] || { echo M6_PREIMAGE_EXISTS >&2; exit 3; }
tar -C "$ROOT" -czf "$PREIMAGE" \
 light-remote-gold-operator.service light-remote-gold-operator.service.d \
 light-remote-gold-plugin.service light-remote-gold-plugin.service.d \
 light-remote-gold-wall.service light-remote-gold-wall.service.d \
 light-remote-gold-process-supervisor.service light-remote-gold-process-supervisor.service.d
(cd "$BACKUP" && sha256sum m6-units-before-cutover.tgz >> SHA256SUMS.txt && sha256sum -c SHA256SUMS.txt >/dev/null)
changed=0
ordered_restart(){
 systemctl stop light-remote-gold-wall || :
 systemctl stop light-remote-gold-plugin || :
 systemctl stop light-remote-gold-process-supervisor || :
 systemctl restart light-remote-gold-operator
 systemctl start light-remote-gold-process-supervisor
 systemctl start light-remote-gold-plugin
 systemctl start light-remote-gold-wall
}
rollback(){
 if [[ "$changed" != 1 ]]; then return; fi
 echo M6_ROLLBACK_BEGIN >&2
 for unit in light-remote-gold-operator light-remote-gold-plugin light-remote-gold-wall light-remote-gold-process-supervisor; do
  rm -f "$ROOT/$unit.service.d/$OVERRIDE_NAME"
 done
 systemctl daemon-reload
 if ordered_restart; then echo M6_PREVIOUS_UNITS_RESTORED >&2
 else echo M6_ROLLBACK_MANUAL_ATTENTION_REQUIRED >&2; fi
}
trap rollback EXIT
for pair in 'operator:operator-host/executor.mjs' 'plugin:plugin-server/server.mjs' 'wall:device-agent/operator-agent.mjs daemon' 'process-supervisor:device-agent/process-supervisor.mjs'; do
 IFS=: read -r name entry <<< "$pair"
 unit="light-remote-gold-$name"
 printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=/usr/bin/node %s/%s\n' "$TARGET" "$TARGET" "$entry" > "$ROOT/$unit.service.d/$OVERRIDE_NAME"
done
changed=1
systemctl daemon-reload
ordered_restart
verify(){
 for unit in light-remote-gold-operator light-remote-gold-plugin light-remote-gold-wall light-remote-gold-process-supervisor; do
  systemctl is-active --quiet "$unit" || return 1
 done
 for pair in 'operator:operator-host/executor.mjs' 'plugin:plugin-server/server.mjs' 'wall:device-agent/operator-agent.mjs' 'process-supervisor:device-agent/process-supervisor.mjs'; do
  IFS=: read -r name entry <<< "$pair"
  systemctl show "light-remote-gold-$name" -p ExecStart --value | grep -F "$TARGET/$entry" >/dev/null || return 1
 done
 curl -fsS --max-time 4 --unix-socket "$SOCKET" http://localhost/v1/fleet | node -e '
 let text="";process.stdin.on("data",v=>text+=v);process.stdin.on("end",()=>{
 try{const o=JSON.parse(text);if(!o.ok||o.requireExecutorReady!==true)process.exitCode=1;}
 catch{process.exitCode=1}
 });' || return 1
}
stable=0
for i in {1..35}; do
 if verify; then stable=$((stable+1)); else stable=0; fi
 if [[ "$stable" -ge 10 ]]; then break; fi
 sleep 1
done
[[ "$stable" -ge 10 ]] || { echo M6_STABLE_HEALTH_FAILED >&2; exit 5; }
changed=0
trap - EXIT
echo M6_FOUR_SERVICE_CUTOVER=PASS
echo M6_STABLE_HEALTH=PASS
echo "M6_SOURCE_SHA=$SHA"
