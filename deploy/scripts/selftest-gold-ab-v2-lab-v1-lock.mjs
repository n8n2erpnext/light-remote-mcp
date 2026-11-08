import assert from 'node:assert/strict';
import vm from 'node:vm';
import {goldAbV2LabV1Disabled} from '../../lib/gold-ab-v2-lab-v1-lock.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {registerPluginTools} from '../../plugin-server/tools.mjs';
import {AccountOperatorAdapter} from '../../plugin-server/operator-adapter.mjs';

assert.equal(goldAbV2LabV1Disabled({LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1:'1',
 LR_GOLD_INSTANCE_ID:'production'}),false);
assert.equal(goldAbV2LabV1Disabled({LR_GOLD_INSTANCE_ID:'abv2lab01'}),true);
assert.equal(goldAbV2LabV1Disabled({LR_GOLD_INSTANCE_ID:'abv2lab01',
 LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1:'0'}),true,
 'V1 must never revive by resetting the disposable lab flag');
assert.equal(goldAbV2LabV1Disabled({LR_GOLD_INSTANCE_ID:'goldabv2-production'}),true);
assert.equal(goldAbV2LabV1Disabled({LR_GOLD_INSTANCE_ID:'abv2lab01',
 LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1:'1'}),true);
const prev=Object.fromEntries(['LR_GOLD_INSTANCE_ID','LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1',
 'LR_GOLD_ABV2_LAB_SHORT_ID'].map(k=>[k,process.env[k]]));
process.env.LR_GOLD_INSTANCE_ID='abv2lab01';
process.env.LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1='1';
process.env.LR_GOLD_ABV2_LAB_SHORT_ID='X3AQQ6';
let wall;
const prot=AccountOperatorAdapter.prototype;
const old=Object.fromEntries(['pairBegin','pairRecover','pairPoll',
 'recoverAbV2Request','connectionHelper','discoverAbV2Devices','devices'].map(k=>[k,prot[k]]));
let legacyCalled=0;
try{
 const auth={enabled:true,identity:req=>req.headers['x-test-owner']==='owner'
   ?{username:'owner@example.invalid'}:null,
  csrfForRequest:()=> 'fixture-csrf',verifyRequestCsrf:(_req,code)=>code==='fixture-csrf'};
 wall=startLocalWall({host:'127.0.0.1',port:0,auth,
  getLocalStatus:async()=>({ok:true,cloudState:'connected'}),
  pairingCode:async()=>{legacyCalled++;return {code:'V1AA-V1BB'}}});
 await new Promise((resolve,reject)=>wall.server.listening?resolve():
  wall.server.once('listening',resolve).once('error',reject));
 const host='http://127.0.0.1:'+wall.server.address().port;
 const owner={'x-test-owner':'owner'};
 const home=await (await fetch(host+'/',{headers:owner})).text();
 assert.match(home,/id="abV2WallStatus"/);
 assert.doesNotMatch(home,/Short ID X3AQQ6/,'stale lab env is not device identity');
 assert.doesNotMatch(home,/V1 locked/,'the V1 lock is a backend policy, not Owner-facing header text');
 assert.match(home,/id="abV2ShortId"/);
 assert.match(home,/class="paircontrol" style="display:none"/);
 assert.match(home,/const labAbV2Only=true/);
 for(const fragment of home.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g))
  if(fragment[1].trim())new vm.Script(fragment[1],{filename:'abv2-lab-v1locked-home.js'});
 const post=await fetch(host+'/api/pairing-code',{method:'POST',
  headers:{...owner,'content-type':'application/json','x-light-remote-csrf':'fixture-csrf'},
  body:JSON.stringify({rotate:true})});
 assert.equal(post.status,423);
 assert.equal((await post.json()).error,'abv2_lab_legacy_v1_temporarily_disabled');
 assert.equal(legacyCalled,0);
 assert.equal((await fetch(host+'/api/approve?code=ABCD-2345',{headers:owner})).status,423);
 assert.equal((await fetch(host+'/api/approve',{method:'POST',headers:owner})).status,423);
 const approve=await (await fetch(host+'/approve',{headers:owner})).text();
 assert.match(approve,/abV2OwnerPreview/);
 assert.doesNotMatch(approve,/id="legacyApproveCard"|id="lookup"|id="code"/,
  'GoldABV2 must not emit V1 markup or legacy approval script');
 assert.match(approve,/id="abV2OwnerPreview" class="card ab2-shell"/);
 assert.doesNotMatch(approve,/id="abV2OwnerPreview" hidden/,'V2-only Lab should not conceal its signed approval surface');
 assert.match(approve,/Signed A\/B V2 requests unavailable/,'unavailable preview must not downgrade to legacy V1');
 assert.doesNotMatch(approve,/this Windows device/);
 assert.doesNotMatch(approve,/\.wrap>\.card\{display:none!important\}/);
 assert.match(approve,/A\/B V2 · Device authorization/);
 assert.match(approve,/title="Wall"/);
 assert.match(approve,/id="wallSidebar"/);
 assert.doesNotMatch(approve,/href="\/">Back to Wall<\/a>/);
 assert.match(approve,/href="https:\/\/goldabv2\.light-remote\.thaiduy\.digital\/account"/);
 assert.ok(approve.includes('id="abV2OwnerPreview"'),
  'V2 approval card must be present on the native Wall');
 assert.match(approve,/const wallCsrf="fixture-csrf"/,
  'Signed V2 page has its OWN request-scoped CSRF initializer');
 assert.doesNotMatch(approve,/id="lookup"|id="legacyApproveCard"|id="code"/,
  'GoldABV2 must omit the legacy V1 UI, not hide it');

 for(const fragment of approve.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g))
  if(fragment[1].trim())new vm.Script(fragment[1],{filename:'abv2-lab-v1locked-approve.js'});
 const registered=new Map();
 registerPluginTools({registerTool:(name,_cfg,fn)=>registered.set(name,fn)},
  {accountId:'owner',clientId:'oauth-agent',scopes:['remote:read']});
 const helper=registered.get('light_remote_connection_helper');
 const listDevices=registered.get('light_remote_list_devices');
 prot.pairBegin=async()=>{legacyCalled++;throw Error('unexpected_v1_start')};
 prot.pairPoll=async()=>{legacyCalled++;throw Error('unexpected_v1_poll')};
 prot.pairRecover=async()=>{legacyCalled++;throw Error('unexpected_v1_recover')};
 prot.recoverAbV2Request=async()=>null;
 prot.devices=async()=>[];
 let discoveries=0,issues=0;
 prot.discoverAbV2Devices=async({query='',onlineOnly=false}={})=>{
  discoveries++;
  return {status:'device_discovery',query,onlineOnly,total:1,
   matchedTotal:1,onlineCount:1,offlineCount:0,
   matches:[{deviceId:'dev1',shortId:'R01KAP',platform:'linux',
     architecture:'arm64',online:true}],
   helperReady:false,approvalState:'not_issued',requestCreated:false,
   complete:true,hasMore:false};
 };
 prot.connectionHelper=async()=>{legacyCalled++;throw Error('unexpected_working_session')};
 const noargs=(await helper({})).structuredContent;
 assert.equal(noargs.status,'device_discovery');
 assert.equal(noargs.onlineCount,1);
 assert.equal(noargs.matches[0].shortId,'R01KAP');
 assert.equal(noargs.requestCreated,false);
 const all=(await helper({targetQuery:'online'})).structuredContent;
 assert.equal(all.status,'device_discovery');
 assert.equal(all.onlineOnly,true);
 const arm=(await helper({targetQuery:'arm64'})).structuredContent;
 assert.equal(arm.query,'arm64');
 assert.equal(discoveries,3);
 const list=(await listDevices({})).structuredContent;
 assert.deepEqual(list.items,[],
  'legacy items must still contain granted devices only');
 assert.equal(list.accountDiscovery.onlineCount,1);
 assert.equal(list.accountDiscovery.matches[0].shortId,'R01KAP');
 assert.equal(list.accountDiscovery.requestCreated,false);
 assert.equal(discoveries,4);
 // Recovering an actual B request must take priority over the discovery fallback.
 prot.recoverAbV2Request=async()=>({status:'approval_required',code:'ABCD-2345',
   helperReady:false,approvalPath:'/account'});
 const pending=(await helper({})).structuredContent;
 assert.equal(pending.status,'approval_required');
 assert.equal(discoveries,4);
 // Agent picks nickname on the post-Owner-B Helper call, before working
 // context/session opens. No nickname is required for a ready result.
 prot.recoverAbV2Request=async()=>({status:'ready',pairedDevice:'R01KAP'});
 prot.connectionHelper=async(_group,{agentNickname=null}={})=>({status:'ready',
  sessionId:'s_fixture',sessionNickname:agentNickname,nicknameSource:agentNickname?'agent':null});
 const named=(await helper({agentNickname:'Claude Curious Otter'})).structuredContent;
 assert.equal(named.status,'ready');
 assert.equal(named.sessionId,'s_fixture');
 assert.equal(named.sessionNickname,'Claude Curious Otter');
 assert.equal(named.nicknameSource,'agent');
 const unnamed=(await helper({})).structuredContent;
 assert.equal(unnamed.status,'ready');
 assert.equal(unnamed.sessionNickname,null);
 prot.recoverAbV2Request=async()=>null;
 // After pending request expires, a still-valid B grant must recover ready
 // instead of incorrectly returning Discovery (observed after Lab restart).
 prot.devices=async()=>[{deviceId:'dev1'}];
 const grantedReady=(await helper({agentNickname:'Claude Curious Otter'})).structuredContent;
 assert.equal(grantedReady.status,'ready');
 assert.equal(grantedReady.sessionId,'s_fixture');
 assert.equal(grantedReady.sessionNickname,'Claude Curious Otter');
 assert.equal(discoveries,4,'grant ready must not silently degrade to Discovery');
 prot.devices=async()=>[];
 assert.equal(issues,0);
 const rejected=await helper({aCode:'ABCD-2345'});
 assert.equal(rejected.isError,true);
 assert.match(JSON.stringify(rejected),/abv2_lab_legacy_v1_temporarily_disabled/);
 const continuation=await helper({continuation:'a'.repeat(40)});
 assert.equal(continuation.isError,true);
 assert.equal(legacyCalled,0);
 console.log('GOLD_ABV2_LAB_V1_LOCK_UI_WALL_API_HELPER=PASS');
 // Production instance is never affected even if the flag is accidentally
 // set there. Legacy recovery must remain available for actual Gold.
 process.env.LR_GOLD_INSTANCE_ID='production';
 prot.pairRecover=async()=>{legacyCalled++;return {state:'pending',request:{
  userCode:'ABCD-2345',expiresAt:Date.now()+120000}}};
 const production=(await helper({})).structuredContent;
 assert.equal(production.status,'approval_required');
 const productionList=(await listDevices({})).structuredContent;
 assert.deepEqual(productionList.items,[]);
 assert.equal(Object.hasOwn(productionList,'accountDiscovery'),false,
  'production V1 list_devices response remains granted-only');
 assert.equal(legacyCalled,1);
 console.log('GOLD_ABV2_LAB_V1_LOCK_PROD_FALLBACK_PRESERVED=PASS');
}finally{
 if(wall?.server)await new Promise(resolve=>wall.server.close(resolve));
 for(const [k,f] of Object.entries(old))prot[k]=f;
 for(const [k,value] of Object.entries(prev)){
  if(value==null)delete process.env[k];else process.env[k]=value;
 }
}
