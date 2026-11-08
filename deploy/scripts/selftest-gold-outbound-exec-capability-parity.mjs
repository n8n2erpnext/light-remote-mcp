import assert from 'node:assert/strict';
import {createPlatformAdapter} from '../../device-agent/platform-adapters/index.mjs';
import {inferOutboundExecCapabilities} from '../../operator-host/outbound-exec-capabilities.mjs';
import {leafCapabilityAdmission} from '../../operator-host/leaf-capability-admission.mjs';
import {FleetRouter} from '../../operator-host/fleet-router.mjs';

const cases=[
 {platform:'linux',script:'docker ps --format json',want:['docker','filesystem']},
 {platform:'linux',script:'lxc list',want:['filesystem','lxd']},
 // Scoped whole-command status-only service query is not a Docker executable.
 {platform:'linux',script:'sudo -n systemctl is-active docker',want:['filesystem','sudo-on-demand','systemctl']},
 {platform:'linux',script:'/usr/bin/docker info',want:['docker','filesystem']},
 {platform:'linux',script:'git status',want:['filesystem','git']},
 {platform:'linux',script:'printf ready',want:['filesystem']},
 {platform:'darwin',script:'/opt/homebrew/bin/docker ps',want:['docker','filesystem']},
 {platform:'darwin',script:'launchctl list',want:['filesystem','macos-services']},
 {platform:'darwin',script:'printf ready',want:['filesystem']},
 {platform:'win32',script:'Get-Service Spooler',want:['filesystem','powershell','windows-services']},
 {platform:'win32',script:'Get-Service Spooler',shell:'cmd',want:['filesystem','terminal','windows-services']},
 {platform:'win32',script:'docker ps',shell:'cmd',want:['docker','filesystem','terminal']},
 {platform:'win32',script:'Get-Process',want:['filesystem','powershell','windows-process-network']},
];
for(const row of cases){
 const shell=row.shell||'default';
 const out=inferOutboundExecCapabilities(row.script,{platform:row.platform,shell,declared:['filesystem']});
 const local=createPlatformAdapter({platform:row.platform,commandExists:()=>false}).inferRequiredCapabilities(row.script,{shell});
 assert.deepEqual(out,local,'Operator and leaf must agree: '+JSON.stringify(row));
 assert.deepEqual(out,row.want,'unexpected required caps: '+JSON.stringify(row));
}
assert.deepEqual(inferOutboundExecCapabilities('docker ps',{platform:'unknown',declared:['filesystem']}),['filesystem'],'unknown platform unchanged, leaf remains final gate');
const noPrivilegeEscape=inferOutboundExecCapabilities('docker ps',{platform:'linux',declared:['filesystem']});
const fleet=new FleetRouter({now:()=>1000});
fleet.touch({accountId:'acct_test',deviceId:'dev_test',nodeId:'node_test',capabilities:['filesystem'],policyRevision:2});
const current=fleet.assertRoutable('node_test',{accountId:'acct_test',deviceId:'dev_test'});
const denial=leafCapabilityAdmission({reported:current.capabilities,approved:['filesystem','docker'],required:noPrivilegeEscape});
assert.deepEqual(denial.missingCapabilities,['docker'],'preflight rejects before a doomed remote job');
assert.deepEqual(denial.missingCapabilityReasons,{docker:'agent_not_advertising'});
const allowed=leafCapabilityAdmission({reported:['filesystem','docker'],approved:['filesystem','docker'],required:noPrivilegeEscape});
assert.deepEqual(allowed.missingCapabilities,[],'authorized command retains existing route');
console.log('G1_OUTBOUND_EXEC_PLATFORM_CAPABILITY_PARITY=PASS cases='+cases.length);
