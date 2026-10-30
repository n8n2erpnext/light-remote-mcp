// Source fixture: owner B verification, durable-grant gate and crash recovery.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {createGoldAbV2GrantCoordinator} from '../../operator-host/gold-ab-v2-grant-coordinator.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'abv2-bridge-'));
let now=1800000000000,online=true,connection='conn',persisted=false,failCommit=false,commits=0;
const registry=new DeviceAccessGrantRegistry({stateFile:path.join(dir,'grants.json'),now:()=>now});
const id=ch=>'av2_'+ch.repeat(32);
const rows=new Map(['a','b','c'].map(ch=>[id(ch),{requestId:id(ch),state:'pending',attempt:1,
 owner:'owner',actor:'owner',device:'device',connection:'conn',
 agent:ch==='b'?'agent-b':'agent-a',client:'oauth-'+'f'.repeat(64),b:'7KPX-42NM'}]));
const pending={
 async grantReceipt(p){
  const r=rows.get(p.requestId);if(!r)throw Error('missing');
  if(r.owner!==p.ownerAccountId||r.device!==p.deviceId||r.connection!==p.connectionId)
   throw Error('scope mismatch');
  if(!['approved','granted'].includes(r.state))throw Error('abv2_b_not_verified');
  const {b,...receipt}=r;return receipt;
 },
 async approve(p){
  const r=rows.get(p.requestId);
  if(r.state!=='pending')throw Error('abv2_request_not_pending');
  if(r.attempt!==p.expectedAttempt)throw Error('abv2_attempt_changed');
  if(r.b!==p.bCode)throw Error('abv2_b_invalid');
  r.approvedAt=now;r.state='approved';return {state:'approved'};
 },
 async commitGrant(p){
  commits++;if(failCommit)throw Error('redis_down');
  const r=rows.get(p.requestId);
  assert.equal(p.approvedAt,r.approvedAt);
  assert.equal(p.grantId,'dag_v2_'+p.requestId.slice(4));
  r.state='granted';r.grantId=p.grantId;
  return {state:'granted',grantId:p.grantId};
 }
};
const runner=createGoldAbV2GrantCoordinator({enabled:true,pending,accessGrants:registry,
 now:()=>now,authorizeOwner:async(req,deviceId)=>{
  if(!online||!req?.owner||!req?.csrf)throw Error('owner_denied');
  return {ownerAccountId:'owner',deviceId,connectionId:connection,
   connectionExpiresAt:now+172800000};
 },flushGrants:async()=>{},confirmPersisted:async p=>
   persisted&&registry.grants.get(p.grantId)?.approvedAt===p.approvedAt});
const request=ch=>({deviceId:'device',requestId:id(ch),expectedAttempt:1,bCode:'7KPX-42NM'});
const owner={owner:true,csrf:true};
try{
 assert.equal(createGoldAbV2GrantCoordinator({enabled:false}),null);
 await assert.rejects(runner({},request('a')),/owner_denied/);
 await assert.rejects(runner(owner,{...request('a'),bCode:'AAAA-AAAA'}),/abv2_b_invalid/);
 await assert.rejects(runner(owner,{...request('a'),expectedAttempt:2}),/abv2_attempt_changed/);
 assert.equal(registry.grants.size,0);
 await assert.rejects(runner(owner,request('a')),/abv2_grant_not_durable/);
 assert.equal(commits,0,'no Redis granted marker before durable readback');
 const at=rows.get(id('a')).approvedAt;
 persisted=true;now+=60000;
 const a=await runner(owner,request('a'));
 assert.equal(a.state,'granted');
 assert.equal(a.approvedAt,at);
 assert.equal(a.absoluteExpiresAt,at+86400000);
 const again=await runner(owner,request('a'));
 assert.equal(again.grantId,a.grantId);
 assert.equal(again.absoluteExpiresAt,a.absoluteExpiresAt);
 const restored=new DeviceAccessGrantRegistry({stateFile:path.join(dir,'grants.json'),now:()=>now});
 assert.equal(restored.assert(a.grantId,{touch:false}).approvedAt,at);
 const b=await runner(owner,request('b'));
 assert.equal(registry.activeGrantsForDevice('device','conn').length,2);
 failCommit=true;
 await assert.rejects(runner(owner,request('c')),/redis_down/);
 assert.equal(rows.get(id('c')).state,'approved');
 const cAt=rows.get(id('c')).approvedAt;
 failCommit=false;
 const c=await runner(owner,request('c'));
 assert.equal(c.approvedAt,cAt);
 assert.equal(c.absoluteExpiresAt,cAt+86400000);
 assert.equal(registry.activeGrantsForDevice('device','conn').length,2);
 assert.equal(registry.assert(b.grantId,{touch:false}).grantId,b.grantId);
 assert.throws(()=>registry.assert(a.grantId,{touch:false}),/device_access_grant_required/);
 connection='changed';
 await assert.rejects(runner(owner,request('c')),/scope mismatch/);
 connection='conn';online=false;
 await assert.rejects(runner(owner,request('c')),/owner_denied/);
 console.log('GOLD_ABV2_OWNER_B_PG_FLUSH_GATE_CRASH_RECOVERY=PASS');
 console.log('GOLD_ABV2_PER_AGENT_24H_IDEMPOTENT_RESTART=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
