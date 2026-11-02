import assert from 'node:assert/strict';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {AgentClientRegistry} from '../../operator-host/agent-client-registry.mjs';
import {closeOwnerSessionAndGrant} from '../../operator-host/owner-session-close-abv2.mjs';
import {goldAbV2LabV1Disabled} from '../../lib/gold-ab-v2-lab-v1-lock.mjs';

let now=1_800_000_000_000;const time=()=>now;
const grants=new DeviceAccessGrantRegistry({now:time});
const clients=new AgentClientRegistry({now:time});
const acct='acct_owner',device='dev_lab',connection='dc_lab',laterDevice='dev_other';
const grantFor=(agentId,did=device,cid=connection)=>{
 const r=grants.request({accountId:acct,deviceId:did,connectionId:cid,
  connectionExpiresAt:now+26*3600e3,agentId,purpose:'device',forceApproval:true});
 assert.equal(r.state,'pending');
 return grants.approve(r.request.requestId,{deviceId:did,connectionId:cid,
  connectionExpiresAt:now+26*3600e3});
};
const a='plugin-claude',b='plugin-chatgpt';
const ga=grantFor(a),gb=grantFor(b);
const ca=clients.attach({accountId:acct,agentId:a,grant:ga});
const cb=clients.attach({accountId:acct,agentId:b,grant:gb});
const sidA='s_claude_owner_close_01',sidB='s_chatgpt_stays_open_02';
clients.setWorkingContext(ca.clientSessionId,{agentId:a,deviceId:device,sessionId:sidA});
clients.setWorkingContext(cb.clientSessionId,{agentId:b,deviceId:device,sessionId:sidB});
const rows=new Map([
 [sidA,{sessionId:sidA,accountId:acct,deviceId:device,agentId:a,state:'hold',activeJobs:[]}],
 [sidB,{sessionId:sidB,accountId:acct,deviceId:device,agentId:b,state:'active',activeJobs:[]}]
]);
const sessions={
 get(id,agent){
  const v=rows.get(id);if(!v||v.agentId!==agent)throw Error('session_not_found');
  return {...v};
 },
 close(id,agent){
  const v=rows.get(id);if(!v||v.agentId!==agent)throw Error('session_not_found');
  if(v.activeJobs.length)throw Error('session_busy');
  v.state='closed';return {...v};
 }
};
const close=(sessionId,agentId)=>closeOwnerSessionAndGrant({
 sessionId,agentId,accountId:acct,deviceId:device,connectionId:connection,
 sessions,accessGrants:grants,agentClients:clients
});
assert.equal(goldAbV2LabV1Disabled({LR_GOLD_INSTANCE_ID:'abv2lab01',
 LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1:'1'}),true);
assert.throws(()=>close(sidA,b));
assert.equal(grants.activeGrantsForDevice(device,connection).length,2);
const closed=close(sidA,a);
assert.equal(closed.session.state,'closed');
assert.equal(closed.revokedGrants,1);
assert.equal(grants.grants.get(ga.grantId).closeReason,'owner_closed_from_wall');
assert.equal(grants.grants.get(gb.grantId).closedAt,null);
assert.equal(grants.activeGrantsForDevice(device,connection).length,1);
assert.equal(rows.get(sidB).state,'active');
assert.throws(()=>clients.findActive({accountId:acct,agentId:a}),/agent_client_required/);
assert.ok(clients.findActive({accountId:acct,agentId:b}));
assert.equal(close(sidA,a).revokedGrants,0,'retry must not revoke other Agent');
console.log('OWNER_CLOSE_REVOKES_ONLY_SESSION_MATCHED_AGENT_B_GRANT=PASS');

// Another device under same Agent client must stay authorized.
const ga2=grantFor(a);
const gc=grantFor(a,laterDevice,'dc_other');
const cc=clients.attach({accountId:acct,agentId:a,grant:ga2});
clients.attach({clientSessionId:cc.clientSessionId,accountId:acct,agentId:a,grant:gc});
const laterSid='s_claude_close_multi_03';
clients.setWorkingContext(cc.clientSessionId,{agentId:a,deviceId:device,sessionId:laterSid});
clients.setWorkingContext(cc.clientSessionId,{agentId:a,deviceId:laterDevice,sessionId:'s_other'});
rows.set(laterSid,{sessionId:laterSid,accountId:acct,deviceId:device,agentId:a,state:'active',activeJobs:[]});
assert.equal(close(laterSid,a).revokedGrants,1);
assert.equal(grants.grants.get(ga2.grantId).closedAt,now);
assert.equal(grants.grants.get(gc.grantId).closedAt,null);
assert.equal(clients.resolve(cc.clientSessionId,{agentId:a,deviceId:laterDevice}).grantId,gc.grantId);
console.log('OWNER_CLOSE_PRESERVES_OTHER_DEVICE_BINDING=PASS');

// A client binding already updated to a newer session must NOT cause
// closing its older session to revoke the newer independently approved B.
const next=grantFor(a);
const fresh=clients.attach({accountId:acct,agentId:a,grant:next});
const newerSid='s_claude_new_grant_05';
clients.setWorkingContext(fresh.clientSessionId,{agentId:a,deviceId:device,sessionId:newerSid});
const staleSid='s_claude_old_lane_04';
rows.set(staleSid,{sessionId:staleSid,accountId:acct,deviceId:device,agentId:a,state:'hold',activeJobs:[]});
assert.equal(close(staleSid,a).revokedGrants,0);
assert.equal(grants.grants.get(next.grantId).closedAt,null);
console.log('OWNER_CLOSE_STALE_LANE_DOES_NOT_REVOKE_NEW_B=PASS');

// Missing grant-to-session proof, and active jobs, must NOT return success.
const fakeSid='s_unknown_binding_06';
const c='plugin-unbound';const unboundGrant=grantFor(c);
rows.set(fakeSid,{sessionId:fakeSid,accountId:acct,deviceId:device,agentId:c,state:'hold',activeJobs:[]});
assert.throws(()=>close(fakeSid,c),/owner_close_session_grant_binding_unverified/);
assert.equal(grants.grants.get(unboundGrant.grantId).closedAt,null);
assert.equal(rows.get(fakeSid).state,'hold');
rows.get(sidB).activeJobs.push('job_running');
assert.throws(()=>close(sidB,b),/session_busy/);
assert.equal(grants.grants.get(gb.grantId).closedAt,null);
console.log('OWNER_CLOSE_FAIL_CLOSED_FOR_UNVERIFIED_BINDING_AND_ACTIVE_JOBS=PASS');
