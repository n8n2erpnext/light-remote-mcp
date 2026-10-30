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
try{
 const a=reg.approveVerifiedV2(proof('a'));
 const b=reg.approveVerifiedV2(proof('b','agent-B'));
 assert.equal(a.absoluteExpiresAt,now+86400000);
 now+=90000;
 assert.equal(reg.approveVerifiedV2(proof('a','agent-A',a.approvedAt)).grantId,a.grantId);
 const restarted=new DeviceAccessGrantRegistry({stateFile,now:()=>now});
 assert.equal(restarted.approveVerifiedV2(proof('a','agent-A',a.approvedAt)).reused,true);
 const a2=restarted.approveVerifiedV2(proof('c'));
 assert.notEqual(a.grantId,a2.grantId);
 assert.equal(restarted.activeGrantsForDevice('dev','conn').length,2);
 assert.equal(restarted.assert(b.grantId,{touch:false}).grantId,b.grantId);
 assert.throws(()=>restarted.approveVerifiedV2(proof('a','agent-A',a.approvedAt)),/abv2_grant_closed_or_expired/);
 assert.throws(()=>restarted.approveVerifiedV2({...proof('c'),agentId:'agent-B'}),/abv2_grant_scope_conflict/);
 assert.equal(a2.absoluteExpiresAt,now+86400000);
 console.log('GOLD_ABV2_VERIFIED_GRANT_PER_AGENT_RESTART_IDEMPOTENT=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
