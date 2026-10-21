#!/usr/bin/env bash
# Explicit Gold LXD UAT-only opt-in: short stdout with completed exec.
# Does not change production plugin, other device, Operator or strict policy.
set -euo pipefail
umask 077
[[ "$(hostname)" == "light-remote-gold-uat" ]] || { echo G3_INLINE_NOT_GOLD_UAT >&2;exit 2; }
[[ "${G3_INLINE_OPT_IN:-}" == "1" ]] || { echo G3_INLINE_EXPLICIT_OPT_IN_REQUIRED >&2;exit 2; }
SHA="${G3_GOLD_SOURCE_SHA:?SHA required}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
ROOT="/opt/light-remote-gold-uat-candidates/$SHA"
[[ -r "$ROOT/plugin-server/exec-inline-output.mjs" && "$(cat "$ROOT/.git-source-sha")" == "$SHA" ]] || { echo G3_INLINE_SOURCE_MISMATCH >&2;exit 3; }
systemctl show light-remote-gold-plugin -p ExecStart --value | grep -F "$ROOT/plugin-server/server.mjs" >/dev/null || { echo G3_INLINE_ACTIVE_PLUGIN_MISMATCH >&2;exit 3; }
systemctl is-active --quiet light-remote-gold-operator
systemctl is-active --quiet light-remote-gold-plugin
systemctl is-active --quiet redis-server
systemctl is-active --quiet postgresql@17-main
systemctl is-active --quiet light-remote-gold-wall
node - <<'JS'
const http=require('node:http');
http.get({socketPath:'/run/light-remote-gold-uat/operator.sock',path:'/v1/fleet',timeout:3500},res=>{
  let s='';res.on('data',d=>s+=d).on('end',()=>{
   try{
    const f=JSON.parse(s),n=f.nodes||[],leaves=n.filter(x=>x.mode==='outbound-leaf'),sum=k=>n.reduce((v,x)=>v+(Number(x[k])||0),0);
    if(!f.ok||f.requireExecutorReady!==true||leaves.length!==2||leaves.some(x=>x.channelFresh!==true||x.executorReady!==true)||
       sum('activeSessions')||sum('queuedCommands')||sum('inFlightCommands'))throw Error('gold_not_idle_ready_strict');
    console.log('G3_GOLD_INLINE_PREFLIGHT=PASS');
   }catch(e){console.error('G3_GOLD_INLINE_PREFLIGHT_FAIL:'+e.message);process.exitCode=4;}
  });
}).on('error',()=>{process.exitCode=4});
JS
DROPIN="/etc/systemd/system/light-remote-gold-plugin.service.d/96-g3-inline-stdout.conf"
[[ ! -e "$DROPIN" ]] || { echo G3_INLINE_ALREADY_CONFIGURED >&2;exit 3; }
BACKUP="/var/backups/light-remote-gold-uat/pre-inline-$SHA"
[[ ! -e "$BACKUP" ]] || { echo G3_INLINE_BACKUP_ALREADY_EXISTS >&2;exit 3; }
install -d -m 0700 "$BACKUP"
systemctl cat light-remote-gold-plugin > "$BACKUP/plugin-unit-before.txt"
sha256sum "$BACKUP/plugin-unit-before.txt" > "$BACKUP/SHA256SUMS.txt"
(cd "$BACKUP" && sha256sum -c SHA256SUMS.txt >/dev/null)
echo G3_GOLD_INLINE_PLUGIN_UNIT_BACKUP=PASS
function rollback() {
 echo G3_GOLD_INLINE_ROLLBACK_START >&2
 rm -f "$DROPIN"
 systemctl daemon-reload
 systemctl restart light-remote-gold-plugin || :
 if systemctl is-active --quiet light-remote-gold-plugin;then echo G3_GOLD_INLINE_ROLLBACK_PLUGIN_ACTIVE=PASS
 else echo G3_GOLD_INLINE_ROLLBACK_NEEDS_ATTENTION >&2;fi
}
trap rollback EXIT
cat > "$DROPIN" <<'CONF'
[Service]
Environment=LIGHT_REMOTE_GOLD_INLINE_STDOUT_DEFAULT=1
CONF
chmod 0644 "$DROPIN"
systemctl daemon-reload
systemctl restart light-remote-gold-plugin
success=0
for i in {1..45};do
 if systemctl is-active --quiet light-remote-gold-plugin &&
    systemctl show light-remote-gold-plugin -p Environment --value | grep -q LIGHT_REMOTE_GOLD_INLINE_STDOUT_DEFAULT=1 &&
    [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 http://10.192.135.61:5583/health)" == "403" ]];then
    success=$((success+1))
 else
    success=0
 fi
 if ((success>=10));then break;fi
 sleep 1
done
((success>=10)) || { echo G3_GOLD_INLINE_HEALTH_FAILED >&2;exit 4; }
trap - EXIT
echo G3_GOLD_INLINE_STDOUT_AUTO_ENABLED=PASS
echo G3_GOLD_INLINE_PLUGIN_HEALTH_10_SAMPLES=PASS
echo "G3_GOLD_INLINE_SOURCE_SHA=$SHA"
