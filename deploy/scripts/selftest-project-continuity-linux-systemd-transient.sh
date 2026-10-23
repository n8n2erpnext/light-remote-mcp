#!/usr/bin/env bash
# Real Linux systemd ephemeral service UAT; no persistent units or Gold writes.
set -euo pipefail
[[ "$(id -u)" != 0 && "$(uname -s)" == Linux ]] || exit 2
sudo -n -u nobody id -u >/dev/null
ROOT="$(sudo -n mktemp -d /run/light-remote-continuity-uat.XXXXXX)"
SUFFIX="$(basename "$ROOT" | tr -dc a-zA-Z0-9 | cut -c1-18)"
UNIT_A="lr-cont-uat-$SUFFIX-a"
UNIT_B="lr-cont-uat-$SUFFIX-b"
UNIT_C="lr-cont-uat-$SUFFIX-c"
BROKER="$ROOT/broker"
SRC="$ROOT/device-agent"
LIB="$ROOT/lib"
cleanup(){
 sudo -n systemctl stop "$UNIT_A.service" >/dev/null 2>&1 || true
 sudo -n systemctl stop "$UNIT_B.service" >/dev/null 2>&1 || true
 sudo -n systemctl stop "$UNIT_C.service" >/dev/null 2>&1 || true
 sudo -n rm -rf -- "$ROOT" || true
}
trap cleanup EXIT
sudo -n chown "$(id -un):$(id -gn)" "$ROOT"
chmod 0755 "$ROOT"
mkdir -m 0755 "$SRC" "$LIB"
cp device-agent/project-continuity-owner-broker{,-cli}.mjs \
 device-agent/project-continuity-owner-grants.mjs device-agent/project-continuity-store.mjs \
 device-agent/project-continuity-client.mjs "$SRC/"
cp lib/project-continuity-session-proof.mjs "$LIB/"
chmod 0644 "$SRC"/*.mjs "$LIB"/*.mjs
mkdir "$BROKER"
sudo -n chown nobody:"$(id -gn)" "$BROKER"
sudo -n chmod 2710 "$BROKER"
printf '{"password":"systemd-uat-fixture-password-2026-only"}\n' \
 | sudo -n -u nobody /usr/bin/node "$SRC/project-continuity-owner-broker-cli.mjs" bootstrap --root "$BROKER" >/dev/null
[[ ! -r "$BROKER/private/continuity-owner-private.enc.json" ]]
cat > "$ROOT/uat-client.mjs" <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectContinuityRequest as req,projectContinuityOwnerConsent as owner}
 from './device-agent/project-continuity-client.mjs';
const root=process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT;
assert.equal(fs.existsSync(root+'/controller/continuity.db'),false);
assert.equal(fs.existsSync(root+'/private/continuity-owner-private.enc.json'),false);
if(process.argv[2]==='write'){
 const p=await req('createProject',{name:'Real transient systemd UAT'});
 await req('setModules',{projectId:p.id,memory:true,expectedRevision:1});
 await req('memoryPut',{projectId:p.id,body:'SYSTEMD_REAL_SERVICE_CANARY_2026',sourceRef:'owner:systemd-test'});
 assert.equal((await owner({principal:'owner',password:'systemd-uat-fixture-password-2026-only',
   projectId:p.id,enabled:true,expectedRevision:2})).remoteReadEnabled,true);
 fs.writeFileSync(process.env.UAT_ID_FILE,p.id);
 console.log('REAL_SYSTEMD_BROKER_SEPARATE_UID_MEMORY_WRITE_PASS');
}else if(process.argv[2]==='check-revoked'){
 const id=fs.readFileSync(process.env.UAT_ID_FILE,'utf8'),p=await req('getProject',{projectId:id});
 assert.equal(p.remote_read_enabled,0);
 assert.match((await req('contextBrief',{projectId:id,query:'SYSTEMD_REAL_SERVICE_CANARY_2026',
  maxChars:1600})).content,/SYSTEMD_REAL_SERVICE_CANARY_2026/);
 console.log('REAL_SYSTEMD_CRASH_RECOVERY_PERSISTED_REVOCATION_PASS');
}else{
 const id=fs.readFileSync(process.env.UAT_ID_FILE,'utf8'),p=await req('getProject',{projectId:id});
 assert.equal(p.remote_read_enabled,1);
 assert.match((await req('contextBrief',{projectId:id,query:'SYSTEMD_REAL_SERVICE_CANARY_2026',
  maxChars:1600})).content,/SYSTEMD_REAL_SERVICE_CANARY_2026/);
 await assert.rejects(req('remoteBrief',{projectId:id}),/continuity_remote_delegation_required/);
 assert.equal((await owner({principal:'owner',password:'systemd-uat-fixture-password-2026-only',
  projectId:id,enabled:false,expectedRevision:p.revision})).remoteReadEnabled,false);
 console.log('REAL_SYSTEMD_RESTART_SQLITE_CONSENT_REVOKE_PASS');
}
JS
chmod 0644 "$ROOT/uat-client.mjs"
start_service(){
 sudo -n systemd-run --system --unit "$1" --collect --no-block \
  -p User=nobody -p "Group=$(id -gn)" -p UMask=0007 \
  -p NoNewPrivileges=yes -p CapabilityBoundingSet= \
  -p ProtectSystem=strict -p ProtectHome=yes -p PrivateTmp=yes \
  -p PrivateDevices=yes -p ProtectKernelTunables=yes \
  -p ProtectKernelModules=yes -p ProtectControlGroups=yes \
  -p RestrictAddressFamilies=AF_UNIX \
  -p "ReadWritePaths=$BROKER" \
  /usr/bin/node "$SRC/project-continuity-owner-broker-cli.mjs" serve --root "$BROKER" --controller 1 --recover-stale 1 >/dev/null
}
wait_ready(){
 local pid uid i
 for i in $(seq 1 100); do
  pid="$(sudo -n systemctl show -p MainPID --value "$1.service" 2>/dev/null || true)"
  uid=""
  if [[ "$pid" =~ ^[0-9]+$ ]] && (( pid > 1 )) && [[ -r "/proc/$pid/status" ]]; then
   uid="$(awk '/^Uid:/{print $2}' "/proc/$pid/status" 2>/dev/null || true)"
  fi
  # A leftover socket from a killed process is NOT service readiness:
  # require a successful authenticated local health handshake too.
  if [[ "$uid" == 65534 && -S "$BROKER/owner-broker.sock" ]] &&
    /usr/bin/node "$SRC/project-continuity-owner-broker-cli.mjs" health --root "$BROKER" >/dev/null 2>&1; then
   [[ "$(stat -c %a "$BROKER/owner-broker.sock")" == 660 ]]
   echo 'REAL_SYSTEMD_SERVICE_UID_SOCKET_SANDBOX_PASS'
   return 0
  fi
  [[ "$(sudo -n systemctl is-failed "$1.service" 2>/dev/null || true)" != failed ]] || break
  sleep .1
 done
 echo "SYSTEMD_TRANSIENT_BROKER_NOT_READY:$1"
 sudo -n journalctl --unit "$1.service" -n 10 --no-pager --output=cat | sed -E 's/(password|privateKey):[^,}]+/[REDACTED]/g' || true
 return 1
}
export LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER=1 LIGHT_REMOTE_CONTINUITY_BROKER_ROOT="$BROKER" UAT_ID_FILE="$ROOT/id"
start_service "$UNIT_A"
wait_ready "$UNIT_A"
node "$ROOT/uat-client.mjs" write
sudo -n systemctl stop "$UNIT_A.service"
for i in $(seq 1 50); do [[ ! -S "$BROKER/owner-broker.sock" ]] && break; sleep .1; done
[[ ! -S "$BROKER/owner-broker.sock" ]]
start_service "$UNIT_B"
wait_ready "$UNIT_B"
node "$ROOT/uat-client.mjs" read
# Crash the actual service and require inode-checked orphan socket recovery.
sudo -n systemctl kill --signal=KILL "$UNIT_B.service"
for i in $(seq 1 40); do
 [[ "$(sudo -n systemctl show -p MainPID --value "$UNIT_B.service")" == 0 ]] && break
 sleep .1
done
[[ -S "$BROKER/owner-broker.sock" ]]
start_service "$UNIT_C"
wait_ready "$UNIT_C"
node "$ROOT/uat-client.mjs" check-revoked
sudo -n systemctl stop "$UNIT_C.service"
echo 'REAL_SYSTEMD_SIGKILL_ORPHAN_SOCKET_RECOVERY_PASS'
echo 'REAL_LINUX_SERVER_TRANSIENT_NO_PERSISTENT_UNITS_PASS'
