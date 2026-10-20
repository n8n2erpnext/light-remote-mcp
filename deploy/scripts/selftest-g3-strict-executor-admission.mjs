import assert from 'node:assert/strict';
import {FleetRouter,FleetError} from '../../operator-host/fleet-router.mjs';

const ident={accountId:'g3-gold-strict-account',deviceId:'g3-gold-strict-device',nodeId:'g3-gold-strict-node'};
const strict=new FleetRouter({requireExecutorReady:true,channelTtlMs:10000,commandLeaseMs:2500});
let observed=strict.touch({...ident,sessionCeiling:2,capabilities:['filesystem']});
assert.equal(observed.channelFresh,true);
assert.equal(observed.executorReady,null);
assert.equal(observed.dispatchReady,false);
assert.equal(observed.readinessReason,'executor_unknown');
assert.throws(()=>strict.enqueue({...ident,jobId:'strict-denied-1'}),
  error=>error instanceof FleetError&&error.status===409&&error.message==='target_node_executor_unknown');
const idle=strict.poll({...ident,sessionCeiling:2});
assert.equal(idle.state,'idle');
assert.equal(idle.node.dispatchReady,false);
console.log('G3_STRICT_GOLD_UNKNOWN_EXECUTOR_DENIES_DISPATCH=PASS');

observed=strict.touch({...ident,executorReady:true,capabilities:['filesystem']});
assert.equal(observed.dispatchReady,true);
const command=strict.enqueue({...ident,jobId:'strict-safe-job',commandId:'strict-safe-command',payload:{op:'synthetic'}});
assert.equal(command.commandId,'strict-safe-command');
const accepted=strict.poll({...ident,executorReady:true,capabilities:['filesystem']});
assert.equal(accepted.state,'command');
assert.equal(accepted.command.commandId,command.commandId);
console.log('G3_STRICT_GOLD_EXPLICIT_HEALTHY_DISPATCH=PASS');

// In strict mode an authenticated frame with missing readiness is NOT a
// renewal of an old successful canary.
observed=strict.touch({...ident,capabilities:['filesystem']});
assert.equal(observed.executorReady,null);
assert.equal(observed.dispatchReady,false);
assert.equal(observed.readinessReason,'executor_unknown');
assert.throws(()=>strict.enqueue({...ident,jobId:'strict-denied-2'}),
  error=>error instanceof FleetError&&error.message==='target_node_executor_unknown');
console.log('G3_STRICT_GOLD_MISSING_HEARTBEAT_CANNOT_REUSE_PROBE=PASS');

observed=strict.touch({...ident,executorReady:false,capabilities:['filesystem']});
assert.equal(observed.readinessReason,'executor_unavailable');
assert.throws(()=>strict.enqueue({...ident,jobId:'strict-denied-3'}),
  error=>error instanceof FleetError&&error.message==='target_node_executor_unavailable');
console.log('G3_STRICT_GOLD_DEGRADED_EXECUTOR_DENIES_DISPATCH=PASS');

observed=strict.touch({...ident,executorReady:true,capabilities:['filesystem']});
assert.equal(observed.dispatchReady,true);
// Already dispatched command remains tracked. No automatic successful
// completion or replay is inferred from readiness changes.
assert.equal(strict.command(command.commandId).attempts,1);
console.log('G3_STRICT_GOLD_RECOVERY_DOES_NOT_COMPLETE_INFLIGHT=PASS');

// Compatibility mode remains explicit and unaffected until the owner
// deliberately enables strict admission during a coordinated UAT upgrade.
const legacy=new FleetRouter({channelTtlMs:10000,commandLeaseMs:2500});
observed=legacy.touch({...ident,sessionCeiling:2});
assert.equal(observed.executorReady,null);
assert.equal(observed.dispatchReady,true);
assert.equal(observed.readinessReason,'executor_unknown_compat');
assert.equal(observed.executorReadinessProven,false);
console.log('G3_LEGACY_COMPATIBILITY_OPT_IN_GATE=PASS');
