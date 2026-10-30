import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {wallAbV2PreviewFragment} from '../../device-agent/wall-ab-v2-preview.mjs';

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
let calls=0,approvals=0,wall;
try{
 wall=startLocalWall({host:'127.0.0.1',port:0,auth,
  getLocalStatus:async()=>({cloudDesiredConnected:true,cloudState:'connected'}),
  getAbV2Pending:async({wallUsername})=>{
   calls++;assert.equal(wallUsername,'owner@example.invalid');
   return {ok:true,ownerApproveEnabled:true,pending:preview.pending};
  },getAbV2Approve:async data=>{
   approvals++;
   assert.deepEqual(data,{wallUsername:'owner@example.invalid',
    requestId,expectedAttempt:1,bCode:'ABCD-2345'});
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
 assert.equal(json.pending.length,1);
 assert.ok(!JSON.stringify(json).includes('bCode'));
 const html=await (await fetch(url+'/approve',{headers:{'x-test-owner':'owner'}})).text();
 assert.match(html,/id="abV2OwnerPreview" hidden/);
 assert.match(html,/\/api\/abv2\/pending/);
 assert.match(html,/id="lookup"/,'must retain legacy V1 approval UI');
 assert.match(html,/id="approve"/,'legacy V1 approve unaffected');
 for(const fragment of html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g))
  if(fragment[1].trim())new vm.Script(fragment[1],{filename:'abv2-wall-approve-inline.js'});
 assert.match(wallAbV2PreviewFragment,/ownerApproveEnabled===true/);
 assert.match(wallAbV2PreviewFragment,/\/api\/abv2\/approve/);
 assert.ok(!wallAbV2PreviewFragment.includes('result.bCode'));
 const post=async (owner,csrf,body)=>fetch(url+'/api/abv2/approve',{
  method:'POST',headers:{'content-type':'application/json','x-test-owner':owner,
   ...(csrf?{'x-light-remote-csrf':csrf}:{})},body:JSON.stringify(body)
 });
 const proof={requestId,expectedAttempt:1,bCode:'ABCD-2345',ownerAccountId:'forged',agentId:'forged'};
 assert.equal((await post('', 'fixture-csrf',proof)).status,401);
 assert.equal((await post('recovery','fixture-csrf',proof)).status,403);
 assert.equal((await post('owner',null,proof)).status,403);
 assert.equal((await post('owner','fixture-csrf',{...proof,bCode:'NOTA-BBBB'})).status,400);
 assert.equal(approvals,0);
 const grant=await post('owner','fixture-csrf',proof);
 assert.equal(grant.status,200);
 assert.equal((await grant.json()).state,'granted');
 assert.equal(approvals,1);
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
}finally{if(wall)await wall.close();}
const agent=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../../plugin-server/device-public.mjs',import.meta.url),'utf8');
assert.match(agent,/channelRequest\(state,hub,'abv2-pending-preview',\{\}\)/);
assert.match(agent,/assertNotificationOwnerEmail\(result.accountEmail,wallUsername\)/);
assert.match(agent,/getAbV2Pending:async\(\{wallUsername\}\)=>remoteAbV2PendingPreview\(hub,\{wallUsername\}\)/);
assert.match(router,/'abv2-pending-preview'/);
assert.match(router,/'abv2-owner-approve'/);
assert.match(agent,/channelRequest\(state,hub,'abv2-owner-approve'/);
assert.match(agent,/getAbV2Approve:async data=>remoteAbV2OwnerApprove\(hub,data\)/);
console.log('GOLD_ABV2_SIGNED_CHANNEL_WALL_OWNER_PREVIEW_AUTH_NO_GRANT=PASS');
