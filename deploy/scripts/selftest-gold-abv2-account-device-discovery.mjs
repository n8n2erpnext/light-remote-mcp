// Gold AB V2: account-scoped preapproval online discovery.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 summarizePermittedDeviceDiscovery
} from '../../lib/gold-device-short-id.mjs';
import {
 goldAbV2HelperKey,signGoldAbV2HelperTarget,verifyGoldAbV2HelperTarget
} from '../../lib/gold-ab-v2-helper-proof.mjs';
import {createGoldAbV2HelperTarget} from '../../operator-host/gold-ab-v2-helper-target.mjs';

const devices=[];
const SID='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function shortId(i){
 let n=i+1000,result='';
 for(let j=0;j<6;j++){result=SID[n%32]+result;n=Math.floor(n/32);}
 return result;
}
for(let i=0;i<100;i++){
 devices.push({
  deviceId:'dev'+i,shortId:shortId(i),
  displayName:i===0?'VPS-ARM':i===1||i===2?'THISPC':'Machine '+i,
  nodeId:i===0?'VPS-ARM':i===1||i===2?'THISPC':'node-'+i,
  platform:i>=3&&i<41?'windows':'linux',
  architecture:i===0?'arm64':'x64',
  accountId:'acct1',
  state:(i>=3&&i<41&&i%2===0)||i===42?'offline':'online'
 });
}
const other={deviceId:'dev_secret',shortId:'AAAAAA',
 displayName:'SECRET-OTHER-ACCOUNT',nodeId:'secret',
 platform:'windows',architecture:'x64',accountId:'acct2',state:'online'};
devices.push(other);
const count=items=>items.filter(x=>x.online).length;
const clean=devices.slice(0,100).map(d=>({...d,online:d.state==='online'}));
const all=summarizePermittedDeviceDiscovery({permittedDevices:clean});
assert.equal(all.total,100);
assert.equal(all.onlineCount,count(clean));
assert.equal(all.offlineCount,100-count(clean));
assert.equal(all.matches.length,5);
assert.equal(all.hasMore,true);
const live=summarizePermittedDeviceDiscovery({permittedDevices:clean,onlineOnly:true});
assert.equal(live.total,count(clean));
assert.equal(live.matches.every(m=>m.online),true);
assert.equal(live.onlineCount,count(clean));
const windows=summarizePermittedDeviceDiscovery({
 permittedDevices:clean,query:'Windows',onlineOnly:true
});
assert.equal(windows.matchedTotal,38);
assert.equal(windows.onlineCount,19);
assert.equal(windows.offlineCount,19);
assert.equal(windows.total,19);
assert.equal(windows.matches.length,5);
assert.equal(windows.matches.every(m=>m.platform==='windows'&&m.online),true);
const arm=summarizePermittedDeviceDiscovery({permittedDevices:clean,query:'VPS-ARM'});
assert.equal(arm.total,1);assert.equal(arm.matches[0].shortId,shortId(0));
assert.equal(arm.matches[0].online,true);
const arch=summarizePermittedDeviceDiscovery({permittedDevices:clean,query:'arm64'});
assert.equal(arch.total,1);
const sid=summarizePermittedDeviceDiscovery({permittedDevices:clean,
 query:shortId(0).toLowerCase()});
assert.equal(sid.total,1);
const duplicates=summarizePermittedDeviceDiscovery({permittedDevices:clean,query:'THISPC'});
assert.equal(duplicates.total,2);
const offline=summarizePermittedDeviceDiscovery({permittedDevices:clean,query:'Machine 42'});
assert.equal(offline.total,1);assert.equal(offline.onlineCount,0);
assert.equal(summarizePermittedDeviceDiscovery({
 permittedDevices:clean,query:'Machine 42',onlineOnly:true
}).total,0);
assert.equal(summarizePermittedDeviceDiscovery({
 permittedDevices:clean,query:'SECRET-OTHER-ACCOUNT'
}).total,0);
assert.throws(()=>summarizePermittedDeviceDiscovery({
 permittedDevices:clean,limit:100
}),/gold_discovery_query_invalid/);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-abv2-discovery-'));
try{
 const secretFile=path.join(root,'signing.key');
 fs.writeFileSync(secretFile,crypto.randomBytes(32),{mode:0o600});
 const env={
  LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE:secretFile,
  LR_GOLD_AB_V2_SEAL_KEY_FILE:secretFile,
  LR_GOLD_AB_V2_HELPER_TARGET_QUERY:'1',
  LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',
  LR_GOLD_AB_V2_OWNER_ORIGIN:'https://gold.example.test',
  LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'acct1',
  LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:clean.map(d=>d.deviceId).join(',')
 };
 const key=goldAbV2HelperKey(env);
 const identity={accountId:'acct1',clientId:'long-oauth-client-'+('a'.repeat(160))};
 const replay=new Set();
 const redis={async set(k,v,options){
  assert.equal(options.NX,true);assert.equal(options.EX,90);
  if(replay.has(k))return null;
  replay.add(k);return 'OK';
 }};
 let countDb=0,startedPair=0,issuedGrant=0;
 const db={async query(sql,params=[]){
  countDb++;
  if(sql.includes('to_regclass'))
   return {rows:[{present:true}]};
  assert.match(sql,/owner_account_id=\$1/);
  assert.equal(params[0],'acct1');
  return {rows:clean.map(d=>({
   device_id:d.deviceId,node_id:d.nodeId,display_name:d.displayName,
   platform:d.platform,architecture:d.architecture,state:d.state,
   short_id:d.shortId
  }))};
 }};
 const byId=new Map(devices.map(d=>[d.deviceId,d]));
 const fakeDevices={
  get(id){
   const d=byId.get(id);
   if(!d)throw Error('unknown');
   return {deviceId:d.deviceId,accountId:d.accountId,state:d.state,
    revokedAt:null,publicIdentityKey:'key-'+id};
  }
 };
 const enrollments={
  binding(id){return {deviceId:id,accountId:'acct1',
   publicIdentityKey:'key-'+id,revokedAt:null};},
  policyView(){return {accountId:'acct1',
   policyProfile:'full',approvedCapabilities:['filesystem','terminal']};}
 };
 const connections={get(id){
  const d=byId.get(id);
  return {state:d.state==='online'?'connected':'disconnected',
   hardExpiresAt:Date.now()+120000};
 }};
 const route=createGoldAbV2HelperTarget({
  env,storage:{pool:db,redis,prefix:'lr:gold:fixture:'},
  accounts:{assertOperational(){return {accountId:'acct1',emailVerified:true};}},
  devices:fakeDevices,enrollments,connections,
  readJson:async req=>req.body,
  sendJson(res,status,body){res.status=status;res.body=body;return body;}
 });
 const endpoint=new URL('https://operator/v1/plugin/abv2/device-discover');
 const proof=(query='',onlineOnly=false)=>signGoldAbV2HelperTarget({
  identity,targetQuery:query,onlineOnly,purpose:'discover',key
 });
 const call=async p=>{
  const res={};
  assert.equal(await route({method:'POST',body:p},res,endpoint),true);
  return res;
 };
 const summary=await call(proof());
 assert.equal(summary.status,200);
 assert.equal(summary.body.status,'device_discovery');
 assert.equal(summary.body.total,100);
 assert.equal(summary.body.onlineCount,count(clean));
 assert.equal(summary.body.matches.length,5);
 assert.equal(summary.body.requestCreated,false);
 assert.equal(summary.body.helperReady,false);
 assert.equal(summary.body.approvalState,'not_issued');
 assert.equal(summary.body.complete,true);
 const named=await call(proof('VPS-ARM'));
 assert.equal(named.body.total,1);
 assert.equal(named.body.matches[0].shortId,shortId(0));
 const group=await call(proof('windows',true));
 assert.equal(group.body.total,19);
 assert.equal(group.body.offlineCount,19);
 const duplicate=await call(proof('THISPC'));
 assert.equal(duplicate.body.total,2);
 const exact=await call(proof(shortId(0)));
 assert.equal(exact.body.matches[0].deviceId,'dev0');
 assert.equal((await call(proof('SECRET-OTHER-ACCOUNT'))).body.total,0);
 const once=proof('linux',true);
 assert.equal((await call(once)).status,200);
 assert.equal((await call(once)).status,409);
 const changed=proof('linux',false);changed.onlineOnly=true;
 assert.equal((await call(changed)).status,401);
 const wrongPurpose=signGoldAbV2HelperTarget({
  identity,targetQuery:'linux',purpose:'resolve',key
 });
 assert.equal((await call(wrongPurpose)).status,403);
 // No route may issue A/B, grant, sessions, or touch another account.
 assert.equal(startedPair,0);assert.equal(issuedGrant,0);
 assert.ok(countDb>0);
 console.log('GOLD_ABV2_DISCOVERY_SIGNED_ACCOUNT_SCOPED_100_DEVICES=PASS');
 console.log('GOLD_ABV2_DISCOVERY_ONLINE_WINDOWS_VPS_ARM_SHORTID_DUPLICATES=PASS');
 console.log('GOLD_ABV2_DISCOVERY_NO_B_GRANT_OR_REQUEST_AND_REPLAY_DENY=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
