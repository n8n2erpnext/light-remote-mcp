import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {startGoldCoreApi} from '../src/http/gold-core-server.mjs';
import {notificationCoreSocket,createGoldOperatorNotificationBridge}
 from '../../operator-host/gold-notification-core-bridge.mjs';

const TOKEN='E'.repeat(48);
const REQUIRED=['verifyIdentityProof','verifyDeviceProof','verifyAgentPrincipal',
 'verifyWallApproval','verifyPaddleSignature','verifyOwnerProof','verifyUsageEvidence',
 'approveWallRequest','verifyAgentIngress','verifyOAuthClient','verifyBillingIngress',
 'verifyUsageIngress','verifyDeviceChannelIngress','verifyChannelEnvelope'];
test('Canonical Gold Operator Account entitlement through two real sockets uses PG session owner and ledger',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-entitlement-sockets-'));
 fs.chmodSync(root,0o700);
 const run=path.join(root,'run');fs.mkdirSync(run,{mode:0o700});
 const socketPath=path.join(run,'core.sock');
 const env={LIGHT_REMOTE_GOLD_INDEPENDENT:'1',LIGHT_REMOTE_GOLD_ROOT:root};
 const audit=[];
 let backend=true,redis=true,kind='pro_team',role='pro',coreService,operator;
 const pg={query:async(sql,params=[])=>{
  if(!backend)throw Error('pg_down');
  if(sql==='SELECT 1 AS gold_ready')return{rows:[{gold_ready:1}]};
  assert(sql.includes('FROM lr_accounts a LEFT JOIN LATERAL'));
  assert.deepEqual(params,['acct_verified']);
  audit.push({sql,params});
  const paid=kind!==null;
  return{rows:[{account_id:'acct_verified',plan:role,status:'active',
   entitlement_id:paid?'ent_signed_1':null,kind,
   source:paid?'paddle':null,source_ref:paid?'sub_mock':null,
   effective_at:paid?new Date('2026-10-01T00:00:00Z'):null,
   valid_until:paid?new Date('2026-11-01T00:00:00Z'):null}]};
 },connect:async()=>({query:async()=>({rows:[]}),release(){}})};
 const verifiers=Object.fromEntries(REQUIRED.map(key=>[key,async()=>null]));
 try{
  coreService=await startGoldCoreApi({env,verifiers,socketPath,
   openCore:()=>({authenticate:async raw=>{
    if(raw!==TOKEN)throw Object.assign(Error('gold_auth_invalid_session'),
     {code:'gold_auth_invalid_session',status:401});
    return{accountId:'acct_verified'};
   }}),openTeam:()=>({}),openPlane:async()=>({
    pool:pg,redis:{ping:async()=>redis?'PONG':'NO'},
    postgres:{database:'light_remote_gold_dev',schemaVersion:20},
    cache:{prefix:'gold:entitlement-socket:'},close:async()=>{}
   })});
  const bridge=createGoldOperatorNotificationBridge({
   socketPath:notificationCoreSocket({...env,LR_GOLD_CORE_SOCKET:socketPath}),
   accountRoutes:true,notificationRoutes:true});
  operator=http.createServer(async(req,res)=>{
   if(await bridge(req,res,new URL(req.url,'http://operator.local')))return;
   res.statusCode=500;res.end('json_legacy_fallback_forbidden');
  });
  await new Promise(resolve=>operator.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+operator.address().port;
  const request=async token=>{
   const result=await fetch(origin+
    '/v1/accounts/entitlements?accountId=acct_impersonated&plan=vip',{
    headers:token?{'x-light-account-session':token}:{}});
   return{status:result.status,type:result.headers.get('content-type'),
    body:await result.text()};
  };
  const noToken=await request(null);
  assert.equal(noToken.status,401);
  const pro=await request(TOKEN);
  assert.equal(pro.status,200);
  const parsed=JSON.parse(pro.body);
  assert.equal(parsed.accountId,'acct_verified');
  assert.equal(parsed.plan,'pro');
  assert.equal(parsed.teamEligible,true);
  kind=null;
  const downgraded=JSON.parse((await request(TOKEN)).body);
  assert.equal(downgraded.plan,'free');
  assert.equal(downgraded.paid,false);
  assert.equal(downgraded.teamEligible,false);
  role='vip';kind='vip';
  assert.equal(JSON.parse((await request(TOKEN)).body).plan,'vip');
  redis=false;
  assert.equal((await request(TOKEN)).status,503);
  redis=true;backend=false;
  assert.equal((await request(TOKEN)).status,503);
  assert.equal(audit.length,3);
 }finally{
  if(operator)await new Promise(resolve=>operator.close(resolve));
  await coreService?.close();
  fs.rmSync(root,{recursive:true,force:true});
 }
});
