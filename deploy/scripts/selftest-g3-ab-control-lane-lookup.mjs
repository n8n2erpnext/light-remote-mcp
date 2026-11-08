import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createTrustedChannelRateLimiter} from '../../operator-host/trusted-channel-rate-limiter.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

const data=new Map();
const redis={eval:async(_script,{keys})=>{const n=(data.get(keys[0])||0)+1;data.set(keys[0],n);return n;}};
const limiter=createTrustedChannelRateLimiter({redis,prefix:'lr:gold:uat:',limits:{runtime:1,observer:1,control:2,fleet:1,'rm-live':1}});
const device='synthetic-g3-ab',now=180000;
await limiter.check(device,'status',now);
await assert.rejects(()=>limiter.check(device,'status',now),e=>e.status===429&&e.scope==='device-channel-observer');
assert.equal((await limiter.check(device,'access-lookup',now)).lane,'control');
assert.equal((await limiter.check(device,'access-approve',now)).lane,'control');
await assert.rejects(()=>limiter.check(device,'access-lookup',now),e=>e.status===429&&e.scope==='device-channel-control');
console.log('G3_AB_ACCESS_LOOKUP_CONTROL_LANE_ISOLATED_FROM_STATUS_429=PASS');

let approved=0,lookups=0,observerCalled=0,force429=false;
const wall=startLocalWall({
 host:'127.0.0.1',port:0,auth:{enabled:false},
 getLocalStatus:async()=>({deviceId:'synthetic-g3-ab',deviceName:'Gold test',cloudDesiredConnected:true,cloudState:'connected'}),
 getRemoteStatus:async()=>{observerCalled++;throw Object.assign(Error('rate_limited'),{status:429,payload:{retryAfterSeconds:18}});},
 getPendingAccess:async()=>{lookups++;if(force429)throw Object.assign(Error('rate_limited'),{status:429});return {ok:true,device:{displayName:'Gold test'},access:{pending:[{requestId:'pa_test_request',agentId:'test-agent',label:'Test',userCode:'ABCD-EFGH',expiresAt:Date.now()+60000}]}};},
 accessApprove:async id=>{assert.equal(id,'pa_test_request');approved++;return {granted:true};}
});
await once(wall.server,'listening');
const port=wall.server.address().port;
async function call(method,url,body=null){
 const payload=body===null?null:JSON.stringify(body);
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:url,method,headers:payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}},res=>{
   let buf='';res.on('data',d=>buf+=d);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(buf)}));
  });req.on('error',reject);req.end(payload);
 });
}
try{
 let a=await call('GET','/api/approve?code=ABCD-EFGH');
 assert.equal(a.status,200);assert.equal(a.body.request.requestId,'pa_test_request');
 let b=await call('POST','/api/approve',{code:'ABCD-EFGH',decision:'approve'});
 assert.equal(b.status,200);assert.equal(b.body.decision,'approved');
 assert.equal(approved,1);assert.equal(observerCalled,0);
 console.log('G3_AB_B_CODE_LOOKUP_APPROVE_WITH_OBSERVER_429=PASS');
 force429=true;
 a=await call('GET','/api/approve?code=ABCD-EFGH');
 assert.equal(a.status,429);assert.equal(a.body.error,'rate_limited');
 assert.equal(approved,1);
 console.log('G3_AB_CONTROL_429_NOT_REPORTED_AS_INVALID_CODE=PASS');
}finally{await wall.close();}
