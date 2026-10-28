import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FleetRouter} from '../../operator-host/fleet-router.mjs';
const src=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const events=[];
const f=new FleetRouter({emit:e=>events.push(e),channelTtlMs:20000,commandLeaseMs:5000,requireExecutorReady:true});
const ctx={accountId:'owner-1',deviceId:'device-1',nodeId:'device-1',sessionCeiling:2,capabilities:['filesystem'],executorReady:true};
f.touch(ctx);
const queued=f.enqueue({...ctx,jobId:'job_alpha',payload:{type:'exec',script:'echo one'}});
assert.equal(f.cancelUndispatched(queued.commandId)?.abandoned,true,'owner cancellation must remove undispatched command');
assert.equal(f.view(ctx.nodeId).queuedCommands,0);
assert.equal(f.poll(ctx).state,'idle','a cancelled queue entry must never dispatch');
assert.equal(f.receipt(queued.commandId)?.abandonReason,'owner_cancelled_before_dispatch');
const dispatched=f.enqueue({...ctx,jobId:'job_beta',payload:{type:'exec',script:'echo two'}});
assert.equal(f.poll(ctx).command?.commandId,dispatched.commandId);
assert.equal(f.cancelUndispatched(dispatched.commandId),null,'cannot call a running effect cancelled');
assert.equal(f.view(ctx.nodeId).inFlightCommands,1,'refused cancellation retains genuine in-flight command');
assert.equal(f.command(dispatched.commandId).dispatchedAt!==null,true);
const route=src('operator-host/executor-routes-device-channel.mjs');
assert.match(route,/verifiedChannelContext\(body,'job-cancel'\)/);
assert.match(route,/accountId:ctx.binding.accountId,deviceId:ctx.binding.deviceId/);
assert.doesNotMatch(route,/verifiedFleetContext\(await verifiedChannelContext\(body,'job-cancel'\)\)/);
const runtime=src('operator-host/executor-routes-runtime.mjs');
assert.match(runtime,/jobCancelMatch/);
assert.match(runtime,/session.accountId!==job.accountId\|\|session.deviceId!==job.deviceId/);
assert.match(runtime,/job.agentId!==agentId/);
const host=src('operator-host/executor.mjs');
assert.match(host,/pendingForegroundExec.has\(jobId\)/);
assert.match(host,/command.dispatchedAt!==null/);
assert.match(host,/cancelUndispatched\(command.commandId\)/);
assert.match(host,/job_already_dispatched_stop_requires_device_receipt/);
assert.match(host,/pendingDeviceJobStops.set\(command.commandId/);
assert.match(host,/deviceStopRequests\(accountId,deviceId\)/);
const leaf=src('device-agent/operator-agent.mjs');
assert.match(leaf,/ACTIVE_EXEC_CHILDREN.set\(command.commandId,execStopState\)/);
assert.match(leaf,/taskkill.exe/);
assert.match(leaf,/applyDeviceStopRequests\(pulseAck.stopRequests\)/);
assert.match(leaf,/applyDeviceStopRequests\(frame.stopRequests\)/);
assert.match(leaf,/status:cancelled\?'cancelled'/);
const channel=src('operator-host/executor-routes-device-channel.mjs');
assert.match(channel,/stopRequests:deviceStopRequests\(ctx.binding.accountId,ctx.binding.deviceId\)/);
assert.match(channel,/result.status\|\|''\)==='cancelled'&&job.stopRequestedAt/);
const wall=src('device-agent/local-wall.mjs');
assert.match(wall,/data-copy="cmd".*?data-stop="job"/);
assert.match(wall,/wallMutation\('\/api\/jobs\/cancel',\{jobId:id\}\)/);
assert.match(wall,/job_cancel_owner_auth_required/);
assert.match(wall,/csrf_invalid/);
const plugin=src('plugin-server/tools.mjs');
assert.match(plugin,/add\(server,'light_remote_cancel_job'/);
assert.match(plugin,/security\(\['remote:execute'\]\)/);
assert.match(src('plugin-server/operator-adapter.mjs'),/async cancelJob\(jobId\)/);
assert.match(src('device-agent/operator-agent.mjs'),/channelRequest\(state,hub,'job-cancel',\{jobId\}\)/);
// A large result must preserve the signed cancellation state through 413
// compaction, otherwise the Operator would report Error instead of Kill.
const {fitResultForDelivery}=await import('../../device-agent/result-delivery.mjs');
const compact=fitResultForDelivery({
  commandId:'cmd_00000000-0000-4000-8000-000000000000',
  status:'cancelled',exitCode:130,stdout:'x'.repeat(110000),
  stderr:'owner requested stop',durationMs:250
},{maxBytes:65536,forceCompact:true});
assert.equal(compact.status,'cancelled');
assert.equal(compact.exitCode,130);
assert.match(src('device-agent/operator-agent.mjs'),/taskkill.exe/);
console.log('GOLD_JOB_CONTROL_QUEUED_CANCEL_INFLIGHT_DENY_OWNER_SCOPE_PASS');
