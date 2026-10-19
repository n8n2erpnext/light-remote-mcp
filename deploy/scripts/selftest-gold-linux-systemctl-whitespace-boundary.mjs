import assert from 'node:assert/strict';
import {createLinuxAdapter} from '../../device-agent/platform-adapters/linux.mjs';
import {inferOutboundExecCapabilities} from '../../operator-host/outbound-exec-capabilities.mjs';

// Security/regression only: strings are classified, NEVER executed.
const adapter=createLinuxAdapter({commandExists:()=>false});
const permitted=[
  'systemctl is-active docker',
  'systemctl status docker.service',
  'sudo -n systemctl is-enabled docker',
  'systemctl\tis-active\tdocker',
  '  systemctl is-active docker  ',
];
const mustRequireDocker=[
  'systemctl is-active\ndocker',
  'systemctl\nis-active docker',
  'systemctl is-active\r\ndocker',
  'systemctl is-active\rdocker',
  'systemctl is-active\v docker',
  'systemctl is-active\f docker',
  'systemctl is-active\ndocker ps',
  '\nsystemctl is-active docker\ndocker ps',
  'sudo -n systemctl is-active\ndocker',
  'sudo -n systemctl\nis-active docker',
  'systemctl is-enabled\ndocker',
  'systemctl status\ndocker',
  'systemctl is-active docker\ndocker',
  'systemctl is-active docker; docker ps',
  'systemctl is-active docker && docker ps',
  'systemctl is-active docker$(docker ps)',
  'systemctl is-active docker `docker ps`',
];
let n=0;
for(const script of permitted){
  const leaf=adapter.inferRequiredCapabilities(script);
  assert.equal(leaf.includes('docker'),false,'literal harmless status query must not need Docker: '+JSON.stringify(script));
  assert.ok(leaf.includes('systemctl'));
  assert.deepEqual(inferOutboundExecCapabilities(script,{platform:'linux',declared:['filesystem']}),leaf);
  n++;
}
for(const script of mustRequireDocker){
  const leaf=adapter.inferRequiredCapabilities(script);
  assert.ok(leaf.includes('docker'),'must retain Docker when shell separators/expansions appear: '+JSON.stringify(script));
  assert.deepEqual(inferOutboundExecCapabilities(script,{platform:'linux',declared:['filesystem']}),leaf);
  n++;
}
console.log('G1_LINUX_SYSTEMCTL_WHITESPACE_BOUNDARY_PASS cases='+n);
