import assert from 'node:assert/strict';
import {FleetRouter} from '../../operator-host/fleet-router.mjs';
import {leafCapabilityAdmission} from '../../operator-host/leaf-capability-admission.mjs';

let clock=1_000_000;
const fleet=new FleetRouter({now:()=>clock});
const identity={accountId:'acct_gold_fixture',deviceId:'dev_gold_fixture',nodeId:'node_gold_fixture',sessionCeiling:2,capabilities:['filesystem','lxd','systemctl']};
fleet.touch(identity);
const reported=fleet.assertRoutable(identity.nodeId,{accountId:identity.accountId,deviceId:identity.deviceId}).capabilities;
const approved=['filesystem','docker','lxd'];
const result=leafCapabilityAdmission({reported,approved,required:['filesystem','docker','lxd','systemctl']});
assert.deepEqual(result.capabilities,['filesystem','lxd'],'only enrollment-and-Agent intersection can grant');
assert.deepEqual(result.missingCapabilities,['docker','systemctl']);
assert.deepEqual(result.missingCapabilityReasons,{
  docker:'agent_not_advertising',
  systemctl:'enrollment_not_approved',
});
assert.equal(result.capabilities.includes('docker'),false,'operator must not manufacture unreported docker');
assert.equal(result.capabilities.includes('systemctl'),false,'operator must not manufacture unapproved systemctl');
const empty=leafCapabilityAdmission({reported:['docker'],approved:[],required:['docker']});
assert.equal(empty.missingCapabilityReasons.docker,'enrollment_not_approved');
const allowed=leafCapabilityAdmission({reported:['filesystem','lxd'],approved:['filesystem','lxd'],required:['lxd']});
assert.deepEqual(allowed.missingCapabilities,[]);
assert.deepEqual(allowed.capabilities,['filesystem','lxd']);
const malformed=leafCapabilityAdmission({reported:['filesystem','filesystem','secret&extra'],approved:['filesystem','secret&extra'],required:['filesystem','secret&extra']});
assert.deepEqual(malformed.capabilities,['filesystem']);
assert.deepEqual(malformed.missingCapabilities,[]);
clock+=25_000;
assert.throws(()=>fleet.assertRoutable(identity.nodeId,{accountId:identity.accountId}),/target_node_offline/);
console.log('G1_GOLD_CAPABILITY_PROVENANCE_FAIL_CLOSED=PASS');
