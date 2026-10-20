#!/usr/bin/env bash
# Transactional UAT-only source cutover, retaining original service units,
# original active code, original local state and verified backup for rollback.
# Never target production. Strict Executor admission remains OFF until leaves
# independently prove readiness.
set -euo pipefail
umask 077
SHA="${G3_GOLD_SOURCE_SHA:?SHA required}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ "${G3_GOLD_CUTOVER:-}" == "1" ]] || { echo G3_GOLD_CUTOVER_OPT_IN_REQUIRED >&2;exit 2; }
ROOT="/opt/light-remote-gold-uat-candidates/$SHA"
BACKUP="/var/backups/light-remote-gold-uat/pre-g3-$SHA"
SOCK="/run/light-remote-gold-uat/operator.sock"
UNIT_ROOT="/etc/systemd/system"
SERVICES=(light-remote-gold-operator light-remote-gold-plugin light-remote-gold-wall)
if [[ ! -f "$ROOT/.git-source-sha" || "$(cat "$ROOT/.git-source-sha")" != "$SHA" ]];then echo G3_GOLD_CANDIDATE_MISSING >&2;exit 3;fi
if [[ ! -s "$BACKUP/SHA256SUMS.txt" ]];then echo G3_GOLD_VERIFIED_BACKUP_REQUIRED >&2;exit 3;fi
(cd "$BACKUP" && sha256sum -c SHA256SUMS.txt >/dev/null)
if [[ ! -d "$ROOT/node_modules" || ! -d "$ROOT/plugin-server/node_modules" || ! -d "$ROOT/secrets" ]];then echo G3_GOLD_CANDIDATE_RUNTIME_MISSING >&2;exit 3;fi
# Assert package resolution under the actual unprivileged systemd account.
if ! runuser -u gold-uat -- node -e 'require.resolve("express",{paths:[process.argv[1]+"/plugin-server"]})' "$ROOT" >/dev/null;then
  echo G3_GOLD_PLUGIN_DEPENDENCIES_UNRESOLVED >&2;exit 3
fi
if ! runuser -u gold-uat -- sh -c 'cd "$1" && node --check operator-host/executor.mjs && node --check plugin-server/server.mjs && test -r secrets/pg_app.url' -- "$ROOT";then
  echo G3_GOLD_SERVICE_USER_SOURCE_ACCESS_DENIED >&2;exit 3
fi
# Zero active runtime work gate. No other device may be implicitly switched.
node - "$SOCK" <<'JS'
const http=require('node:http');
const sock=process.argv[2];
const req=http.get({socketPath:sock,path:'/v1/fleet',timeout:3000},res=>{
 let out='';res.on('data',x=>out+=x);res.on('end',()=>{
  try{
   const value=JSON.parse(out),nodes=value.nodes||[];
   if(res.statusCode!==200||!value.ok)throw Error('fleet_not_healthy');
   const inflight=nodes.reduce((sum,node)=>sum+(Number(node.inFlightCommands)||0),0);
   const queued=nodes.reduce((sum,node)=>sum+(Number(node.queuedCommands)||0),0);
   const sessions=nodes.reduce((sum,node)=>sum+(Number(node.activeSessions)||0),0);
   if(inflight||queued||sessions)throw Error('active_jobs_or_sessions');
   console.log('G3_GOLD_CUTOVER_NO_ACTIVE_JOBS=PASS');
  }catch(e){console.error('G3_GOLD_CUTOVER_PREFLIGHT_DENIED:'+e.message);process.exitCode=4;}
 });
});
req.on('timeout',()=>req.destroy(Error('fleet_timeout')));
req.on('error',e=>{console.error('G3_GOLD_CUTOVER_PREFLIGHT_DENIED:'+e.message);process.exitCode=4;});
JS
for service in "${SERVICES[@]}";do
 [[ -f "$UNIT_ROOT/$service.service" ]]||{ echo "G3_GOLD_UNKNOWN_UNIT:$service" >&2;exit 3; }
done
if find "$UNIT_ROOT" -path '*/90-g3-candidate.conf' | grep -q .;then echo G3_GOLD_CUTOVER_OVERRIDE_ALREADY_PRESENT >&2;exit 3;fi
function validate(){
  for service in "${SERVICES[@]}";do
    if ! systemctl is-active --quiet "$service";then echo "G3_GOLD_VALIDATE_UNIT_INACTIVE:$service" >&2;return 1;fi
  done
  local answer
  if ! answer="$(curl -fsS --max-time 4 --unix-socket "$SOCK" http://localhost/v1/fleet 2>/dev/null)";then
    echo G3_GOLD_VALIDATE_IPC_UNAVAILABLE >&2;return 1
  fi
  if ! printf '%s' "$answer" | node -e "
    let text='';process.stdin.on('data',v=>text+=v);process.stdin.on('end',()=>{
      try{
        const j=JSON.parse(text);
        if(!j.ok||!Array.isArray(j.nodes)){console.error('G3_GOLD_VALIDATE_FLEET_CONTRACT');process.exitCode=1;}
        else if(j.requireExecutorReady!==false){console.error('G3_GOLD_VALIDATE_STRICT_VALUE_MISMATCH');process.exitCode=1;}
      }catch{console.error('G3_GOLD_VALIDATE_INVALID_JSON');process.exitCode=1;}
    })";then return 1;fi
  for pair in 'operator:operator-host/executor.mjs' 'plugin:plugin-server/server.mjs' 'wall:device-agent/operator-agent.mjs';do
    local entry="${pair#*:}" unit="light-remote-gold-${pair%%:*}"
    local invocation
    invocation="$(systemctl show "$unit" -p ExecStart --value)"
    if ! grep -F "$ROOT/$entry" <<<"$invocation" >/dev/null;then
      echo "G3_GOLD_VALIDATE_ENTRYPOINT_MISMATCH:$unit" >&2;return 1
    fi
    if [[ "$unit" == "light-remote-gold-wall" ]] && ! grep -Eq 'operator-agent\.mjs daemon([ ;}]|$)' <<<"$invocation";then
      echo G3_GOLD_VALIDATE_WALL_DAEMON_ARG_MISSING >&2;return 1
    fi
  done
  return 0
}
function startOrdered(){
  systemctl stop light-remote-gold-wall || :
  systemctl stop light-remote-gold-plugin || :
  systemctl restart light-remote-gold-operator
  local ready=0
  for attempt in {1..20};do
    if systemctl is-active --quiet light-remote-gold-operator &&
      curl -fsS --max-time 2 --unix-socket "$SOCK" http://localhost/v1/fleet >/dev/null 2>&1;then ready=1;break;fi
    sleep 1
  done
  [[ "$ready" == "1" ]]||{ echo G3_GOLD_OPERATOR_NOT_READY >&2;return 1; }
  systemctl start light-remote-gold-plugin
  ready=0
  for attempt in {1..20};do
    if systemctl is-active --quiet light-remote-gold-plugin &&
      ss -lnt | grep -qE ':(5583)[[:space:]]';then ready=1;break;fi
    sleep 1
  done
  [[ "$ready" == "1" ]]||{ echo G3_GOLD_PLUGIN_NOT_READY >&2;return 1; }
  systemctl start light-remote-gold-wall
}
function rollback(){
  echo G3_GOLD_CUTOVER_HEALTH_FAILED_ROLLING_BACK >&2
  for service in "${SERVICES[@]}";do
    rm -f "$UNIT_ROOT/$service.service.d/90-g3-candidate.conf"
  done
  systemctl daemon-reload
  if startOrdered;then echo G3_GOLD_ROLLBACK_OLD_UNITS_RESTORED;else echo G3_GOLD_ROLLBACK_REQUIRES_ATTENTION >&2;fi
}
rollbackOnExit=1
trap 'if [[ "$rollbackOnExit" == "1" ]];then rollback;fi' EXIT
for pair in 'operator:operator-host/executor.mjs' 'plugin:plugin-server/server.mjs' 'wall:device-agent/operator-agent.mjs';do
  name="${pair%%:*}" entry="${pair#*:}" unit="light-remote-gold-${pair%%:*}"
  mkdir -p "$UNIT_ROOT/$unit.service.d"
  extra_args=""
  # Gold Wall is a daemon service, not the CLI default status command.
  if [[ "$unit" == "light-remote-gold-wall" ]]; then extra_args=" daemon"; fi
  cat > "$UNIT_ROOT/$unit.service.d/90-g3-candidate.conf" <<CONF
[Service]
WorkingDirectory=$ROOT
ExecStart=
ExecStart=/usr/bin/node $ROOT/$entry$extra_args
CONF
done
systemctl daemon-reload
if ! startOrdered;then exit 5;fi
# One instantaneous health check is not enough: the UAT Wall is PartOf
# both Operator and Plugin and can be stopped asynchronously afterwards.
# Require 10 consecutive 1s health observations before accepting cutover.
stable=0
for attempt in {1..35};do
  if validate;then stable=$((stable+1));else stable=0;fi
  if [[ "$stable" -ge 10 ]];then break;fi
  sleep 1
done
if [[ "$stable" -lt 10 ]];then
  echo G3_GOLD_STABLE_HEALTH_WINDOW_FAILED >&2
  exit 5
fi
rollbackOnExit=0
trap - EXIT
echo "G3_GOLD_CANDIDATE_CUTOVER=PASS"
echo "G3_GOLD_STABLE_HEALTH_10_SAMPLES=PASS"
echo "G3_GOLD_OPERATOR_SOURCE_SHA=$SHA"
echo "G3_GOLD_STRICT_ADMISSION=OFF_FOR_LEGACY_COMPATIBILITY"
echo "G3_GOLD_ROLLBACK_OVERRIDES=90-g3-candidate.conf"
