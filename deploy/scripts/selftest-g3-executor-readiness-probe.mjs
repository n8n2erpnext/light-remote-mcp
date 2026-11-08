import assert from 'node:assert/strict';
import {ExecutorReadinessProbe,spawnExecutorCanary} from '../../lib/executor-readiness-probe.mjs';
import {FleetRouter,FleetError} from '../../operator-host/fleet-router.mjs';

assert.equal(await spawnExecutorCanary({timeoutMs:5000}),true,'real Node process canary failed');
assert.equal(await spawnExecutorCanary({execPath:'/no/such/gold-g3-executable',timeoutMs:1500}),false);
console.log('G3_NATIVE_PROCESS_CANARY_REAL_SPAWN=PASS');

const answers=[true,false,false,false,true,true];
const events=[];
const supervisor=new ExecutorReadinessProbe({
  runner:async()=>answers.shift()??true,
  failuresToDegrade:2,
  onTransition:state=>events.push(state.state)
});
const fleet=new FleetRouter({channelTtlMs:10000,commandLeaseMs:2500});
const owner={accountId:'g3-probe-uat',deviceId:'g3-probe-leaf',nodeId:'g3-probe-node'};
const touch=()=>fleet.touch({...owner,capabilities:['filesystem'],sessionCeiling:1,executorReady:supervisor.status().ready});
assert.equal(supervisor.status().ready,null);
touch();
assert.equal(fleet.view(owner.nodeId).executorReady,null,'unknown readiness must remain distinguishable from healthy');
await supervisor.check();touch();
assert.equal(fleet.view(owner.nodeId).executorReady,true);
assert.equal(fleet.view(owner.nodeId).dispatchReady,true);
await supervisor.check();touch();
assert.equal(fleet.view(owner.nodeId).executorReady,true,'one transient failure does not degrade healthy Agent');
await supervisor.check();touch();
assert.equal(fleet.view(owner.nodeId).executorReady,false,'second consecutive independent process failure degrades');
assert.equal(fleet.view(owner.nodeId).channelFresh,true,'heartbeat transport remains healthy');
assert.equal(fleet.view(owner.nodeId).readinessReason,'executor_unavailable');
assert.throws(()=>fleet.enqueue({...owner,jobId:'g3-cannot-dispatch'}),error=>error instanceof FleetError&&error.message==='target_node_executor_unavailable');
await supervisor.check();touch();
assert.equal(supervisor.status().ready,false);
assert.deepEqual(events,['healthy','unavailable']);
console.log('G3_FRESH_HEARTBEAT_INDEPENDENT_EXECUTOR_FAILURE_DENIED=PASS');
await supervisor.check();touch();
assert.equal(fleet.view(owner.nodeId).executorReady,true);
assert.equal(fleet.view(owner.nodeId).dispatchReady,true);
await supervisor.check();touch();
assert.deepEqual(events,['healthy','unavailable','healthy'],'stable readines must not repeat on every heartbeat');
console.log('G3_EXECUTOR_CANARY_FAILURE_RECOVERY_DEBOUNCED=PASS');

let resolveLast;
const pendingProbe=new ExecutorReadinessProbe({runner:()=>new Promise(resolve=>{resolveLast=resolve;}),onTransition:()=>{throw Error('cancelled_probe_must_not_notify');}});
const running=pendingProbe.check();
assert.equal(typeof resolveLast,'function');
pendingProbe.stop();
resolveLast(false);
await running;
assert.equal(pendingProbe.status().checks,0);
assert.equal(pendingProbe.status().ready,null);
console.log('G3_CANCELLED_PROBE_CANNOT_OVERRIDE_NEW_STATE=PASS');
