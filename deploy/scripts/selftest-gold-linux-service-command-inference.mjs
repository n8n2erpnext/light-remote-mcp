import assert from 'node:assert/strict';
import {createLinuxAdapter} from '../../device-agent/platform-adapters/linux.mjs';
import {inferOutboundExecCapabilities} from '../../operator-host/outbound-exec-capabilities.mjs';
import {leafCapabilityAdmission} from '../../operator-host/leaf-capability-admission.mjs';

const agent=createLinuxAdapter({commandExists:()=>false});
const minimum=['filesystem','systemctl'];
const noDocker=[
  ['systemctl is-active docker',minimum],
  ['  systemctl   is-active   docker  ',minimum],
  ['systemctl status docker',minimum],
  ['systemctl is-enabled docker',minimum],
  ['/usr/bin/systemctl is-active docker',minimum],
  ['sudo -n systemctl is-active docker',['filesystem','sudo-on-demand','systemctl']],
  ['/usr/bin/sudo -n /usr/bin/systemctl status docker',['filesystem','sudo-on-demand','systemctl']],
  ['systemctl is-active docker.service',minimum],
  ['journalctl -u docker',minimum],
];
// These are NOT permitted to benefit from the exception. Command composition,
// argument expansion, shells, pipelines, comment/newline or extra options must
// remain conservatively classified; actual Docker CLI always needs Docker.
const needsDocker=[
  'docker ps',
  '/usr/bin/docker info',
  '/usr/local/bin/docker ps',
  'sudo -n docker ps',
  'systemctl is-active docker; docker ps',
  'systemctl is-active docker && docker ps',
  'systemctl is-active docker || docker ps',
  'systemctl is-active docker | docker ps',
  'systemctl is-active docker\ndocker ps',
  'systemctl is-active docker $(docker ps)',
  'systemctl is-active docker$(docker ps)',
  'systemctl is-active docker `docker ps`',
  'systemctl is-active docker # anything',
  'systemctl is-active docker 2>/dev/null',
  'systemctl is-active docker --no-pager',
  'systemctl is-active docker; printf ok',
  'systemctl is-active docker && printf ok',
  'systemctl is-active docker && :',
  'bash -lc "docker ps"',
  'sh -c "docker ps"',
  "echo 'docker ps'",
  'systemctl restart docker',
  'systemctl start docker',
  'systemctl stop docker',
  'systemctl is-active docker.service; docker ps',
  'systemctl is-active docker | cat',
  'systemctl is-active docker > /tmp/check',
];
let checked=0;
for(const [script,expected] of noDocker){
 const actual=agent.inferRequiredCapabilities(script);
 assert.deepEqual(actual,expected,'safe whole-command query: '+script);
 const op=inferOutboundExecCapabilities(script,{platform:'linux',declared:['filesystem']});
 assert.deepEqual(op,actual,'remote preflight/Agent parity: '+script);
 assert.ok(!actual.includes('docker'));
 checked++;
}
for(const script of needsDocker){
 const actual=agent.inferRequiredCapabilities(script);
 assert.ok(actual.includes('docker'),'conservative Docker requirement lost: '+script);
 const op=inferOutboundExecCapabilities(script,{platform:'linux',declared:['filesystem']});
 assert.deepEqual(op,actual,'remote preflight/Agent parity: '+script);
 checked++;
}
// Even for a narrow exemption, an explicit caller/owner requirement is never
// removed, and Fleet's capability intersection remains the final gate.
const explicit=inferOutboundExecCapabilities('systemctl is-active docker',{
 platform:'linux',declared:['filesystem','docker']});
assert.ok(explicit.includes('docker'),'must keep explicit Docker requirement');
const evidence=leafCapabilityAdmission({
 reported:['filesystem','systemctl'],
 approved:['filesystem','systemctl'],
 required:agent.inferRequiredCapabilities('systemctl is-active docker')});
assert.deepEqual(evidence.missingCapabilities,[],'status query requires no Docker authority');
const denied=leafCapabilityAdmission({
 reported:['filesystem','systemctl'],
 approved:['filesystem','systemctl'],
 required:agent.inferRequiredCapabilities('docker ps')});
assert.deepEqual(denied.missingCapabilities,['docker'],'real Docker CLI still refused');
console.log('G1_LINUX_SERVICE_NAME_DOCKER_SAFE_INFERENCE=PASS cases='+checked);
