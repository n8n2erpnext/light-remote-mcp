import assert from 'node:assert/strict';
import {CONTINUITY_PLATFORMS,continuityPlatformContract} from '../../device-agent/project-continuity-platform-contract.mjs';
import {ownerBrokerEndpoint} from '../../device-agent/project-continuity-owner-broker.mjs';

assert.deepEqual(Object.keys(CONTINUITY_PLATFORMS).sort(),['darwin','linux-desktop','linux-server','win32'].sort());
for(const platform of ['win32','linux','darwin']){
 for(const desktop of platform==='linux'?[false,true]:[false]){
  const c=continuityPlatformContract(platform,{desktop});
  assert.deepEqual(c.defaultModules,{memory:false,codex:false});
  assert.equal(c.ownerBrokerRequired,true);
  assert.equal(c.optionalModules.length,2);
  assert.ok(c.ownerIsolation.length>35);
 }
}
assert.equal(continuityPlatformContract('linux').id,'linux-server');
assert.equal(continuityPlatformContract('linux',{desktop:true}).id,'linux-desktop');
assert.equal(continuityPlatformContract('win32').brokerStatus,'BLOCKED_DACL_UNVERIFIED');
assert.equal(continuityPlatformContract('darwin').brokerStatus,'DESIGN_PENDING');
assert.match(ownerBrokerEndpoint('/var/lib/light-remote/continuity-broker',{platform:'linux'}),/owner-broker\.sock$/);
assert.ok(ownerBrokerEndpoint('C:\\ProgramData\\LightRemote\\Broker',{platform:'win32'}).includes('light-remote-owner-broker-'));
assert.throws(()=>continuityPlatformContract('freebsd'),/continuity_unsupported_platform/);
console.log('CONTINUITY_FOUR_OS_SERVICE_CONTRACT_SOURCE_PASS');
console.log('CONTINUITY_WINDOWS_DACL_FAIL_CLOSED_MAC_LINUX_DESKTOP_PENDING_PASS');
