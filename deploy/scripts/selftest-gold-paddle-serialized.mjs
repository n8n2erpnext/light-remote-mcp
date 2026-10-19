import assert from 'node:assert/strict';
import { PaddleBilling } from '../../plugin-server/paddle-billing.mjs';

function billing(){
  return new PaddleBilling({
    config:{environment:'sandbox',apiKey:'',clientToken:'',proPriceId:'',webhookSecret:''},
    paddleClient:{},
    operatorCall:async()=>{throw Error('unexpected_side_effect')}
  });
}
const service=billing();
let release;
let writes=0;
service._persist=async()=>{
  writes++;
  if(writes===1) await new Promise(resolve=>{release=resolve});
};
const event={eventId:'evt_test_serial',eventType:'uat.synthetic',data:{}};
const a=service.processEvent(event);
const b=service.processEvent(event);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(writes,1,'second delivery must wait for first persistence');
assert.equal(service.pendingEventCount,2);
release();
const [first,second]=await Promise.all([a,b]);
assert.equal(first.duplicate,false);
assert.equal(second.duplicate,true);
assert.equal(writes,1,'duplicate must not commit a second event');
assert.equal(service.pendingEventCount,0);
await assert.rejects(()=>service.processEvent({eventType:'uat.synthetic',data:{}}),/paddle_event_id_required/);
let rejectCommit;
const blocked=billing();
blocked._persist=async()=>new Promise((_resolve,reject)=>{rejectCommit=reject});
const failure=blocked.processEvent({eventId:'evt_fail',eventType:'uat.synthetic',data:{}});
await new Promise(resolve=>setImmediate(resolve));
rejectCommit(Error('pg_commit_failed'));
await assert.rejects(failure,/pg_commit_failed/);
await assert.rejects(()=>blocked.processEvent({eventId:'evt_fail',eventType:'uat.synthetic',data:{}}),/pg_commit_failed/);
assert.equal(blocked.pendingEventCount,0);
const overflow=billing();
let gate;
overflow._persist=async()=>new Promise(resolve=>{gate=resolve});
const tasks=[];
for(let i=0;i<128;i++) tasks.push(overflow.processEvent({eventId:'evt_capacity_'+i,eventType:'uat.synthetic',data:{}}));
await new Promise(resolve=>setImmediate(resolve));
await assert.rejects(()=>overflow.processEvent({eventId:'evt_overflow',eventType:'uat.synthetic',data:{}}),error=>error?.status===503);
let processed=0;
overflow._persist=async()=>{processed++};
gate();
await Promise.all(tasks);
assert.equal(overflow.pendingEventCount,0);
assert.equal(processed,127);
console.log('GOLD_PADDLE_WEBHOOK_SERIAL_DUPLICATE=PASS');
console.log('GOLD_PADDLE_WEBHOOK_PERSISTENCE_FAIL_CLOSED=PASS');
console.log('GOLD_PADDLE_WEBHOOK_CAPACITY=PASS');
