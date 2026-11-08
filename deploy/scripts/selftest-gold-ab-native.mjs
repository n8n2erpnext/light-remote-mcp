import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {GoldNativeAB} from '../../lib/gold-native-ab.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-ab-test-'));
const file=path.join(root,'ab.key');
fs.writeFileSync(file,crypto.randomBytes(32),{mode:0o600});
process.env.LIGHT_REMOTE_GOLD_ROOT=root;
process.env.LR_GOLD_AB_KEY_FILE=file;
const rows={requests:new Map(),grants:new Map(),requestMeta:new Map(),grantMeta:new Map()};
const query=async(sql,v=[])=>{
 if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
 if(sql==='SELECT * FROM lr_ab_requests')return {rows:[...rows.requests.values()]};
 if(sql==='SELECT * FROM lr_ab_grants')return {rows:[...rows.grants.values()]};
 if(sql==='SELECT * FROM lr_gold_ab_request_metadata')return {rows:[...rows.requestMeta.values()]};
 if(sql==='SELECT * FROM lr_gold_ab_grant_metadata')return {rows:[...rows.grantMeta.values()]};
 if(sql.startsWith('INSERT INTO lr_ab_requests')){
  rows.requests.set(v[0],{request_id:v[0],account_id:v[1],device_id:v[2],connection_id:v[3],
   agent_id:v[4],purpose:v[5],poll_sha256:v[6],display_code_ciphertext:v[7],state:v[8],
   created_at:v[9],expires_at:v[10],consumed_at:v[11]});return {rows:[]};
 }
 if(sql.startsWith('INSERT INTO lr_gold_ab_request_metadata')){
  rows.requestMeta.set(v[0],{request_id:v[0],label:v[1],pairing_required:v[2],
   pairing_id:v[3],denied_ms:v[4],deny_reason:v[5]});return {rows:[]};
 }
 if(sql.startsWith('INSERT INTO lr_ab_grants')){
  rows.grants.set(v[0],{grant_id:v[0],account_id:v[1],device_id:v[2],
   connection_id:v[3],agent_id:v[4],purpose:v[5],approved_at:v[6],last_activity_at:v[7],
   idle_grace_ms:v[8],expires_at:v[9],absolute_expires_at:v[10],closed_at:v[11]});
  return {rows:[]};
 }
 if(sql.startsWith('INSERT INTO lr_gold_ab_grant_metadata')){
  rows.grantMeta.set(v[0],{grant_id:v[0],close_reason:v[1]});return {rows:[]};
 }
 if(sql.startsWith('DELETE FROM lr_ab_requests')){
  for(const k of [...rows.requests.keys()])if(!v[0].includes(k)){rows.requests.delete(k);rows.requestMeta.delete(k)}
  return {rows:[]};
 }
 if(sql.startsWith('DELETE FROM lr_ab_grants')){
  for(const k of [...rows.grants.keys()])if(!v[0].includes(k)){rows.grants.delete(k);rows.grantMeta.delete(k)}
  return {rows:[]};
 }
 throw Error('unexpected_sql:'+sql.slice(0,100));
};
const pool={query,async connect(){return {query,release(){}}}};
const now=Date.now();
const r={requestId:'req1',accountId:'a',deviceId:'d',connectionId:'c',
 agentId:'agent1',label:'ChatGPT',userCode:'QWER-4321',pollHash:'f'.repeat(64),
 state:'pending',pairingRequired:true,pairingId:'pair1',
 createdAt:now,expiresAt:now+600000,consumedAt:null,deniedAt:null};
const g={grantId:'grant1',accountId:'a',deviceId:'d',connectionId:'c',
 agentId:'agent1',approvedAt:now,lastActivityAt:now,idleGraceMs:1800000,
 absoluteExpiresAt:now+86400000,expiresAt:now+600000,closedAt:null};
try{
 const store=await GoldNativeAB.open({pool});
 store.mount();
 await store.write({requests:[['req1',r]],grants:[['grant1',g]]});
 const cipher=rows.requests.get('req1').display_code_ciphertext;
 assert.ok(Buffer.isBuffer(cipher));
 assert.equal(cipher.includes(Buffer.from(r.userCode)),false,'B code must not persist plaintext');
 const restart=await GoldNativeAB.open({pool});
 const state=restart.mount();
 assert.equal(state.requests[0][1].userCode,'QWER-4321');
 assert.equal(state.grants[0][1].grantId,'grant1');
 const tr={...r,requestId:'team_req',userCode:'TEST-2345',purpose:'team-member'};
 const tg={...g,grantId:'team_grant',purpose:'team-member'};
 await restart.write({requests:[['team_req',tr]],grants:[['team_grant',tg]]});
 const teamReload=await GoldNativeAB.open({pool}),teamState=teamReload.mount();
 assert.equal(teamState.requests[0][1].purpose,'team-member');
 assert.equal(teamState.grants[0][1].purpose,'team-member');
 assert.equal(rows.requests.get('team_req').purpose,'team-member');
 assert.equal(rows.grants.get('team_grant').purpose,'team-member');
 await teamReload.write({requests:[],grants:[]});
 assert.equal((await GoldNativeAB.open({pool})).requests.length,0);
 console.log('GOLD_NATIVE_AB_ENCRYPTED_RELOAD_FAKE=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true})}
