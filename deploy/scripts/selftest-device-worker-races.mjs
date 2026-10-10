import assert from 'node:assert/strict';
import {DeviceWorkerLimiter} from '../../lib/device-worker-limiter.mjs';
let cap=1,current=0,peak=0;
const gate=new DeviceWorkerLimiter({limit:()=>cap,maxWaiting:4});
const resolvers=[];
function task(tag){
 return gate.run(async()=>{
   current++;peak=Math.max(peak,current);
   await new Promise(resolve=>resolvers.push({tag,resolve}));
   current--;return tag;
 });
}
async function tick(){await new Promise(resolve=>setImmediate(resolve));}
const a=task('A');await tick();const b=task('B');
assert.equal(gate.size(),1);assert.equal(gate.waiting.length,1);
resolvers.find(r=>r.tag==='A').resolve();await tick();
assert.equal(gate.size(),1);
const c=task('C');await tick();
assert.equal(gate.size(),1,'no new job can steal reserved waiters slot');
assert.equal(gate.waiting.length,1);
resolvers.find(r=>r.tag==='B').resolve();await tick();
assert.equal(gate.size(),1);
resolvers.find(r=>r.tag==='C').resolve();
assert.deepEqual(await Promise.all([a,b,c]),['A','B','C']);
assert.equal(peak,1);

cap=3;const running=[task('D'),task('E'),task('F')];await tick();
assert.equal(gate.size(),3);
cap=1;const queued=task('G');await tick();
assert.equal(gate.size(),3,'downgrade never force-kills running jobs');
assert.equal(gate.waiting.length,1);
for(const label of ['D','E']){resolvers.find(r=>r.tag===label).resolve();await tick();}
assert.equal(gate.size(),1);
assert.equal(gate.waiting.length,1,'downgrade waits until below Free cap');
resolvers.find(r=>r.tag==='F').resolve();await tick();
assert.equal(gate.size(),1);
assert.equal(gate.waiting.length,0);
resolvers.find(r=>r.tag==='G').resolve();
assert.deepEqual(await Promise.all([...running,queued]),['D','E','F','G']);
assert.equal(gate.size(),0);
console.log('device_worker_slot_handoff_no_oversubscription=PASS');
console.log('device_worker_downgrade_preserves_inflight_and_caps_next=PASS');
