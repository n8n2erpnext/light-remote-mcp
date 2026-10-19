import assert from 'node:assert/strict';
import {createLinuxAdapter} from '../../device-agent/platform-adapters/linux.mjs';
import {inferOutboundExecCapabilities} from '../../operator-host/outbound-exec-capabilities.mjs';
import {leafCapabilityAdmission} from '../../operator-host/leaf-capability-admission.mjs';

const adapter=createLinuxAdapter({commandExists:()=>false});
const readonly=[
  'journalctl -u docker',
  'journalctl -u docker.service',
  'journalctl --unit docker',
  'journalctl --unit=docker',
  '/usr/bin/journalctl -u docker',
  'sudo -n journalctl -u docker',
  '/usr/bin/sudo -n /usr/bin/journalctl -u docker.service',
  'journalctl --no-pager -u docker',
  'journalctl -u docker --no-pager',
  'journalctl -n 10 -u docker',
  'journalctl -u docker -n 10',
  'journalctl --unit=docker.service --no-pager',
];
const conservative=[
  'docker ps',
  'journalctl -u docker; docker ps',
  'journalctl -u docker && docker ps',
  'journalctl -u docker || docker ps',
  'journalctl -u docker | docker ps',
  'journalctl -u docker\ndocker ps',
  'journalctl -u docker$(docker ps)',
  'journalctl -u docker $(docker ps)',
  'journalctl -u docker `docker ps`',
  'journalctl -u docker # comment',
  'journalctl -u docker --vacuum-time=1s',
  'journalctl -u docker --rotate',
  'journalctl -u docker --follow',
  'journalctl -u docker -f',
  'journalctl -u docker > /tmp/fixture',
  'journalctl -u docker 2>/dev/null',
  'journalctl -u docker -n $(docker ps)',
  'journalctl -u docker --no-pager; printf ready',
  'journalctl -u docker --no-pager && :',
  'journalctl --unit=docker | docker ps',
  'journalctl --unit=docker$(docker ps)',
  'sh -c "journalctl -u docker"',
  'bash -lc "journalctl -u docker"',
  'printf "journalctl -u docker"',
  'journalctl -u "docker"',
  "journalctl -u 'docker'",
  'journalctl --unit=$UNIT docker',
  'journalctl --unit docker --output=json',
];
function required(script) {
  const a=adapter.inferRequiredCapabilities(script);
  const b=inferOutboundExecCapabilities(script,{platform:'linux',declared:['filesystem']});
  assert.deepEqual(a,b,'Operator/Agent mismatch: '+script);
  return a;
}
for(const script of readonly){
  const actual=required(script);
  assert.equal(actual.includes('docker'),false,'journalctl readonly unit argument should not require Docker: '+script);
  assert.equal(actual.includes('systemctl'),true,'journalctl still needs systemctl: '+script);
}
for(const script of conservative)assert.equal(required(script).includes('docker'),true,'conservative Docker detection must stay: '+script);
const explicit=inferOutboundExecCapabilities('journalctl -u docker',{platform:'linux',declared:['filesystem','docker']});
assert.ok(explicit.includes('docker'),'explicitly requested Docker authority must not be removed');
const accepted=leafCapabilityAdmission({reported:['filesystem','systemctl'],approved:['filesystem','systemctl'],required:required('journalctl -u docker')});
assert.deepEqual(accepted.missingCapabilities,[],'authorized journal query should not need Docker');
const denied=leafCapabilityAdmission({reported:['filesystem','systemctl'],approved:['filesystem','systemctl'],required:required('journalctl -u docker; docker ps')});
assert.deepEqual(denied.missingCapabilities,['docker'],'command chaining must still require Docker');
console.log('G1_JOURNALCTL_UNIT_NAME_CAPABILITY=PASS cases='+(readonly.length+conservative.length));
