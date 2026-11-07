import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {wallAbV2PreviewFragment} from '../../device-agent/wall-ab-v2-preview.mjs';
import {goldAbV2LabWallBOnly} from '../../lib/gold-ab-v2-lab-v1-lock.mjs';
const labKeys=['LR_GOLD_INSTANCE_ID','LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1','LR_GOLD_ABV2_LAB_SIGNED_WALL_B_ONLY'];
const previousLabEnv=Object.fromEntries(labKeys.map(k=>[k,process.env[k]]));

const requestId='av2_'+'b'.repeat(32);
const preview={ok:true,deviceId:'dev1',accountEmail:'owner@example.invalid',
 pending:[{requestId,state:'pending',attempt:1,expiresAt:Date.now()+180000,
  aCode:'ABCD02-GHFDX',requester:'Agent one'}]};
const signed={binding:{deviceId:'dev1',accountId:'owner1'},
 device:{deviceId:'dev1'},payload:{ownerAccountId:'spoofed',deviceId:'other-device'}};
let verified=0,served=0;
const deps={
 readJson:async()=>({payload:{deviceId:'other-device',ownerAccountId:'victim'}}),
 verifiedChannelContext:async(_body,action)=>{
  assert.equal(action,'abv2-pending-preview');verified++;return signed;},
 goldAbV2SignedPreview:async ctx=>{served++;assert.equal(ctx,signed);return preview;},
 sendJson:(res,status,body)=>{res.status=status;res.body=body;return body}
};
const route=new URL('http://operator/v1/device-channel/abv2-pending-preview');
const res={};
const good=await handleDeviceChannelRoutes({method:'POST'},res,route,deps);
assert.equal(res.status,200);
assert.equal(good.pending[0].requestId,requestId);
assert.equal(verified,1);assert.equal(served,1);
const disabled={...deps,goldAbV2SignedPreview:null};
const off={};
await handleDeviceChannelRoutes({method:'POST'},off,route,disabled);
assert.equal(off.status,404);
assert.equal(verified,1,'flag OFF must avoid even parsing signed envelope');
const badProof={...deps,verifiedChannelContext:async()=>{throw Error('invalid_device_proof');}};
await assert.rejects(()=>handleDeviceChannelRoutes({method:'POST'}, {},route,badProof),/invalid_device_proof/);
assert.equal(served,1,'no pending preview on invalid signature');
const approvalRoute=new URL('http://operator/v1/device-channel/abv2-owner-approve');
let approvalInvoked=0,approvalVerified=0;
const approvalDeps={...deps,goldAbV2SignedApproval:async ctx=>{
 approvalInvoked++;assert.equal(ctx,signed);
 return {ok:true,state:'granted',requestId,agentId:'agent-one'};
},verifiedChannelContext:async(_body,action)=>{
 assert.equal(action,'abv2-owner-approve');
 approvalVerified++;return signed;
}};
const approveRes={};
await handleDeviceChannelRoutes({method:'POST'},approveRes,approvalRoute,approvalDeps);
assert.equal(approveRes.status,200);
assert.equal(approvalInvoked,1);
assert.equal(approvalVerified,1);
const offApprove={};
await handleDeviceChannelRoutes({method:'POST'},offApprove,approvalRoute,{
 ...approvalDeps,goldAbV2SignedApproval:null
});
assert.equal(offApprove.status,404);
assert.equal(approvalVerified,1,'disabled approve must not even read signed envelope');
await assert.rejects(
 ()=>handleDeviceChannelRoutes({method:'POST'},{},approvalRoute,{
  ...approvalDeps,verifiedChannelContext:async()=>{throw Error('invalid_device_proof')}
 }),/invalid_device_proof/);
assert.equal(approvalInvoked,1,'invalid signed action never mutates grant');

const auth={
 enabled:true,
 identity:req=>req.headers['x-test-owner']==='owner'?{username:'owner@example.invalid'}:
  req.headers['x-test-owner']==='recovery'?{username:'local-recovery'}:null,
 csrfForRequest:()=> 'fixture-csrf',verifyRequestCsrf:(req,token)=>
  token==='fixture-csrf'&&req.headers['x-light-remote-csrf']==='fixture-csrf'
};
let calls=0,approvals=0,wall,approvalEnabled=true,pairingMode='legacy_allowed';
let signedConsentRequired=true,expectedConsent='a'.repeat(32);
try{
 wall=startLocalWall({host:'127.0.0.1',port:0,auth,
  getLocalStatus:async()=>({cloudDesiredConnected:true,cloudState:'connected'}),
  getRemoteStatus:async()=>({ok:true,pairingMode}),
  getAbV2Pending:async({wallUsername})=>{
   calls++;assert.equal(wallUsername,'owner@example.invalid');
   return {ok:true,ownerApproveEnabled:approvalEnabled,
    ownerConsentRequired:signedConsentRequired,pending:preview.pending};
  },getAbV2Approve:async data=>{
   approvals++;
   assert.deepEqual(data,{wallUsername:'owner@example.invalid',
    requestId,expectedAttempt:1,bCode:'ABCD-2345',
    consentCode:expectedConsent});
   return {ok:true,state:'granted',requestId,agentId:'agent-one',
    expiresAt:Date.now()+200000,absoluteExpiresAt:Date.now()+86400000};
  }});
 await new Promise((resolve,reject)=>
  wall.server.listening?resolve():wall.server.once('listening',resolve).once('error',reject));
 const url='http://127.0.0.1:'+wall.server.address().port;
 const unauth=await fetch(url+'/api/abv2/pending');
 assert.equal(unauth.status,401);
 assert.equal(calls,0);
 const recovery=await fetch(url+'/api/abv2/pending',{headers:{'x-test-owner':'recovery'}});
 assert.equal(recovery.status,403);
 assert.equal(calls,0,'recovery username is not authenticated account email');
 const allowed=await fetch(url+'/api/abv2/pending',{headers:{'x-test-owner':'owner'}});
 assert.equal(allowed.status,200);
 const json=await allowed.json();
 assert.equal(json.ownerApproveEnabled,true,
  'Owner B approval must be advertised to Local Wall only after signed Operator approval gate');
 assert.equal(json.pending.length,1);
 assert.ok(!JSON.stringify(json).includes('bCode'));
 approvalEnabled=false;
 const offApproval=await fetch(url+'/api/abv2/pending',{headers:{'x-test-owner':'owner'}});
 assert.equal(offApproval.status,200);
 assert.equal((await offApproval.json()).ownerApproveEnabled,false,
  'Wall must hide owner B approval unless source gates explicitly enable it');
 approvalEnabled=true;
 const html=await (await fetch(url+'/approve',{headers:{'x-test-owner':'owner'}})).text();
 assert.match(html,/id="lookup"/,'signed legacy_allowed preserves only V1 approval surface');
 assert.match(html,/id="approve"/,'signed legacy_allowed preserves V1 approve');
 assert.doesNotMatch(html,/id="abV2OwnerPreview"/,'V2 must not be guessed in explicitly legacy mode');
 pairingMode='abv2_only';
 const v2html=await (await fetch(url+'/approve',{headers:{'x-test-owner':'owner'}})).text();
 assert.match(v2html,/id="abV2OwnerPreview" class="card ab2-shell"/);
 assert.doesNotMatch(v2html,/id="legacyApproveCard"|id="lookup"|id="code"/,
  'signed V2-only must omit the V1 DOM entirely');
 assert.match(v2html,/\/api\/abv2\/pending/);
 pairingMode='unknown';
 const unknown=await (await fetch(url+'/approve',{headers:{'x-test-owner':'owner'}})).text();
 assert.doesNotMatch(unknown,/id="legacyApproveCard"|id="lookup"|id="code"/,
  'unknown signed authority cannot expose any V1 control');
 assert.match(unknown,/Agent authorization unavailable/);
 assert.doesNotMatch(unknown,/id="abV2OwnerPreview"/,'unsigned unknown must never guess V2 or V1');
 pairingMode='abv2_only';
 for(const fragment of v2html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g))
  if(fragment[1].trim())new vm.Script(fragment[1],{filename:'abv2-wall-approve-inline.js'});
 assert.match(wallAbV2PreviewFragment,/ownerApproveEnabled===true/);
 assert.match(wallAbV2PreviewFragment,/class="card ab2-shell"/);
 assert.match(wallAbV2PreviewFragment,/className='btn primary'/);
 assert.doesNotMatch(wallAbV2PreviewFragment,/background:#205dc5|background:#111b27/);
 assert.doesNotMatch(wallAbV2PreviewFragment,/this Windows device/);

 assert.match(wallAbV2PreviewFragment,/B code from requesting Agent/);
 assert.match(wallAbV2PreviewFragment,/fetch\('\/api\/abv2\/approve'/);
 assert.ok(!wallAbV2PreviewFragment.includes('result.bCode'));
 const post=async (owner,csrf,body)=>fetch(url+'/api/abv2/approve',{
  method:'POST',headers:{'content-type':'application/json','x-test-owner':owner,
   ...(csrf?{'x-light-remote-csrf':csrf}:{})},body:JSON.stringify(body)
 });
 const proof={requestId,expectedAttempt:1,bCode:'ABCD-2345',consentCode:'a'.repeat(32),ownerAccountId:'forged',agentId:'forged'};
 assert.equal((await post('', 'fixture-csrf',proof)).status,401);
 assert.equal((await post('recovery','fixture-csrf',proof)).status,403);
 assert.equal((await post('owner',null,proof)).status,403);
 assert.equal((await post('owner','fixture-csrf',{...proof,bCode:'NOTA-BBBB'})).status,400);
 assert.equal((await post('owner','fixture-csrf',{...proof,consentCode:''})).status,400);
 assert.equal(approvals,0);
 const grant=await post('owner','fixture-csrf',proof);
 assert.equal(grant.status,200);
 assert.equal((await grant.json()).state,'granted');
 assert.equal(approvals,1);
 // Operator-signed B-only is sufficient WITHOUT a matching local env flag;
 // the Wall MUST NOT invent a second consent challenge from local settings.
 signedConsentRequired=false;expectedConsent=undefined;
 const signedBOnly=await post('owner','fixture-csrf',
   {requestId,expectedAttempt:1,bCode:'ABCD-2345'});
 assert.equal(signedBOnly.status,200);
 assert.equal(approvals,2);
 // Same real Local Wall handler, but strictly isolated Lab Owner login + B.
 process.env.LR_GOLD_INSTANCE_ID='abv2lab01';
 process.env.LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1='1';
 process.env.LR_GOLD_ABV2_LAB_SIGNED_WALL_B_ONLY='1';
 assert.equal(goldAbV2LabWallBOnly(),true);
 assert.equal((await post('owner',null,{requestId,expectedAttempt:1,bCode:'ABCD-2345'})).status,403);
 assert.equal((await post('', 'fixture-csrf',{requestId,expectedAttempt:1,bCode:'ABCD-2345'})).status,401);
 assert.equal((await post('owner','fixture-csrf',{requestId,expectedAttempt:1,bCode:'INVALID'})).status,400);
 // Local env says B-only but the signed Operator mode REQUIRES consent:
 // owner must not be granted until the policy has been satisfied.
 signedConsentRequired=true;
 assert.equal((await post('owner','fixture-csrf',
   {requestId,expectedAttempt:1,bCode:'ABCD-2345'})).status,400);
 assert.equal(approvals,2);
 signedConsentRequired=false;
 const localBOnly=await post('owner','fixture-csrf',{requestId,expectedAttempt:1,bCode:'ABCD-2345'});
 assert.equal(localBOnly.status,200);
 assert.equal((await localBOnly.json()).state,'granted');
 assert.equal(approvals,3);
 assert.equal((await (await fetch(url+'/api/abv2/pending',{headers:{'x-test-owner':'owner'}})).json()).ownerConsentRequired,false);
 signedConsentRequired=undefined;
 assert.equal((await fetch(url+'/api/abv2/pending',{headers:{'x-test-owner':'owner'}})).status,503,
  'unknown signed consent mode is not B-only');
 assert.equal((await post('owner','fixture-csrf',
   {requestId,expectedAttempt:1,bCode:'ABCD-2345'})).status,409,
  'cannot mutate when signed consent mode is missing');
 assert.equal(approvals,3);
 assert.match(wallAbV2PreviewFragment,/if\(consentRequired\)card.append\(consent\)/);
 await wall.close();wall=null;
 const fail=startLocalWall({host:'127.0.0.1',port:0,auth,
  getAbV2Pending:async()=>{throw Object.assign(Error('not_found'),{status:404});}});
 wall=fail;
 await new Promise(resolve=>wall.server.listening?resolve():wall.server.once('listening',resolve));
 const disabledApprove=await fetch('http://127.0.0.1:'+wall.server.address().port+'/api/abv2/approve',
  {method:'POST',headers:{'x-test-owner':'owner','x-light-remote-csrf':'fixture-csrf',
   'content-type':'application/json'},body:JSON.stringify({requestId,expectedAttempt:1,bCode:'ABCD-2345'})});
 assert.equal(disabledApprove.status,404);
 const unavailable=await fetch('http://127.0.0.1:'+wall.server.address().port+'/api/abv2/pending',
  {headers:{'x-test-owner':'owner'}});
 assert.equal(unavailable.status,404);
}finally{if(wall)await wall.close();
 for(const [k,v] of Object.entries(previousLabEnv)){
  if(v==null)delete process.env[k];else process.env[k]=v;
 }
}
const agent=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../../plugin-server/device-public.mjs',import.meta.url),'utf8');
assert.match(agent,/channelRequest\(state,hub,'abv2-pending-preview',\{\}\)/);
assert.match(agent,/assertNotificationOwnerEmail\(result.accountEmail,wallUsername\)/);
assert.match(agent,/getAbV2Pending:async\(\{wallUsername\}\)=>remoteAbV2PendingPreview\(hub,\{wallUsername\}\)/);
assert.match(router,/'abv2-pending-preview'/);
assert.match(router,/'abv2-owner-approve'/);
assert.match(agent,/channelRequest\(state,hub,'abv2-owner-approve'/);
assert.match(agent,/getAbV2Approve:async data=>remoteAbV2OwnerApprove\(hub,data\)/);
const operatorPreview=fs.readFileSync(new URL('../../operator-host/gold-ab-v2-signed-preview.mjs',import.meta.url),'utf8');
const localWallSource=fs.readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
const nativeIpc=fs.readFileSync(new URL('../../device-agent/desktop-abv2-native-ipc-v4.mjs',import.meta.url),'utf8');
assert.match(operatorPreview,/ownerConsentRequired:!goldAbV2LabWallBOnly\(env\)/);
assert.match(agent,/ownerConsentRequired:result.ownerConsentRequired/);
assert.match(agent,/ownerConsentRequired:answer.ownerConsentRequired/);
assert.match(agent,/const authority=await remoteAbV2PendingPreview\(hub,\{wallUsername\}\)/);
assert.match(localWallSource,/ownerConsentRequired:response.ownerConsentRequired/);
assert.match(nativeIpc,/typeof signed.ownerConsentRequired!=='boolean'/);
assert.doesNotMatch(localWallSource,/ownerConsentRequired:!goldAbV2LabWallBOnly\(\)/);
console.log('GOLD_ABV2_SIGNED_CONSENT_OPERATOR_AUTHORITY_NO_LOCAL_ENV_DRIFT_PASS');
console.log('GOLD_ABV2_SIGNED_CHANNEL_WALL_OWNER_PREVIEW_AUTH_NO_GRANT=PASS');
