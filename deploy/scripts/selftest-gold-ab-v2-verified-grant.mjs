import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v2-clock-'));
const stateFile=path.join(root,'grants.json');
let now=1800000000000;
const reg=new DeviceAccessGrantRegistry({stateFile,now:()=>now});
const proof=(key,agent='agent-A',when=now)=>({
 requestId:'av2_'+key.repeat(32),ownerAccountId:'owner',deviceId:'dev',
 connectionId:'conn',agentId:agent,verifiedAt:when,
 connectionExpiresAt:now+172800000,label:agent});
function stageAndActivate(registry,p){
 const row=registry.approveVerifiedV2(p);
 assert.equal(row.closeReason,'abv2_uncommitted');
 assert.equal(registry.activeGrantsForDevice('dev','conn').some(x=>x.grantId===row.grantId),false);
 assert.throws(()=>registry.assert(row.grantId,{touch:false}),/device_access_grant_required/);
 registry.activateVerifiedV2(row.grantId);
 assert.throws(()=>registry.assert(row.grantId,{touch:false}),/device_access_grant_required/);
 registry.finalizeVerifiedV2(row.grantId);
 return registry.assert(row.grantId,{touch:false});
}
try{
 const a=stageAndActivate(reg,proof('a'));
 const b=stageAndActivate(reg,proof('b','agent-B'));
 assert.equal(a.absoluteExpiresAt,now+86400000);
 now+=90000;
 assert.equal(reg.approveVerifiedV2(proof('a','agent-A',a.approvedAt)).grantId,a.grantId);
 const restarted=new DeviceAccessGrantRegistry({stateFile,now:()=>now});
 assert.equal(restarted.approveVerifiedV2(proof('a','agent-A',a.approvedAt)).reused,true);
 const candidate=restarted.approveVerifiedV2(proof('c'));
 assert.equal(candidate.closeReason,'abv2_uncommitted');
 assert.equal(restarted.activeGrantsForDevice('dev','conn').length,2,
  'old Agent A is valid while new B approval is pending persistence');
 restarted.activateVerifiedV2(candidate.grantId);
 assert.equal(restarted.activeGrantsForDevice('dev','conn').some(g=>g.grantId===candidate.grantId),false);
 restarted.finalizeVerifiedV2(candidate.grantId);
 assert.equal(restarted.activeGrantsForDevice('dev','conn').length,2);
 assert.equal(restarted.assert(b.grantId,{touch:false}).grantId,b.grantId);
 assert.throws(()=>restarted.approveVerifiedV2(proof('a','agent-A',a.approvedAt)),/abv2_grant_closed_or_expired/);
 assert.throws(()=>restarted.approveVerifiedV2({...proof('c'),agentId:'agent-B'}),/abv2_grant_scope_conflict/);
 assert.equal(restarted.assert(candidate.grantId,{touch:false}).absoluteExpiresAt,now+86400000);
 // The staged state is durable across restart and cannot grant access.
 const staged=restarted.approveVerifiedV2(proof('d'));
 const recovery=new DeviceAccessGrantRegistry({stateFile,now:()=>now});
 assert.equal(recovery.approveVerifiedV2(proof('d')).reused,true);
 assert.throws(()=>recovery.assert(staged.grantId,{touch:false}),/device_access_grant_required/);
 const delayed=restarted.approveVerifiedV2(proof('e'));
 now+=1000;
 const newest=stageAndActivate(restarted,proof('f'));
 assert.notEqual(newest.grantId,delayed.grantId);
 assert.throws(()=>restarted.activateVerifiedV2(delayed.grantId),/abv2_grant_superseded/);
 assert.throws(()=>restarted.assert(delayed.grantId,{touch:false}),/device_access_grant_required/);
 console.log('GOLD_ABV2_STALE_AGENT_REAPPROVAL_NEVER_ROLLS_BACK_CLOCK=PASS');
 console.log('GOLD_ABV2_STAGED_GRANT_NOT_ACCESSIBLE_BEFORE_COMMIT=PASS');
 console.log('GOLD_ABV2_VERIFIED_GRANT_PER_AGENT_RESTART_IDEMPOTENT=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
