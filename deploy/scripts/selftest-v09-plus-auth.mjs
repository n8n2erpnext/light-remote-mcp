import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPlusAuth } from '../../gateway/plus-auth.mjs';

const key=crypto.randomBytes(32),requests=new Map();let activeGrant=null,seq=0;
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const sign=(kind,payload)=>{const body=enc({kind,payload}),mac=crypto.createHmac('sha256',key).update(body).digest('base64url');return `t.${body}.${mac}`;};
const verify=(kind,token)=>{const [p,body,mac]=String(token||'').split('.');if(p!=='t'||!body||!mac)return null;const expected=crypto.createHmac('sha256',key).update(body).digest('base64url');if(mac!==expected)return null;const row=JSON.parse(Buffer.from(body,'base64url').toString());return row.kind===kind?row.payload:null;};
const wall={signOAuthToken:sign,verifyOAuthToken:verify};
const access={
  requestAccess:async ({agentId,deviceId,label})=>{if(activeGrant?.deviceId===deviceId)return {access:{state:'approved',grant:activeGrant}};const requestId=`pa_selftest_request_${String(++seq).padStart(8,'0')}`,pollToken=`polltoken_${crypto.randomBytes(24).toString('base64url')}`,request={requestId,deviceId,agentId,label,userCode:'ABCD-EFGH',expiresAt:Date.now()+600000,pollToken};requests.set(requestId,request);return {access:{state:'pending',request,pollToken}};},
  pollAccess:async ({requestId,pollToken})=>{const row=requests.get(requestId);if(!row||row.pollToken!==pollToken)throw Object.assign(new Error('plus_authorization_not_found'),{status:404});return activeGrant?.deviceId===row.deviceId?{access:{state:'approved',grant:activeGrant}}:{access:{state:'pending',request:row}};},
  getAccessRequest:async id=>({authorization:requests.get(id)}),listAccessRequests:async()=>({pending:[...requests.values()]}),
  assertGrant:async id=>{if(!activeGrant||activeGrant.grantId!==id)throw Object.assign(new Error('device_access_grant_required'),{status:401});return {grant:activeGrant,device:{nodeId:'arm'}};}
};
const plus=createPlusAuth(wall,access);
function response(){return {statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},type(){return this;},send(v){this.body=v;return this;},set(){return this;}};}
const agentA='agent-plus-selftest-0001',agentB='agent-plus-selftest-0002',deviceId='dev_plus_selftest_arm';
let res=response();await plus.begin({body:{agentId:agentA,deviceId,label:'ChatGPT A'}},res);assert.equal(res.statusCode,201);const auth=res.body.authorization;assert.equal(auth.deviceId,deviceId);assert.equal(auth.approvalSurface,'device-local-wall');assert.equal(auth.localWallUrl,'http://127.0.0.1:5491/');assert.match(auth.userCode,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
res=response();await plus.poll({body:{requestId:auth.requestId,pollToken:auth.pollToken}},res);assert.equal(res.statusCode,202);
activeGrant={grantId:'dag_selftest_grant_00000001',deviceId,connectionId:'dc_selftest_00000001',expiresAt:Date.now()+7200000};
res=response();await plus.poll({body:{requestId:auth.requestId,pollToken:auth.pollToken}},res);assert.equal(res.statusCode,200);const tokenA=res.body.session.token;assert.equal(res.body.session.grantId,activeGrant.grantId);assert.equal(res.body.session.deviceId,deviceId);
let next=false;res=response();await plus.requireSession({get:()=>tokenA},res,()=>{next=true;});assert.equal(next,true);const identity=verify('plus',tokenA);assert.equal(identity.deviceId,deviceId);assert.equal(identity.agentId,undefined);
next=false;res=response();plus.requireAgent({plusIdentity:identity,body:{agentId:agentB}},res,()=>{next=true;});assert.equal(next,true);
next=false;res=response();plus.requireGrantedNode({plusIdentity:{...identity,nodeId:'arm'},body:{agentId:agentB,nodeId:'amd'}},res,()=>{next=true;});assert.equal(next,false);assert.equal(res.statusCode,403);
res=response();await plus.begin({body:{agentId:agentB,deviceId,label:'ChatGPT B'}},res);assert.equal(res.statusCode,200);assert.equal(res.body.status,'approved');assert.equal(res.body.session.grantId,activeGrant.grantId);
activeGrant=null;res=response();await plus.begin({body:{agentId:agentA,deviceId:'dev_plus_selftest_other',label:'ChatGPT other'}},res);assert.equal(res.statusCode,201);
console.log('v09-plus-auth-device-grant=PASS');
console.log('v09-plus-auth-multi-agent-one-approval=PASS');
console.log('v09-plus-auth-device-target-isolation=PASS');
