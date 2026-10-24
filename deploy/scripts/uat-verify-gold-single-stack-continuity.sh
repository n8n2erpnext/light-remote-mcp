#!/usr/bin/env bash
# Read-only UAT acceptance gates for the ONE original Gold Account/Wall/LXD.
set -euo pipefail
INSTANCE=light-remote-gold-uat
BASE=/opt/light-remote-gold-uat-continuity-candidate
SNAP=pre-long-memory-codex-observer-20261024
[[ "$(lxc list "$INSTANCE" -c s --format csv)" == RUNNING ]]
lxc info "$INSTANCE" | grep -Fq "$SNAP"
! lxc list -c n --format csv | grep -qx 'light-remote-continuity-uat'
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-gold-plugin light-remote-gold-operator light-remote-gold-wall light-remote-gold-process-supervisor postgresql redis-server
for svc in light-remote-gold-plugin light-remote-gold-operator light-remote-gold-wall;do
 lxc exec "$INSTANCE" -- systemctl show -p ExecStart --value "$svc" | grep -Fq "$BASE"
done
lxc exec "$INSTANCE" -- bash -c '
 set -euo pipefail
 [ "$(node -p "require(\"/var/lib/light-remote-gold-uat/wall/auth.json\").mode")" = account-only ]
 node - <<"JS"
const fs=require("node:fs"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const root="/opt/light-remote-gold-uat-continuity-candidate/agent";
const m=JSON.parse(fs.readFileSync(root+"/client-core.json"));assert.equal(m.files.length,102);
for(const file of m.files){const data=fs.readFileSync(root+"/"+file.path);assert.equal(crypto.createHash("sha256").update(data).digest("hex"),file.sha256);assert.equal(data.length,file.size);}
const digest=crypto.createHash("sha256").update(m.files.map(f=>`${f.path}\0${f.sha256}\0${f.size}\n`).join("")).digest("hex");assert.equal(digest,m.digest);
const state=JSON.parse(fs.readFileSync("/var/lib/light-remote-gold-uat/wall/device.json"));assert.ok(state.enrollment?.deviceId&&state.enrollment?.accountId);
const trust=JSON.parse(fs.readFileSync("/var/lib/light-remote-gold-uat/wall/light-remote/continuity/trusted-operator-relay.json"));assert.equal(trust.accountId,state.enrollment.accountId);assert.equal(trust.deviceId,state.enrollment.deviceId);
console.log("ONE_GOLD_UAT_102_FILE_SHA256_AND_PINNED_ORIGINAL_ACCOUNT_PASS");
JS
 systemctl show -p Environment --value light-remote-gold-operator | grep -Fq LIGHT_REMOTE_CONTINUITY_OPERATOR_SIGNING_KEY_FILE=
 systemctl show -p Environment --value light-remote-gold-wall | grep -Fq LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL=1
 grep -Fq light_remote_long_memory_checkpoint /opt/light-remote-gold-uat-continuity-candidate/plugin/plugin-server/tools.mjs
'
# The host :5491 is ARM production Wall, never Gold UAT.
docker inspect light-remote-gold-wall-netbird --format '{{json .NetworkSettings.Ports}}' | grep -Fq '"HostPort":"5591"'
docker exec light-remote-gold-wall-netbird nginx -T 2>/dev/null | grep -Fq 'proxy_pass http://10.192.135.61:5491;'
[[ "$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://100.94.184.141:5591/login)" == 200 ]]
[[ "$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://100.94.184.141:5591/api/project-continuity/getGlobalModules)" == 401 ]]
[[ "$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://100.94.184.141:5591/projects)" == 303 ]]
[[ "$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -H 'Host: gold.light-remote.thaiduy.digital' http://10.192.135.61:5583/healthz)" == 200 ]]
echo 'ONE_REAL_GOLD_ACCOUNT_WALL_PLUGIN_OPERATOR_UAT_DEPLOYED_PASS'
echo 'DUPLICATE_CONTINUITY_LXD_REMOVED_AND_PREUPGRADE_SNAPSHOT_PRESENT_PASS'
