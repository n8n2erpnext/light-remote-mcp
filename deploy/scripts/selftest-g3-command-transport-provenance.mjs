import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {FleetRouter} from '../../operator-host/fleet-router.mjs';
let t=500_000;
const events=[],base={accountId:'g3-transport-account',deviceId:'g3-transport-device',nodeId:'g3-transport-node',executorReady:true,capabilities:['filesystem'],sessionCeiling:1};
const fleet=new FleetRouter({now:()=>t,emit:e=>events.push(e),requireExecutorReady:true,channelTtlMs:12000,commandLeaseMs:2500});
fleet.touch(base);
function round({transport,resultTransport,index}){
  const commandId='g3-transport-'+index,jobId='g3-transport-job-'+index;
  fleet.enqueue({...base,commandId,jobId,payload:{kind:'read-only-test'}});
  const dispatched=fleet.poll({...base,transport});
  assert.equal(dispatched.command.commandId,commandId);
  const dispatch=events.at(-1);
  assert.equal(dispatch.type,'node_command_dispatched');
  assert.equal(dispatch.dispatchTransport,transport);
  assert.equal(dispatch.firstDispatchTransport,transport);
  fleet.complete({...base,commandId,resultTransport});
  const completed=events.at(-1);
  assert.equal(completed.type,'node_command_completed');
  assert.equal(completed.firstDispatchTransport,transport);
  assert.equal(completed.dispatchTransport,transport);
  assert.equal(completed.resultTransport,resultTransport);
}
round({transport:'signed-poll-v1',resultTransport:'signed-poll-v1',index:1});
round({transport:'device-duplex-v1',resultTransport:'device-duplex-v1',index:2});
console.log('G3_SIGNED_POLL_AND_DUPLEX_TRANSPORT_PROVENANCE_DISTINCT=PASS');

fleet.enqueue({...base,commandId:'g3-mixed-command',jobId:'g3-mixed-job',payload:{}});
fleet.poll({...base,transport:'device-duplex-v1'});
t+=2600;
const again=fleet.poll({...base,transport:'signed-poll-v1'});
assert.equal(again.command.commandId,'g3-mixed-command');
const retry=events.at(-1);
assert.equal(retry.type,'node_command_redelivered');
assert.equal(retry.firstDispatchTransport,'device-duplex-v1');
assert.equal(retry.dispatchTransport,'signed-poll-v1');
assert.equal(retry.attempts,2);
fleet.complete({...base,commandId:'g3-mixed-command',resultTransport:'signed-poll-v1'});
const completed=events.at(-1);
assert.equal(completed.firstDispatchTransport,'device-duplex-v1');
assert.equal(completed.dispatchTransport,'signed-poll-v1');
assert.equal(completed.resultTransport,'signed-poll-v1');
assert.equal(completed.attempts,2);
console.log('G3_MIXED_TRANSPORT_REDELIVERY_AND_RECEIPT_NOT_FALSIFIED=PASS');

const src=fs.readFileSync(fileURLToPath(new URL('../../operator-host/executor-routes-device-channel.mjs',import.meta.url)),'utf8');
for(const proof of [
  "transport:'device-duplex-v1'",
  "transport:'signed-poll-v1'",
  "resultTransport:'device-duplex-v1'",
  "resultTransport:'signed-poll-v1'"
])assert.ok(src.includes(proof),'missing_server_owned_transport_route_label');
console.log('G3_SERVER_OWNED_TRANSPORT_ROUTE_LABELS=PASS');
const cutover=fs.readFileSync(fileURLToPath(new URL('./gold-g3-uat-cutover.sh',import.meta.url)),'utf8');
for(const proof of ['G3_GOLD_EXPECT_STRICT','existing_strict_policy_mismatch','G3_GOLD_STRICT_ADMISSION=ON_PRESERVED','executor_proof_not_ready'])assert.ok(cutover.includes(proof),'gold_source_cutover_must_preserve_current_strict_policy');
console.log('G3_GOLD_CANDIDATE_CUTOVER_PRESERVES_STRICT_POLICY=PASS');
