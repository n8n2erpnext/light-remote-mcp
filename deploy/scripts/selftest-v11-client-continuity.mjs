import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require=createRequire(import.meta.url);
const {
  decodeClientCapability,
  clientFingerprint,
  callWithClientContinuity
}=require('../../lib/plus-client-continuity.cjs');
const {toolHelperView}=require('../../lib/plus-tool-helper.js');

const now=Date.now();
const tokenFor=exp=>'o1.client.'+Buffer.from(JSON.stringify({
  scope:'agent-client',
  clientSessionId:'lrc_continuity_selftest_0001',
  agentId:'agent-continuity-selftest-0001',
  iat:now-1000,
  exp,
  jti:'continuity-selftest-jti'
})).toString('base64url')+'.sig';
const valid=tokenFor(now+60000);
const expired=tokenFor(now-1);
const invalidError=()=>{
  const e=new Error('operator_http_401');
  e.status=401;
  e.payload={ok:false,error:'agent_client_required',detail:'invalid'};
  return e;
};

assert.equal(decodeClientCapability(valid,{now})?.clientSessionId,'lrc_continuity_selftest_0001');
assert.equal(decodeClientCapability(expired,{now}),null);
assert.match(clientFingerprint(valid),/^[a-f0-9]{16}$/);

let calls=0;
const events=[];
const recovered=await callWithClientContinuity(async()=>{
  calls+=1;
  if(calls<3)throw invalidError();
  return {ok:true,value:'recovered'};
},{
  client:valid,
  delaysMs:[10,20,30],
  sleep:async()=>{},
  onEvent:event=>events.push(event),
  now:()=>now
});
assert.deepEqual(recovered,{ok:true,value:'recovered'});
assert.equal(calls,3);
assert.deepEqual(events.map(x=>x.type),['client_continuity_retry','client_continuity_retry','client_continuity_recovered']);

calls=0;
let exhausted=null;
try{
  await callWithClientContinuity(async()=>{calls+=1;throw invalidError();},{
    client:valid,
    delaysMs:[0,0],
    sleep:async()=>{},
    now:()=>now
  });
}catch(error){exhausted=error;}
assert.equal(calls,3);
assert.equal(exhausted?.status,503);
assert.equal(exhausted?.payload?.error,'agent_client_temporarily_unavailable');
assert.equal(exhausted?.payload?.retryable,true);
assert.equal(exhausted?.payload?.clientAction,'retry_same_client');

calls=0;
let expiredError=null;
try{
  await callWithClientContinuity(async()=>{calls+=1;throw invalidError();},{
    client:expired,
    delaysMs:[0,0,0],
    sleep:async()=>{},
    now:()=>now
  });
}catch(error){expiredError=error;}
assert.equal(calls,1);
assert.equal(expiredError?.status,401);
assert.equal(expiredError?.payload?.error,'agent_client_required');

const other401=Object.assign(new Error('operator_http_401'),{status:401,payload:{ok:false,error:'unauthorized_plus_bridge_call'}});
calls=0;
await assert.rejects(
  ()=>callWithClientContinuity(async()=>{calls+=1;throw other401;},{client:valid,delaysMs:[0],sleep:async()=>{},now:()=>now}),
  error=>error===other401
);
assert.equal(calls,1);

const helper=toolHelperView({context:{deviceId:'arm-local',sessionId:'s_test',agentId:'agent-test',platform:'linux'}});
assert.ok(helper.transport.continuity.includes('retry the same action'));
assert.ok(helper.transport.continuity.includes('Do not start a new A/B pairing'));
assert.ok(helper.safety.some(x=>x.includes('agent_client_temporarily_unavailable')&&x.includes('same client/target')));

const api=fs.readFileSync(new URL('../../api/operator.js',import.meta.url),'utf8');
assert.ok(api.includes("require('../lib/plus-client-continuity.cjs')"));
assert.ok(api.includes('callWithClientContinuity('));
assert.ok(api.includes("event.type==='client_continuity_recovered'"));
assert.ok(api.includes('clientFingerprint:event.fingerprint'));

console.log('v11-client-continuity-recovery=PASS');
console.log('v11-client-continuity-expired-not-retried=PASS');
console.log('v11-client-continuity-repair-without-repairing=PASS');
