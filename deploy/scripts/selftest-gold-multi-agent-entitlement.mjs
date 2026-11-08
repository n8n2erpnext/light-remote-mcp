import assert from 'node:assert/strict';
import {SessionRegistry,SessionError} from '../../operator-host/session-manager.mjs';
import {personalCapacity,TEAM_CAPACITY,executionScope} from '../../operator-host/execution-capacity-policy.mjs';
import {resolveTeamEntitlement} from '../../operator-host/team-entitlement-policy.mjs';

assert.deepEqual(personalCapacity('free'),{sessionLimit:2,agentConcurrencyLimit:1});
assert.deepEqual(personalCapacity('pro'),{sessionLimit:12,agentConcurrencyLimit:3});
assert.deepEqual(personalCapacity('vip'),{sessionLimit:12,agentConcurrencyLimit:3});
assert.deepEqual(personalCapacity('unknown'),personalCapacity('free'),'unknown plans fail closed');
assert.deepEqual(TEAM_CAPACITY,{seats:5,sessionLimit:20,sessionsPerSeat:4,agentConcurrencyLimit:5,agentsPerSeat:2});
const sessions=new SessionRegistry({accountId:'fixture',deviceId:'fixture-node',maxActive:128});
const aid=i=>'agent_real_identity_'+String(i).padStart(5,'0');
const opening=(owner,node,i,limit,nodeCap=20)=>sessions.open({
  accountId:owner,deviceId:node,nodeId:node,agentId:aid(i),
  maxActiveForNode:nodeCap,maxActiveForAccount:limit
});
const freeA=opening('free_acc','free_dev_1',0,2);
const freeB=opening('free_acc','free_dev_2',1,2);
assert.equal(opening('free_acc','free_dev_1',0,2).sessionId,freeA.sessionId,'same Agent on same device must reuse stable lane');
assert.throws(()=>opening('free_acc','free_dev_3',2,2),
  e=>e instanceof SessionError&&e.message==='account_session_capacity_reached'&&e.status===429);
assert.equal(sessions.hold(freeB.sessionId,aid(1)).state,'hold');
assert.throws(()=>opening('free_acc','free_dev_3',2,2),
  e=>e.message==='account_session_capacity_reached','HOLD counts session retention not execution');
sessions.close(freeB.sessionId,aid(1));
assert.equal(opening('free_acc','free_dev_3',2,2).accountId,'free_acc');
console.log('M3_FREE_ACCOUNT_TWO_RETAINED_SESSIONS_HOLD_AND_REUSE=PASS');
for(let i=0;i<12;i++)opening('pro_acc','pro_dev_'+i,i+10,12);
assert.equal(sessions.activeCountByAccount('pro_acc'),12);
assert.throws(()=>opening('pro_acc','pro_13',40,12),
  e=>e.message==='account_session_capacity_reached'&&e.status===429);
assert.equal(opening('pro_other','other_dev_1',41,12).accountId,'pro_other');
console.log('M3_PRO_TWELVE_SESSIONS_ACCOUNT_ISOLATION=PASS');
const oldNode=opening('legacy_owner','legacy_node',60,12,2);
opening('legacy_owner','legacy_node',61,12,2);
assert.throws(()=>opening('legacy_owner','legacy_node',62,12,2),
  e=>e.message==='node_session_capacity_reached','legacy leaf ceiling must not be silently bypassed');
console.log('M3_LEGACY_SIGNED_LEAF_CEILING_REMAINS_ENFORCED=PASS');
const direct=executionScope({actorAccountId:'owner',agentId:'trusted_oauth_agent',deviceOwnerAccountId:'owner'});
assert.equal(direct.billedAccountId,'owner');
assert.equal(direct.scopeType,'personal');
assert.throws(()=>executionScope({actorAccountId:'member',agentId:'trusted_oauth_agent',deviceOwnerAccountId:'owner'}),
  /cross_account_execution_not_authorized/);
assert.throws(()=>executionScope({actorAccountId:'member',agentId:'trusted_oauth_agent',deviceOwnerAccountId:'owner',teamAuthority:{
    teamShared:true,actorAccountId:'member',agentId:'trusted_oauth_agent',
    deviceOwnerAccountId:'owner',billedAccountId:'member',accessGrantId:'grant',
    accessExpiresAt:Date.now()+10000
}}),/team_execution_authority_invalid/);
const teamAuthority={
  teamShared:true,actorAccountId:'member',agentId:'trusted_oauth_agent',
  deviceOwnerAccountId:'owner',billedAccountId:'owner',accessGrantId:'grant_member_ab',
  accessExpiresAt:Date.now()+60_000
};
const team=executionScope({actorAccountId:'member',agentId:'trusted_oauth_agent',deviceOwnerAccountId:'owner',teamAuthority});
assert.equal(team.scopeId,'owner');assert.equal(team.billedAccountId,'owner');assert.equal(team.actorAccountId,'member');
assert.throws(()=>executionScope({...{
  actorAccountId:'member',agentId:'trusted_oauth_agent',deviceOwnerAccountId:'owner'
},teamAuthority:{...teamAuthority,accessExpiresAt:Date.now()-1000}}),/team_execution_authority_invalid/);
console.log('M3_TEAM_TRUSTED_ACTOR_OWNER_BILLING_SCOPE_AND_FAIL_CLOSED=PASS');
const entitlement=resolveTeamEntitlement({
  deviceOwnerAccountId:'owner',actorAccountId:'member',deviceId:'shared_device',
  planFor:()=> 'pro',memberAbApproved:true,
  teamRegistry:{authorize:()=>true,teamEntitlement:()=>({active:true,monthlyMemberCallBudget:5000})}
});
assert.equal(entitlement.billedAccountId,'owner');
assert.equal(entitlement.maxWorkers,3,'preexisting worker preview stays unchanged until M3-T');
assert.equal(entitlement.agentConcurrencyTarget,5);
assert.equal(entitlement.sessionLimit,20);
assert.equal(entitlement.sessionsPerSeat,4);
assert.equal(entitlement.agentsPerSeat,2);
assert.equal(entitlement.monthlyMemberCallBudget,5000);
console.log('M3_TEAM_FIVE_AGENT_POLICY_SEPARATE_FROM_THREE_WORKER_PREVIEW=PASS');
