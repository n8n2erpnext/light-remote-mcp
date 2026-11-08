import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createGoldProShareAccountProxy} from '../../plugin-server/account-pro-share.mjs';
import {createGoldProShareAccountHttp} from '../../operator-host/pro-share-account-http.mjs';
const origin='https://gold.example.test',token='fake-session-token-12345678901234567890';
const calls=[];
const proxy=createGoldProShareAccountProxy({enabled:true,origin,
 sessionToken:()=>token,callOperatorJson:async(method,path,body,headers)=>{
  calls.push({method,path,body,headers});return {ok:true};
 }});
const makeRes=()=>({status(v){this.code=v;return this},set(){return this},
 json(v){this.payload=v;return this}});
async function invoke(action,method='GET',body={},headers={}){
 const res=makeRes();
 await proxy({method,body,headers},res,action);return res;
}
const csrf='a'.repeat(43);
assert.equal((await invoke('pro-share-csrf')).code,200);
assert.equal(calls.at(-1).headers['x-light-account-session'],token);
assert.equal((await invoke('pro-share-invite','POST',
 {guestEmail:'x@example.test'},{origin:'https://attacker.test',
 'x-light-pro-share-csrf':csrf})).code,403);
assert.equal((await invoke('pro-share-share','POST',
 {deviceId:'owner-device'},{origin})).code,403);
assert.equal((await invoke('pro-share-share','POST',
 {deviceId:'owner-device',ownerAccountId:'attacker',agentId:'attacker',
 billedAccountId:'attacker',grantId:'attacker'},{
 origin,'x-light-pro-share-csrf':csrf})).code,200);
assert.deepEqual(calls.at(-1).body,{deviceId:'owner-device'});
assert.equal(calls.at(-1).path,'/v1/accounts/pro-share/share');
assert.equal((await invoke('pro-share-accept','POST',{
 ownerAccountId:'owner',inviteCode:'x'.repeat(32),actorAccountId:'attacker'},{
 origin,'x-light-pro-share-csrf':csrf})).code,200);
assert.deepEqual(calls.at(-1).body,{ownerAccountId:'owner',inviteCode:'x'.repeat(32)});
const off=createGoldProShareAccountProxy({enabled:false});
const pendingRes=makeRes();
await proxy({method:'GET',query:{deviceId:'dev1'},headers:{}},pendingRes,
 'pro-share-guest-pending');
assert.equal(pendingRes.code,200);
assert.equal(calls.at(-1).path,'/v1/accounts/pro-share/guest-pending?deviceId=dev1');
const approveRes=makeRes();
await proxy({method:'POST',headers:{origin,
 'x-light-pro-share-csrf':csrf},body:{deviceId:'dev1',
 requestId:'av2_'+'a'.repeat(32),expectedAttempt:1,bCode:'ABCD-2345',
 ownerAccountId:'spoof',guestAccountId:'spoof',grantId:'spoof'}},
 approveRes,'pro-share-guest-approve');
assert.equal(approveRes.code,200);
assert.deepEqual(calls.at(-1).body,{deviceId:'dev1',
 requestId:'av2_'+'a'.repeat(32),expectedAttempt:1,bCode:'ABCD-2345'});
const r=makeRes();
await off({method:'GET'},r,'pro-share-csrf');
assert.equal(r.code,404);
const disabled=createGoldProShareAccountHttp({env:{},sendJson:(res,status,payload)=>{
 res.status=status;res.payload=payload;
}});
const response={};
assert.equal(await disabled({method:'GET'},response,
 new URL('http://operator.local/v1/accounts/pro-share/overview')),true);
assert.equal(response.status,404);
assert.equal((await disabled({method:'GET'},response,
 new URL('http://operator.local/v1/accounts/other'))),false);
assert.throws(()=>createGoldProShareAccountHttp({env:{
 LR_GOLD_PRO_SHARE_ACCOUNT_HTTP:'1'},sendJson:()=>{}}),/pro_share_account_requires_core/);
const tokenProof=crypto.createHmac('sha256',token)
 .update('light-remote:pro-share:account-csrf:v1').digest('base64url');
let guestApproved=0;
const sendJson=(res,status,body)=>Object.assign(res,{status,body});
const accountHttp=createGoldProShareAccountHttp({
 env:{LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_ACCOUNT_HTTP:'1',
  LR_GOLD_PRO_SHARE_OWNER_ORIGIN:origin},
 pool:{query:async()=>({rows:[],rowCount:0}),connect:async()=>({release(){},query:async()=>({rows:[],rowCount:0})})},
 accounts:{assertOperational:id=>({accountId:id,plan:'pro',status:'active',
  email:'owner@example.test',emailVerified:true})},
 requireAccount:req=>{
  if(req.headers['x-light-account-session']!==token)throw Object.assign(Error('account_session_required'),{status:401});
  return {account:{accountId:'owner',emailVerified:true}};
 },
 accountSessionToken:req=>req.headers['x-light-account-session'],
 readJson:async req=>req.body,sendJson,
 guestApproval:{
  list:async(req,{deviceId})=>{
   assert.equal(req.headers['x-light-account-session'],token);
   assert.equal(deviceId,'dev1');return {pending:[]};
  },
  approve:async(req,scope)=>{
   assert.equal(req.headers['x-light-account-session'],token);
   assert.equal(scope.bCode,'ABCD-2345');guestApproved++;
   return {state:'granted',requestId:scope.requestId};
  }
 }
});
const operatorCall=async(path,method='GET',body={},extra={})=>{
 const res={};await accountHttp({method,body,headers:{
  'x-light-account-session':token,origin,
  'x-light-pro-share-csrf':tokenProof,...extra}},res,
  new URL('http://operator'+path));return res;
};
assert.equal((await operatorCall('/v1/accounts/pro-share/guest-pending?deviceId=dev1')).status,200);
assert.equal((await operatorCall('/v1/accounts/pro-share/guest-approve','POST',{
 deviceId:'dev1',requestId:'av2_'+'a'.repeat(32),expectedAttempt:1,
 bCode:'ABCD-2345'})).status,200);
assert.equal(guestApproved,1);
assert.equal((await operatorCall('/v1/accounts/pro-share/guest-approve','POST',{
 deviceId:'dev1',requestId:'av2_'+'a'.repeat(32),expectedAttempt:1,
 bCode:'ABCD-2345'},{'x-light-pro-share-csrf':'b'.repeat(43)})).status,403);
assert.equal(guestApproved,1);
console.log('GOLD_P2I4B2_GUEST_OWNER_B_ACCOUNT_SESSION_CSRF_ROUTE=PASS');
console.log('GOLD_P2I4_PRO_SHARE_ACCOUNT_PROXY_CSRF_ORIGIN_PRINCIPAL_FILTER=PASS');
console.log('GOLD_P2I4_PRO_SHARE_OWNER_HTTP_DEFAULT_OFF=PASS');
