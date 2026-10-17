import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {GoldPgCoreAuthority} from '../src/storage/gold-core-authority.mjs';
import {startGoldCoreApi} from '../src/http/gold-core-server.mjs';
import {notificationCoreSocket,createGoldOperatorNotificationBridge}
 from '../../operator-host/gold-notification-core-bridge.mjs';

const NOW=Date.parse('2026-10-17T12:00:00Z');
const TOKEN='S'.repeat(48),ID='sys_123e4567-e89b-42d3-a456-426614174000';
const verifyNames=['verifyIdentityProof','verifyDeviceProof','verifyAgentPrincipal',
 'verifyWallApproval','verifyPaddleSignature','verifyOwnerProof',
 'verifyUsageEvidence','approveWallRequest','verifyAgentIngress',
 'verifyOAuthClient','verifyBillingIngress','verifyUsageIngress',
 'verifyDeviceChannelIngress','verifyChannelEnvelope'];
test('Operator private socket bridge → Gold Core socket → real PG authority API: no legacy JSON auth fallback',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-dual-socket-'));
 fs.chmodSync(root,0o700);
 const dir=path.join(root,'run');fs.mkdirSync(dir,{mode:0o700});
 const coreSocket=path.join(dir,'core.sock');
 let core=null,operator=null,pgAlive=true,redisAlive=true,forwarded=0,legacy=0;
 const statements=[],hash=crypto.createHash('sha256').update(TOKEN).digest('hex');
 const notice={notification_id:ID,category:'account',title:'Quality inbox',
  body:'Authenticated session group',link:'/account/inbox',
  audience_type:'group',audience_value:'grp_quality',
  created_at:new Date(NOW-20000),scheduled_at:new Date(NOW-20000),
  expires_at:null,canceled_at:null,published_by:'acct_admin'};
 const pool={query:async(sql,params=[])=>{
  statements.push({sql,params});
  if(!pgAlive)throw Error('pg_down');
  if(sql==='SELECT 1 AS gold_ready')return{rows:[{gold_ready:1}]};
  if(sql.includes('FROM lr_sessions s JOIN lr_accounts a')){
   assert(sql.includes('a.group_id'));
   return{rows:params[0]===hash?[{
    session_id:'session_real',account_id:'acct_quality',email:'qa@example.test',
    expires_at:new Date(NOW+86400000),plan:'free',group_id:'grp_quality'
   }]:[]};
  }
  if(sql.startsWith('SELECT n.*,rd.read_at FROM lr_notifications n')){
   assert.deepEqual(params,['acct_quality','free','grp_quality']);
   return{rows:[{...notice,read_at:null}]};
  }
  throw Error('gold_dual_socket_unexpected_sql:'+sql.slice(0,80));
 },connect:async()=>({query:async()=>({rows:[]}),release(){}})};
 const authority=new GoldPgCoreAuthority({pool,pairingEncryptionKey:crypto.randomBytes(32),
  verifyIdentityProof:async()=>false,verifyDeviceProof:async()=>false,
  verifyAgentPrincipal:async()=>null,verifyWallApproval:async()=>false,
  verifyPaddleSignature:async()=>null});
 const verifiers=Object.fromEntries(verifyNames.map(name=>[name,async()=>null]));
 const env={LIGHT_REMOTE_GOLD_INDEPENDENT:'1',LIGHT_REMOTE_GOLD_ROOT:root};
 const openPlane=async()=>({pool,redis:{ping:async()=>redisAlive?'PONG':'NO'},
  cache:{prefix:'lr:gold:dual:'},
  postgres:{database:'light_remote_gold_dev',schemaVersion:20},close:async()=>{}});
 try{
  core=await startGoldCoreApi({env,verifiers,socketPath:coreSocket,openPlane,
   openCore:()=>authority,openTeam:()=>({})});
  const bridge=createGoldOperatorNotificationBridge({
   socketPath:notificationCoreSocket({...env,LR_GOLD_CORE_SOCKET:coreSocket})});
  operator=http.createServer(async(req,res)=>{
   const url=new URL(req.url,'http://operator.local');
   if(await bridge(req,res,url)){forwarded++;return}
   legacy++;
   res.writeHead(404,{'content-type':'application/json'});
   res.end(JSON.stringify({ok:false,error:'legacy_json_must_not_run'}));
  });
  await new Promise(resolve=>operator.listen(0,'127.0.0.1',resolve));
  const endpoint='http://127.0.0.1:'+operator.address().port;
  const request=async(bearer=null,override='')=>{
   const response=await fetch(endpoint+
    '/v1/accounts/notifications?accountId=acct_rogue&groupId='+encodeURIComponent(override),{
    headers:{'x-light-account-session':'json_legacy_fake',
     ...(bearer?{authorization:'Bearer '+bearer}:{})}});
   const type=response.headers.get('content-type')||'';
   return{status:response.status,body:type.startsWith('application/json')
    ?await response.json():await response.text(),type};
  };
  const forged=await request(null,'grp_quality');
  assert.equal(forged.status,401);
  const gold=await request(TOKEN,'grp_other');
  assert.equal(gold.status,200);
  assert.equal(gold.body.notifications[0].notificationId,ID);
  assert.equal(gold.body.unreadCount,1);
  assert.equal(legacy,0);
  assert.equal(forwarded,2);
  assert.deepEqual(statements.filter(x=>
   x.sql.startsWith('SELECT n.*,rd.read_at')).map(x=>x.params),[
    ['acct_quality','free','grp_quality']]);
  redisAlive=false;
  const outage=await request(TOKEN,'grp_quality');
  assert.equal(outage.status,503);
  assert.equal(outage.body,'service_unavailable');
  assert(outage.type.startsWith('text/plain'),'Gold Core plain 503 must not be mislabeled JSON');
  assert.equal(legacy,0);
  redisAlive=true;pgAlive=false;
  const dbDown=await request(TOKEN,'grp_quality');
  assert.equal(dbDown.status,503);
  assert.equal(dbDown.body,'service_unavailable');
  assert(dbDown.type.startsWith('text/plain'));
  assert.equal(legacy,0);
  await core.close();core=null;
  const socketDown=await request(TOKEN,'grp_quality');
  assert.equal(socketDown.status,503);
  assert.equal(socketDown.body.error,'gold_notification_core_unavailable');
  assert.equal(legacy,0);
 }finally{
  if(operator)await new Promise(resolve=>operator.close(resolve));
  await core?.close();
  fs.rmSync(root,{recursive:true,force:true});
 }
});
