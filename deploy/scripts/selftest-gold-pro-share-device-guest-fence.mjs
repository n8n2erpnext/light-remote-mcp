import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertLegacyOwnerCommandNotGuest} from '../../lib/gold-pro-share-device-guest-fence.mjs';
for(const payload of [
 {type:'exec',script:'echo ok'}, {type:'process',process:{op:'start'}},
 {type:'fs',fs:{op:'read'}}, {type:'desktop'},
 {type:'terminal'}, {type:'search'}, {type:'scp'},{type:'update'}
])assert.equal(assertLegacyOwnerCommandNotGuest(payload),true);
for(const payload of [
 {type:'guest-process',process:{op:'start',script:'echo hello'}},
 {type:'process',guestDelegation:{guestAccountId:'g'}},
 {type:'exec',delegationPurpose:'pro-share-guest'},
 {type:'exec',guestJobId:'123'}, {type:'process',guestGrantId:'abc'},
 {type:'process',guestPermissionRevision:1},
 {type:'fs',guestPayloadSha256:'abc'}, {type:'fs',delegation:{}},
 {type:'guest-exec'}
])assert.throws(()=>assertLegacyOwnerCommandNotGuest(payload),
 /gold_guest_agent_protocol_not_supported/);
const agent=fs.readFileSync('device-agent/operator-agent.mjs','utf8');
const i=agent.indexOf('async function executeCommandCore(');
assert.ok(i>0);
assert.match(agent.slice(i,i+390),/assertLegacyOwnerCommandNotGuest\(command\?\.payload\|\|\{\}\)/);
assert.match(agent.slice(i+390,i+1500),/p\.type==='update'/);
console.log('GOLD_P2I4C3C_DEVICE_AGENT_LEGACY_GUEST_DOWNGRADE_DENIED=PASS');
