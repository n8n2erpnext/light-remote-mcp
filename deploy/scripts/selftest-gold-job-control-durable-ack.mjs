import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const src=readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
function extract(start,until,fnName,scope){
  const begin=src.indexOf(start),end=src.indexOf(until,begin);
  assert.ok(begin>=0&&end>begin,'source boundary '+fnName);
  return vm.runInNewContext(src.slice(begin,end)+';'+fnName,scope);
}
function deferred(){
  let resolve;
  const promise=new Promise(r=>resolve=r);
  return {promise,resolve};
}
const id='12345678-1234-4234-8234-123456789abc';
const account='owner_p0', device='win11_p0', agent='agent_p0';
{
  const gate=deferred(),job={id,accountId:account,deviceId:device,agentId:agent,personalScheduled:true,finishedAt:null,status:'queued'};
  const scope={
    Set,
    jobs:new Map([[id,job]]),
    pendingForegroundExec:new Map([[id,()=>{}]]),
    personalAgentScheduler:{cancelQueued:async()=>true},
    finishJob(j,code){j.cancelled=true;j.status='cancelled';j.exitCode=code;j.finishedAt=Date.now();},
    goldJobs:{flush:()=>gate.promise}
  };
  const action=extract('async function cancelQueuedPersonalJob(', '\n// Cancellation is a CONTROL operation:', 'cancelQueuedPersonalJob',scope);
  let resolved=false;
  const pending=action({jobId:id,accountId:account,deviceIds:new Set([device])}).then(x=>{resolved=true;return x;});
  await new Promise(setImmediate);
  assert.equal(resolved,false,'Cancel cannot acknowledge before durable PostgreSQL flush');
  assert.equal(job.status,'cancelled');
  gate.resolve();
  const response=await pending;
  assert.equal(response.state,'cancelled');
  assert.equal(response.reason,'cancelled_before_dispatch');
}
{
  const gate=deferred(),commandId='cmd_p0_dispatched';
  const job={id,accountId:account,deviceId:device,agentId:agent,
    status:'running',finishedAt:null,remote:true,script:'Write-Output safe',
    commandId,note:'native-exec:smoke',sessionId:'session_p0'};
  let saved=false;
  const pendingStops=new Map();
  const scope={
    jobs:new Map([[id,job]]),
    pendingForegroundExec:new Map(),
    pendingDeviceJobStops:pendingStops,
    personalAgentScheduler:null,
    fleet:{command:()=>({jobId:id,accountId:account,deviceId:device,dispatchedAt:Date.now()})},
    goldJobs:{save:()=>{saved=true;},flush:()=>gate.promise},
    pushEvent:()=>{}
  };
  const action=extract('async function cancelControlJob(', '\n// Fleet owner Stop requests', 'cancelControlJob',scope);
  let resolved=false;
  const pending=action({jobId:id,accountId:account,deviceId:device,agentId:agent}).then(x=>{resolved=true;return x;});
  await new Promise(setImmediate);
  assert.equal(resolved,false,'Stop request cannot be acknowledged before ledger flush');
  assert.equal(saved,true);
  assert.ok(Number.isSafeInteger(job.stopRequestedAt));
  assert.equal(pendingStops.size,1);
  assert.equal(job.status,'running','Stop request is not a terminal result');
  gate.resolve();
  const response=await pending;
  assert.equal(response.state,'stop_requested');
}
assert.match(readFileSync(new URL('../../lib/gold-job-ledger.mjs',import.meta.url),'utf8'),
 /stopRequestedAt:Number\.isSafeInteger\(job\.stopRequestedAt\)/);
console.log('GOLD_P0_CANCEL_STOP_DURABLE_ACK_GATE_PASS');
