import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import { FleetRouter,FleetError } from './fleet-router.mjs';
import { createWorkerRelay } from './api-worker-operation.mjs';
import { handleRuntimeRoutes } from './executor-routes-runtime.mjs';
import { handleDeviceChannelRoutes } from './executor-routes-device-channel.mjs';
import { executeWorkerCommand } from '../device-agent/api-worker-device.mjs';
import { createApiWorkerQueue } from '../device-agent/api-worker-queue.mjs';
import { apiPath } from '../lib/api-contract.mjs';

test('MCP operation dispatch uses actual Fleet, signed-control handlers and content-free job receipts',async t=>{
  const oldFlag=process.env.LIGHT_REMOTE_API_WORKER_PILOT;
  process.env.LIGHT_REMOTE_API_WORKER_PILOT='1';
  t.after(()=>{if(oldFlag===undefined)delete process.env.LIGHT_REMOTE_API_WORKER_PILOT;
    else process.env.LIGHT_REMOTE_API_WORKER_PILOT=oldFlag;});
  const member={accountId:'owner',deviceId:'client-pc',nodeId:'node-pc',capabilities:['filesystem']};
  const enrollment={accountId:member.accountId,deviceId:member.deviceId};
  const session={...member,id:'session',agentId:'agent',state:'active'};
  const events=[],ledger=[],wires=[],jobs=new Map(),workerContent=createWorkerRelay(),db=new DatabaseSync(':memory:');
  const fleet=new FleetRouter({emit:row=>events.push(row)});
  fleet.touch(member);
  const actor={...enrollment,sessionId:session.id,agentId:session.agentId};
  const grant={...actor,grantId:'grant',purpose:'device',expiresAt:Date.now()+60000};
  let connection='connection',inferences=0;
  const queue=createApiWorkerQueue({db,identity:()=>enrollment,enabled:()=>true,
    providers:{codex:{run:async({prompt,context})=>{
      inferences++;
      assert.match(prompt,/PRIVATE_PROMPT/);
      assert.match(context,/PRIVATE_CONTEXT/);
      return {text:'PRIVATE_RESULT',model:'fixture'};
    }}}});
  t.after(()=>{for(const job of jobs.values())clearTimeout(job.timer);queue.close();db.close();workerContent.dispose();});
  const response={setHeader(){}};
  const deps={FleetError,fleet,jobs,workerContent,NODE_ID:'hub',operationDedupe:new Map(),OPERATION_DEDUPE_MS:120000,
    createAccumulator:()=>({}),assertToolCallQuota(){},reserveGoldJob:async()=>null,
    goldJobs:{save:row=>ledger.push(JSON.stringify(row)),flush:async()=>{}},pushEvent:e=>events.push(e),
    sessions:{get:()=>session,ensure:()=>session,record(){},attachJob(){}},accounts:{assertOperational(){}},
    requireDeviceConnection:()=>({connectionId:connection,hardExpiresAt:Date.now()+60000}),
    accessGrants:{activeGrantsForDevice:()=>[grant],assert(){}},
    targetRoute:()=>member,devices:{get:()=>({agentVersion:'0.10.1-dev.14'})},
    enqueueForJob:(_job,command)=>{wires.push(command);return fleet.enqueue(command);},
    finishJob:(job,exitCode)=>{clearTimeout(job.timer);job.timer=null;job.finishedAt=Date.now();job.exitCode=exitCode;ledger.push(JSON.stringify(job));},
    jobView:j=>({status:j.status}),applyDeviceTelemetry:(_,value)=>assert.equal(value,undefined),
    emitStream:()=>assert.fail('private body entered stdout/stderr'),
    readJson:async req=>req.body,sendJson:(_res,status,body)=>({...body,httpStatus:status}),
    decryptEnvelope:body=>({payload:body,requestId:'request'}),
    verifiedChannelContext:async(body,action)=>{
      assert.equal(body.signatureFixture,action);
      return {payload:body.payload,binding:enrollment,device:member};
    }};
  const channel=(action,payload)=>handleDeviceChannelRoutes({method:'POST',body:{signatureFixture:action,payload}},
    response,new URL('http://fixture/v1/device-channel/'+action),deps);
  deps.waitForJob=async job=>{
    if(job.finishedAt)return;
    const {command}=fleet.poll(member);
    assert.equal(command.payload.type,'worker');
    const control=await executeWorkerCommand({state:{enrollment},command:command.payload,
      modules:{remoteWorkerRequest:queue.request},channel,allowed:()=>true});
    await channel('result',{commandId:command.commandId,status:'ok',exitCode:0,
      data:{...control,untrusted:'PRIVATE_CONTEXT'},stdout:'PRIVATE_PROMPT',stderr:'PRIVATE_RESULT',
      telemetry:{debug:'PRIVATE_RESULT'}});
  };
  const workerId=randomUUID();
  const request=worker=>handleRuntimeRoutes({method:'POST',
    body:{...actor,nodeId:member.nodeId,action:'worker',
      operationId:worker.action==='start'?'worker-start:'+workerId:randomUUID(),worker:{...worker,workerId}}},
    response,new URL('http://fixture'+apiPath('workerOperationInternal')),deps);
  assert.equal((await handleRuntimeRoutes({method:'POST',body:{}},response,
    new URL('http://fixture'+apiPath('workerOperationInternal')),{...deps,workerContent:null})).httpStatus,404);
  const submitted=await request({action:'start',provider:'codex',model:'fixture',
    prompt:'PRIVATE_PROMPT',context:'PRIVATE_CONTEXT',timeoutMs:10000});
  assert.equal(submitted.result.state,'awaiting_approval');
  assert.equal(inferences,0);
  queue.ownerDecision({...submitted.result,approve:true});
  await setImmediate();
  const result=await request({action:'result'});
  assert.equal(result.result.result.text,'PRIVATE_RESULT');
  assert.equal(inferences,1);
  assert.doesNotMatch(JSON.stringify({events,ledger,wires}),/PRIVATE_/);
  connection='other';
  const denied=await request({action:'result'});
  assert.equal(denied.error,'api_worker_job_unavailable');
});
