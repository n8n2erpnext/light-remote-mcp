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
# Preserve existing Gold admission policy during a source-only candidate upgrade.
G3_GOLD_EXPECT_STRICT="${G3_GOLD_EXPECT_STRICT:-0}"
[[ "$G3_GOLD_EXPECT_STRICT" == "0" || "$G3_GOLD_EXPECT_STRICT" == "1" ]] || { echo G3_GOLD_EXPECT_STRICT_INVALID >&2;exit 2; }
export G3_GOLD_EXPECT_STRICT
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
   if(value.requireExecutorReady!==(process.env.G3_GOLD_EXPECT_STRICT==='1'))throw Error('existing_strict_policy_mismatch');
   const leaves=nodes.filter(x=>x.mode==='outbound-leaf');
   if(leaves.length!==2||leaves.some(x=>x.channelFresh!==true||x.executorReady!==true))throw Error('executor_proof_not_ready');
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
# Initial cutover may start from original units; later G3 promotions may start
# from an already active immutable candidate. Never erase prior overrides
# before preserving all three as one consistent transaction preimage.
PREVIOUS_OVERRIDES="$BACKUP/previous-candidate-overrides"
previous_count=0
previous_root=""
for service in "${SERVICES[@]}";do
  override="$UNIT_ROOT/$service.service.d/90-g3-candidate.conf"
  if [[ -f "$override" ]];then
    previous_count=$((previous_count+1))
    root_line="$(sed -n 's/^WorkingDirectory=//p' "$override")"
    if [[ ! "$root_line" =~ ^/opt/light-remote-gold-uat-candidates/[a-f0-9]{40}$ ]] ||
       [[ ! -f "$root_line/.git-source-sha" ]] ||
       [[ "$(cat "$root_line/.git-source-sha")" != "${root_line##*/}" ]];then
      echo G3_GOLD_PREVIOUS_CANDIDATE_UNVERIFIED >&2;exit 3
    fi
    if [[ -n "$previous_root" && "$previous_root" != "$root_line" ]];then
      echo G3_GOLD_PREVIOUS_CANDIDATE_SPLIT >&2;exit 3
    fi
    previous_root="$root_line"
  fi
done
if [[ "$previous_count" != "0" && "$previous_count" != "${#SERVICES[@]}" ]];then
  echo G3_GOLD_PARTIAL_EXISTING_OVERRIDES >&2;exit 3
fi
if [[ "$previous_root" == "$ROOT" ]];then echo G3_GOLD_CANDIDATE_ALREADY_ACTIVE >&2;exit 3;fi
if [[ -e "$PREVIOUS_OVERRIDES" ]];then echo G3_GOLD_PREVIOUS_OVERRIDE_SNAPSHOT_EXISTS >&2;exit 3;fi
install -d -m 0700 "$PREVIOUS_OVERRIDES"
for service in "${SERVICES[@]}";do
  override="$UNIT_ROOT/$service.service.d/90-g3-candidate.conf"
  if [[ -f "$override" ]];then cp -p "$override" "$PREVIOUS_OVERRIDES/$service.conf";fi
done
echo "G3_GOLD_PREVIOUS_OVERRIDE_SNAPSHOT=PASS"

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
        else if(j.requireExecutorReady!==(process.env.G3_GOLD_EXPECT_STRICT==='1')){console.error('G3_GOLD_VALIDATE_STRICT_VALUE_MISMATCH');process.exitCode=1;}
        else {
          const leaves=j.nodes.filter(n=>n.mode==='outbound-leaf');
          if(leaves.length!==2||leaves.some(n=>n.channelFresh!==true||n.executorReady!==true)){
            console.error('G3_GOLD_VALIDATE_EXECUTOR_PROOF_MISSING');process.exitCode=1;
          }
        }
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
    override="$UNIT_ROOT/$service.service.d/90-g3-candidate.conf"
    if [[ -f "$PREVIOUS_OVERRIDES/$service.conf" ]];then
      cp -p "$PREVIOUS_OVERRIDES/$service.conf" "$override"
    else
      rm -f "$override"
    fi
  done
  systemctl daemon-reload
  if startOrdered;then echo G3_GOLD_ROLLBACK_PREVIOUS_UNITS_RESTORED;else echo G3_GOLD_ROLLBACK_REQUIRES_ATTENTION >&2;fi
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
if [[ "$G3_GOLD_EXPECT_STRICT" == "1" ]];then
  echo "G3_GOLD_STRICT_ADMISSION=ON_PRESERVED"
else
  echo "G3_GOLD_STRICT_ADMISSION=OFF_PRESERVED"
fi
echo "G3_GOLD_ROLLBACK_OVERRIDES=90-g3-candidate.conf"
