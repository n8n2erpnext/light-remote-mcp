import assert from 'node:assert/strict';
import {FleetRouter} from '../../operator-host/fleet-router.mjs';
import {leafCapabilityAdmission} from '../../operator-host/leaf-capability-admission.mjs';

// Only a signed Agent channel may supply the touch input in production.
// This fixture checks that its reported revision is preserved as observation,
// NEVER promoted to effective capability or authorization.
const fleet=new FleetRouter({now:()=>1_000_000});
const i={accountId:'acct_fixture',deviceId:'dev_fixture',nodeId:'node_fixture',
  capabilities:['filesystem'],policyRevision:2};
fleet.touch(i);
const view=fleet.assertRoutable(i.nodeId,{accountId:i.accountId,deviceId:i.deviceId});
assert.equal(view.reportedPolicyRevision,2);
const test=(approved,required,approvedRevision)=>leafCapabilityAdmission({
  reported:view.capabilities,approved,required,reportedRevision:view.reportedPolicyRevision,
  approvedRevision
});
let r=test(['filesystem','docker'],['docker'],3);
assert.deepEqual(r.capabilities,['filesystem']);
assert.deepEqual(r.missingCapabilities,['docker']);
assert.equal(r.missingCapabilityReasons.docker,'agent_policy_revision_stale');
r=test(['filesystem'],['docker'],3);
assert.equal(r.missingCapabilityReasons.docker,'enrollment_not_approved','revision cannot manufacture a grant');
r=test(['filesystem','docker'],['docker'],2);
assert.equal(r.missingCapabilityReasons.docker,'agent_not_advertising','same revision means not reported');
fleet.touch({...i,policyRevision:3});
assert.equal(fleet.view(i.nodeId).reportedPolicyRevision,3);
r=leafCapabilityAdmission({reported:fleet.view(i.nodeId).capabilities,approved:['filesystem','docker'],
  required:['docker'],reportedRevision:3,approvedRevision:3});
assert.equal(r.missingCapabilityReasons.docker,'agent_not_advertising');
fleet.touch({...i,policyRevision:'not-a-revision'});
assert.equal(fleet.view(i.nodeId).reportedPolicyRevision,null);
r=leafCapabilityAdmission({reported:fleet.view(i.nodeId).capabilities,approved:['filesystem','docker'],
  required:['docker'],reportedRevision:null,approvedRevision:3});
assert.equal(r.missingCapabilityReasons.docker,'agent_not_advertising','unknown revision cannot claim stale');
fleet.touch({...i,policyRevision:1,capabilities:['filesystem','docker']});
r=leafCapabilityAdmission({reported:fleet.view(i.nodeId).capabilities,approved:['filesystem','docker'],
  required:['docker'],reportedRevision:1,approvedRevision:3});
assert.deepEqual(r.missingCapabilities,[],'both approved and advertised still pass; revision is diagnostic');
console.log('G1_POLICY_REVISION_PROVENANCE_NO_PRIVILEGE_CHANGE=PASS');
