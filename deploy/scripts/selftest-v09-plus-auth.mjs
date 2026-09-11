import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPlusAuth } from '../../gateway/plus-auth.mjs';

const key=crypto.randomBytes(32);
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const sign=(kind,payload)=>{
  const body=enc({kind,payload});
  const mac=crypto.createHmac('sha256',key).update(body).digest('base64url');
  return `t.${body}.${mac}`;
};
const verify=(kind,token)=>{
  const [p,body,mac]=String(token||'').split('.');
  if(p!=='t'||!body||!mac)return null;
  const expected=crypto.createHmac('sha256',key).update(body).digest('base64url');
  if(mac!==expected)return null;
  const row=JSON.parse(Buffer.from(body,'base64url').toString());
  return row.kind===kind?row.payload:null;
};
const plus=createPlusAuth({signOAuthToken:sign,verifyOAuthToken:verify});
function response(){
  return {statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},type(){return this;},send(v){this.body=v;return this;},set(){return this;}};
}
const agentId='agent-plus-selftest-0001';
let res=response();
plus.begin({body:{agentId,label:'selftest'}},res);
assert.equal(res.statusCode,201);
const auth=res.body.authorization;
assert.match(auth.requestId,/^pa_/);
assert.match(auth.userCode,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
assert.ok(auth.activationUrl.includes('/plus-authorize?id='));

res=response();
plus.poll({body:{requestId:auth.requestId,pollToken:auth.pollToken}},res);
assert.equal(res.statusCode,202);
assert.equal(res.body.status,'pending');

res=response();
plus.approve({params:{id:auth.requestId}},res);
assert.equal(res.statusCode,200);
assert.equal(res.body.authorization.agentId,agentId);
res=response();
plus.poll({body:{requestId:auth.requestId,pollToken:auth.pollToken}},res);
assert.equal(res.statusCode,200);
assert.equal(res.body.status,'approved');
const token=res.body.session.token;
assert.equal(res.body.session.agentId,agentId);

res=response();
plus.poll({body:{requestId:auth.requestId,pollToken:auth.pollToken}},res);
assert.equal(res.statusCode,404);

let next=false;
res=response();
plus.requireSession({get:()=>token},res,()=>{next=true;});
assert.equal(next,true);
const req={plusIdentity:verify('plus',token),body:{agentId}};
next=false; res=response();
plus.requireAgent(req,res,()=>{next=true;});
assert.equal(next,true);

next=false; res=response();
plus.requireAgent({plusIdentity:req.plusIdentity,body:{agentId:'agent-plus-selftest-OTHER'}},res,()=>{next=true;});
assert.equal(next,false);
assert.equal(res.statusCode,403);
assert.equal(res.body.error,'plus_agent_mismatch');
console.log('v09-plus-auth-state-machine=PASS');