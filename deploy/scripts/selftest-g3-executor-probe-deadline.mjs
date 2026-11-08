import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {ExecutorReadinessProbe} from '../../lib/executor-readiness-probe.mjs';
import {FleetRouter,FleetError} from '../../operator-host/fleet-router.mjs';

// A faulty spawn bridge must not keep pending/check() unresolved forever.
let resolveLate;
const runners=[()=>new Promise(resolve=>{resolveLate=resolve;}),async()=>true];
const monitor=new ExecutorReadinessProbe({
  runner:()=>runners.shift()?.()??true,timeoutMs:1000,
  failuresToDegrade:1,intervalMs:5000
});
const start=performance.now();
const first=await monitor.check();
assert.ok(performance.now()-start<3000,'a hung canary cannot stall watchdog indefinitely');
assert.equal(first.ready,false);
assert.equal(first.probeTimeouts,1);
assert.equal(first.checks,1);
assert.equal(first.consecutiveFailures,1);
const fleet=new FleetRouter({channelTtlMs:10000,commandLeaseMs:2500});
const node={accountId:'g3-cx',deviceId:'g3-cx-device',nodeId:'g3-cx-node'};
fleet.touch({...node,executorReady:monitor.status().ready});
assert.equal(fleet.view(node.nodeId).channelFresh,true);
assert.equal(fleet.view(node.nodeId).dispatchReady,false);
assert.throws(()=>fleet.enqueue({...node,jobId:'g3-hung-canary-denied'}),
 e=>e instanceof FleetError&&e.message==='target_node_executor_unavailable');
console.log('G3_HUNG_PROCESS_CANARY_FAILS_CLOSED_WITH_FRESH_CHANNEL=PASS');

const second=await monitor.check();
assert.equal(second.ready,true,'successful fresh canary must recover admission');
fleet.touch({...node,executorReady:monitor.status().ready});
assert.equal(fleet.view(node.nodeId).dispatchReady,true);
resolveLate(false);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(monitor.status().ready,true,'late failure from expired canary must not revert healthy state');
assert.equal(monitor.status().checks,2);
console.log('G3_EXPIRED_CANARY_LATE_RESPONSE_CANNOT_REVERT_RECOVERY=PASS');

monitor.lastCheckedAt=Date.now()-300000;
const stale=monitor.status();
assert.equal(stale.ready,false,'old successful canary is not current proof of executor health');
assert.equal(stale.stale,true);
fleet.touch({...node,executorReady:stale.ready});
assert.equal(fleet.view(node.nodeId).dispatchReady,false);
console.log('G3_OLD_EXECUTOR_PROBE_GOES_STALE_FAIL_CLOSED=PASS');
monitor.stop();
