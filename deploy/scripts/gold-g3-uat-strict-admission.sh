#!/usr/bin/env bash
# Gold UAT ONLY: enable Executor-proof strict admission with guarded rollback.
# Runs inside isolated "light-remote-gold-uat" LXD as root. No production paths.
set -euo pipefail
umask 077
[[ "$(hostname)" == "light-remote-gold-uat" ]] || { echo G3_STRICT_NOT_GOLD_UAT >&2;exit 2; }
[[ "${G3_GOLD_STRICT_OPT_IN:-}" == 1 ]] || { echo G3_STRICT_OPT_IN_REQUIRED >&2;exit 2; }
SHA="${G3_GOLD_SOURCE_SHA:?expected immutable Gold source SHA}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || exit 2
ROOT="/opt/light-remote-gold-uat-candidates/$SHA"
SOCK="/run/light-remote-gold-uat/operator.sock"
OVERRIDE="/etc/systemd/system/light-remote-gold-operator.service.d/95-g3-strict-admission.conf"
BACKUP="/var/backups/light-remote-gold-uat/pre-strict-$SHA"
[[ -f "$ROOT/.git-source-sha" && "$(cat "$ROOT/.git-source-sha")" == "$SHA" ]] || { echo G3_STRICT_SOURCE_MISMATCH >&2;exit 3; }
[[ ! -e "$OVERRIDE" && ! -e "$BACKUP" ]] || { echo G3_STRICT_ALREADY_CONFIGURED_OR_BACKED_UP >&2;exit 3; }
systemctl show light-remote-gold-operator -p ExecStart --value | grep -F "$ROOT/operator-host/executor.mjs" >/dev/null || { echo G3_STRICT_ACTIVE_SOURCE_MISMATCH >&2;exit 3; }
for unit in postgresql@17-main redis-server light-remote-gold-operator light-remote-gold-plugin light-remote-gold-wall;do
  systemctl is-active --quiet "$unit" || { echo "G3_STRICT_PRECHECK_UNIT_NOT_ACTIVE:$unit" >&2;exit 3; }
done

function fleet_gate() {
  local expect="$1"
  curl -fsS --max-time 3 --unix-socket "$SOCK" http://localhost/v1/fleet |
  G3_EXPECT_STRICT="$expect" node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{
        const f=JSON.parse(s),n=f.nodes||[],a=n.filter(x=>x.mode==="outbound-leaf");
        const active=n.reduce((v,x)=>v+(Number(x.activeSessions)||0),0);
        const queued=n.reduce((v,x)=>v+(Number(x.queuedCommands)||0),0);
        const inFlight=n.reduce((v,x)=>v+(Number(x.inFlightCommands)||0),0);
        if(!f.ok||f.requireExecutorReady!==(process.env.G3_EXPECT_STRICT==="1")||
           a.length!==2||a.some(x=>x.channelFresh!==true||x.executorReady!==true)||
           active||queued||inFlight)throw Error("gold_strict_fleet_gate_failed");
      }catch(e){process.exitCode=4;}
    });'
}
fleet_gate 0 || { echo G3_STRICT_PREFLIGHT_NOT_IDLE_OR_READY >&2;exit 4; }
echo G3_STRICT_PREFLIGHT_TWO_READY_NO_WORK=PASS

install -d -m 0700 "$BACKUP"
systemctl cat light-remote-gold-operator > "$BACKUP/operator-unit-before.txt"
systemctl show light-remote-gold-operator -p ExecStart -p Environment --value |
  sed -E 's/(TOKEN|KEY|SECRET|PASSWORD)=[^ ;]+/\1=[REDACTED]/Ig' > "$BACKUP/operator-runtime-before.txt"
sha256sum "$BACKUP/operator-unit-before.txt" "$BACKUP/operator-runtime-before.txt" > "$BACKUP/SHA256SUMS.txt"
(cd "$BACKUP" && sha256sum -c SHA256SUMS.txt >/dev/null)
echo G3_STRICT_UNIT_BACKUP_VERIFIED=PASS

function restart_ordered() {
  systemctl stop light-remote-gold-wall || :
  systemctl stop light-remote-gold-plugin || :
  systemctl restart light-remote-gold-operator
  local ready=0
  for i in {1..30};do
    if systemctl is-active --quiet light-remote-gold-operator &&
       curl -fsS --max-time 2 --unix-socket "$SOCK" http://localhost/v1/fleet >/dev/null 2>&1;then ready=1;break;fi
    sleep 1
  done
  [[ "$ready" == 1 ]] || return 1
  systemctl start light-remote-gold-plugin
  systemctl start light-remote-gold-wall
}
function stable_gate() {
  local expect="$1" streak=0
  for i in {1..100};do
    if systemctl is-active --quiet postgresql@17-main &&
       systemctl is-active --quiet redis-server &&
       systemctl is-active --quiet light-remote-gold-operator &&
       systemctl is-active --quiet light-remote-gold-plugin &&
       systemctl is-active --quiet light-remote-gold-wall &&
       ss -lnt | grep -q '10.192.135.61:5583' &&
       fleet_gate "$expect";then
      streak=$((streak+1))
    else streak=0;fi
    if (( streak>=10 ));then return 0;fi
    sleep 1
  done
  return 1
}
function rollback() {
  echo G3_STRICT_HEALTH_FAILED_ROLLBACK >&2
  rm -f "$OVERRIDE"
  systemctl daemon-reload
  if restart_ordered && stable_gate 0;then echo G3_STRICT_ROLLBACK_COMPATIBILITY_RESTORED=PASS
  else echo G3_STRICT_ROLLBACK_NEEDS_ATTENTION >&2;fi
}
trap rollback EXIT
cat > "$OVERRIDE" <<'CONF'
[Service]
Environment=OPERATOR_REQUIRE_EXECUTOR_READY=1
CONF
chmod 0644 "$OVERRIDE"
systemctl daemon-reload
restart_ordered
stable_gate 1 || { echo G3_STRICT_TEN_STABLE_SAMPLES_FAILED >&2;exit 5; }
trap - EXIT
echo G3_GOLD_STRICT_ADMISSION_ENABLED=PASS
echo G3_GOLD_STRICT_STABLE_10_SAMPLES=PASS
echo "G3_GOLD_STRICT_SOURCE_SHA=$SHA"
echo "G3_GOLD_STRICT_ROLLBACK_DROPIN=$OVERRIDE"
