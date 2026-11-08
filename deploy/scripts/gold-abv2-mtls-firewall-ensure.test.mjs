import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const script=read('./gold-abv2-mtls-firewall-ensure.sh');
const service=read('./gold-abv2-mtls-firewall-ensure.service');
const timer=read('./gold-abv2-mtls-firewall-ensure.timer');

test('GoldABV2 firewall keeper only manages exact Traefik to mTLS bridge',()=>{
 assert.match(script,/readonly BRIDGE=br-2b4f73f607d5/);
 assert.match(script,/readonly SOURCE=172\.30\.0\.10\/32/);
 assert.match(script,/readonly DEST=172\.30\.0\.1\/32/);
 assert.match(script,/readonly PORT=15584/);
 assert.match(script,/test|port/);
 assert.match(script,/--dport "\$PORT" -j ACCEPT/);
 assert.doesNotMatch(script,/-F INPUT|iptables -F|iptables -X|iptables-restore|nft flush/);
 assert.doesNotMatch(script,/remount|mount -o|\/etc\/iptables\/rules/);
});
test('keeper checks current mTLS route and real Traefik container IP before any changes',()=>{
 assert.ok(script.indexOf("lb['servers']==[{'url':'https://172.30.0.1:15584'}]")>=0);
 assert.match(script,/goldabv2-public-mtls/);
 assert.match(script,/docker inspect/);
 assert.match(script,/172\.30\.0\.10/);
 assert.match(script,/lxc config device show/);
 const insert=script.indexOf('iptables -I INPUT 1');
 assert.ok(insert>script.indexOf('docker inspect'));
 assert.ok(insert>script.indexOf('lxc config device show'));
});
test('keeper is idempotent, only inserts a missing exact rule',()=>{
 assert.match(script,/iptables -C INPUT/);
 assert.match(script,/GOLDABV2_MTLS_RULE_PRESENT/);
 assert.match(script,/GOLDABV2_MTLS_RULE_RESTORED_EXACT_SCOPE/);
 assert.match(script,/sudo -n \/usr\/sbin\/iptables/);
});
test('lingering user systemd timer is enabled by design and repeatedly checks after boot',()=>{
 assert.match(timer,/OnBootSec=45s/);
 assert.match(timer,/OnUnitActiveSec=75s/);
 assert.match(timer,/WantedBy=timers\.target/);
 assert.match(timer,/Unit=goldabv2-lab-mtls-firewall-ensure\.service/);
 assert.match(service,/Type=oneshot/);
 assert.match(service,/ExecStart=\/home\/ubuntu\/\.local\/bin\/goldabv2-lab-mtls-firewall-ensure\.sh/);
});
test('non-silent startup remains bounded and does not edit platform service units',()=>{
 assert.match(service,/TimeoutStartSec=25s/);
 assert.doesNotMatch(script,/systemctl (restart|stop|disable)/);
 assert.doesNotMatch(script,/sudo -n\s+(?:\/usr\/bin\/)?(?:systemctl|install|cp|rm)\b/);
});
