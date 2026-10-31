import assert from 'node:assert/strict';
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
console.log('GOLD_P2I4_PRO_SHARE_ACCOUNT_PROXY_CSRF_ORIGIN_PRINCIPAL_FILTER=PASS');
console.log('GOLD_P2I4_PRO_SHARE_OWNER_HTTP_DEFAULT_OFF=PASS');
