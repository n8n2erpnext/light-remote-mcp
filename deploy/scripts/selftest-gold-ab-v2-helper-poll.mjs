// P2-I2h2e-B private OAuth Helper poll release gate, no runtime DB mutation.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {GoldAbV2HelperProofError,goldAbV2HelperKey}
 from '../../lib/gold-ab-v2-helper-proof.mjs';
import {signGoldAbV2HelperPoll,verifyGoldAbV2HelperPoll}
 from '../../lib/gold-ab-v2-helper-poll-proof.mjs';
import {createGoldAbV2HelperPoll} from '../../operator-host/gold-ab-v2-helper-poll.mjs';
import {AgentClientRegistry} from '../../operator-host/agent-client-registry.mjs';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'abv2-helper-poll-'));
const keyFile=path.join(root,'key');
fs.writeFileSync(keyFile,crypto.randomBytes(32),{mode:0o600});
const env={LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE:keyFile,
 LR_GOLD_AB_V2_SEAL_KEY_FILE:keyFile,
 LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',LR_GOLD_AB_V2_HELPER_TARGET_QUERY:'1',
 LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE:'1',LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE:'1',
 LR_GOLD_AB_V2_HELPER_POLL_ATTACH:'1',
 LR_GOLD_AB_V2_OWNER_ORIGIN:'https://gold.example.test',
 LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'acct1',
 LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'dev1'};
const identity={accountId:'acct1',clientId:'opaque-client-'+('a'.repeat(180))};
const requestId='av2_'+'a'.repeat(32),grantId='dag_v2_'+requestId.slice(4);
const now=Date.now(),grantTime=now-10000,connectionExpires=now+172800000;
const access=new DeviceAccessGrantRegistry({now:()=>now});
const agentClients=new AgentClientRegistry({now:()=>now});
const agentId='plugin-'+crypto.createHash('sha256')
 .update(identity.accountId+'|'+identity.clientId).digest('hex').slice(0,40);
let approved=false,grantActive=false,pgDurable=true,bindingDurable=true,
 connectionId='conn1',revoked=false,policyEnabled=true;
let clientFlushCount=0;
const grant=access.approveVerifiedV2({requestId,ownerAccountId:'acct1',agentId,
 deviceId:'dev1',connectionId:'conn1',verifiedAt:grantTime,
 connectionExpiresAt:connectionExpires,label:'Agent 1'});
assert.equal(grant.grantId,grantId);
access.activateVerifiedV2(grantId);access.finalizeVerifiedV2(grantId);
const key=goldAbV2HelperKey(env);
const replay=new Set(),clientHash='oauth-'+crypto.createHash('sha256').update(identity.clientId).digest('hex');
const receipt=()=>({state:approved?'granted':'pending',requestId,owner:'acct1',actor:'acct1',
 agent:agentId,client:clientHash,device:'dev1',connection:'conn1',attempt:1,
 approvedAt:grantTime,grantId});
const redis={
 set:async(k,v,o)=>{assert.equal(o.NX,true);if(replay.has(k))return null;replay.add(k);return 'OK';},
 eval:async(_lua,{arguments:args})=>{
  const [op,raw]=args,p=JSON.parse(raw);
  if(op==='agent'){
   if(p.actor!=='acct1'||p.agent!==agentId||p.client!==clientHash||
      p.connection!=='conn1')throw Error('abv2_agent_scope_denied');
   return JSON.stringify({requestId,state:approved?'granted':'approved',attempt:1,expiresAt:now+300000});
  }
  if(op==='grant_receipt'){
   if(p.owner!=='acct1'||p.device!=='dev1'||p.connection!=='conn1')
    throw Error('abv2_owner_scope_denied');
   return JSON.stringify(receipt());
  }
  throw Error('unexpected Redis mutation: '+op);
 }
};
const pg={query:async(sql,params)=>{
 if(sql.includes('lr_gold_device_short_ids'))
  return {rowCount:1,rows:[{short_id:'ABCD02'}]};
 if(sql.includes('lr_ab_grants')){
  const row={grant_id:grantId,account_id:'acct1',device_id:'dev1',connection_id:'conn1',
   agent_id:agentId,approved_at:new Date(grantTime),
   expires_at:new Date(grantTime+86400000),absolute_expires_at:new Date(grantTime+86400000),
   closed_at:grantActive&&pgDurable?null:new Date(grantTime),
   close_reason:grantActive&&pgDurable?null:'abv2_uncommitted'};
  return {rowCount:1,rows:[row]};
 }
 if(sql.includes('lr_agent_clients c JOIN lr_agent_bindings b')){
  const row=agentClients.rows.get(params[0]);
  const b=row?.bindings?.dev1;
  if(!bindingDurable||!b)return {rowCount:0,rows:[]};
  return {rowCount:1,rows:[{account_id:row.accountId,agent_id:row.agentId,
   closed_at:row.closedAt,expires_at:new Date(row.expiresAt),device_id:'dev1',
   connection_id:b.connectionId,grant_id:b.grantId,pairing_request_id:b.pairingRequestId}]};
 }
 throw Error('unexpected query');
}};
const storage={redis,pool:pg,prefix:'lr:gold:fixture:'};
const make=(e=env)=>createGoldAbV2HelperPoll({env:e,storage,
 accounts:{assertOperational:()=>({accountId:'acct1',emailVerified:true})},
 devices:{get:()=>({deviceId:'dev1',accountId:'acct1',state:'online',
  publicIdentityKey:'key1'})},
 enrollments:{binding:()=>({deviceId:'dev1',accountId:'acct1',
  publicIdentityKey:'key1',revokedAt:revoked?now:null}),
  policyView:()=>({accountId:'acct1',policyRevision:1,policyProfile:policyEnabled?'default':'disabled',
   approvedCapabilities:['filesystem']})},
 connections:{assertConnected:()=>({deviceId:'dev1',accountId:'acct1',
  connectionId,state:'connected',hardExpiresAt:connectionExpires})},
 accessGrants:access,agentClients,goldRegistries:{flush:async()=>{clientFlushCount++;}},
 readJson:async req=>req.data,sendJson:(res,status,payload)=>{res.status=status;res.body=payload},now:()=>now
});
const proof=(ident=identity,extra={})=>signGoldAbV2HelperPoll({identity:ident,
 requestId,deviceId:'dev1',shortId:'ABCD02',key,...extra});
const route=new URL('http://operator/v1/plugin/abv2/request-poll');
const call=async(handler,pr=proof())=>{const res={};await handler({method:'POST',data:pr},res,route);return res};
try{
 assert.equal((await call(make({...env,LR_GOLD_AB_V2_HELPER_POLL_ATTACH:'0'}))).status,404);
 assert.equal(clientFlushCount,0);
 assert.throws(()=>make({...env,LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE:'0'}),
  /abv2_poll_requires_issue_and_durable_grant/);
 const handle=make();
 const denied=await call(handle,proof(identity,{deviceId:'dev2'}));
 assert.equal(denied.status,404);
 const tampered={...proof(),requestId:'av2_'+'b'.repeat(32)};
 assert.equal((await call(handle,tampered)).status,401);
 const delayed=proof(identity,{now:now-95000});
 assert.equal((await call(handle,delayed)).status,401);
 const other=proof({accountId:'acct1',clientId:'opaque-client-'+('z'.repeat(180))});
 assert.equal((await call(handle,other)).status,503,'Redis rejects wrong OAuth agent');
 const pending=await call(handle);assert.equal(pending.status,200);
 assert.equal(pending.body.helperReady,false);assert.equal(clientFlushCount,0);
 approved=true;grantActive=false;
 const redisOnly=await call(handle);assert.equal(redisOnly.status,409);
 assert.equal(redisOnly.body.error,'abv2_poll_grant_not_durable_or_inactive');
 assert.equal(clientFlushCount,0);
 grantActive=true;pgDurable=false;
 const pgPending=await call(handle);assert.equal(pgPending.status,409);
 assert.equal(clientFlushCount,0);
 pgDurable=true;revoked=true;
 assert.equal((await call(handle)).status,403);
 revoked=false;policyEnabled=false;
 assert.equal((await call(handle)).status,403);
 policyEnabled=true;connectionId='changed';
 assert.equal((await call(handle)).status,503);
 connectionId='conn1';bindingDurable=false;
 assert.equal((await call(handle)).status,503);
 assert.ok(clientFlushCount>=1);
 bindingDurable=true;
 const yes=await call(handle);
 assert.equal(yes.status,200);assert.equal(yes.body.status,'ready');
 assert.equal(yes.body.helperReady,true);assert.equal(yes.body.agentId,agentId);
 assert.match(yes.body.clientSessionId,/^lrc_/);
 assert.ok(!JSON.stringify(yes.body).includes(identity.clientId));
 assert.equal(agentClients.rows.size,1);
 const again=await call(handle);
 assert.equal(again.status,200);
 assert.equal(again.body.clientSessionId,yes.body.clientSessionId);
 assert.equal(again.body.expiresAt,yes.body.expiresAt);
 const r=proof();
 assert.equal((await call(handle,r)).status,200);
 assert.equal((await call(handle,r)).status,409,'same signed poll cannot replay');
 console.log('GOLD_ABV2_OAUTH_HELPER_POLL_SCOPE_PG_ACTIVE_BINDING_DURABLE=PASS');
 console.log('GOLD_ABV2_OAUTH_HELPER_POLL_REPLAY_CROSS_AGENT_STALE_GRANT=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
