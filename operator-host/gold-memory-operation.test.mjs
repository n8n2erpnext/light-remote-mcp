import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startGoldMemoryOperation,memoryAgentSupported} from './gold-memory-operation.mjs';
import {GoldMemoryContentRelay} from './gold-memory-content-relay.mjs';
import {handleDeviceChannelRoutes} from './executor-routes-device-channel.mjs';
import {handleRuntimeRoutes} from './executor-routes-runtime.mjs';
import {executeRemoteMemory} from '../device-agent/gold-memory-operation.mjs';
import {createGoldWallModules} from '../device-agent/gold-wall-modules.mjs';
import {apiPath} from '../lib/api-contract.mjs';
import {GoldJobLedger} from '../lib/gold-job-ledger.mjs';

const owner={accountId:'account1',deviceId:'device1',sessionId:'session1',agentId:'agent1'};
function fixture(){
 const persisted=[],commands=[],relay=new GoldMemoryContentRelay();let grantCurrent=true;
 const session={id:owner.sessionId,...owner,nodeId:'node-device',state:'active'};
 const deps={NODE_ID:'hub',sessions:{ensure:(id,{agentId})=>{assert.equal(id,owner.sessionId);assert.equal(agentId,owner.agentId);return session;},get:()=>session,attachJob(){},record(){}},
  accounts:{assertOperational(){}},requireDeviceConnection:()=>({connectionId:'conn1',hardExpiresAt:Date.now()+60000}),targetRoute:()=>({deviceId:owner.deviceId,capabilities:['filesystem']}),
  devices:{get:()=>({agentVersion:'0.10.1-dev.13'})},accessGrants:{activeGrantsForDevice:()=>grantCurrent?[{...owner,grantId:'grant1',purpose:'device',expiresAt:Date.now()+60000}]:[],assert(){}},
  memoryContent:relay,operationDedupe:new Map(),jobs:new Map(),createAccumulator:()=>({}),assertToolCallQuota(){},reserveGoldJob:async()=>null,goldJobs:{save:job=>persisted.push(JSON.stringify(job)),flush:async()=>{}},
  pushEvent:e=>persisted.push(JSON.stringify(e)),enqueueForJob:(job,command)=>{commands.push({...command,commandId:'cmd_'+'a'.repeat(32)});return commands.at(-1);},fleet:{abandon(){}},finishJob:(job,code)=>{clearTimeout(job.timer);job.timer=null;job.finishedAt=Date.now();job.exitCode=code;persisted.push(JSON.stringify(job));},OPERATION_DEDUPE_MS:120000,
  readJson:async req=>req.body,sendJson:(res,code,value)=>{res.code=code;return value;},decryptEnvelope:body=>({payload:body,requestId:'request1'}),waitForJob:async()=>{},jobView:j=>({jobId:j.id}),
  verifiedChannelContext:async(body,action)=>{assert.equal(body.signed,true);return {payload:body.payload,device:{deviceId:owner.deviceId,nodeId:'node-device'},binding:{accountId:owner.accountId}};}};
 deps.startMemoryOperation=(payload,id)=>startGoldMemoryOperation(payload,id,deps);
 deps.fleet.command=id=>{const command=commands.find(c=>c.commandId===id);assert.ok(command);return command;};deps.fleet.complete=()=>{};
 return {deps,persisted,commands,relay,revoke:()=>{grantCurrent=false;},close:()=>{for(const j of deps.jobs.values())clearTimeout(j.timer);relay.dispose();}};
}
const input={...owner,nodeId:'node-device',action:'memory',operationId:'memory-operation-001',memory:{action:'save',title:'Private heading',source:'Owner gesture',body:'PRIVATE_MEMORY_SENTINEL_boundary'}};
test('typed Memory requires a supported Agent version',()=>{
 for(const v of ['0.10.1-dev.13','0.10.1-dev.100','0.10.1','0.10.2-dev.1','0.11.0','1.0.0'])assert.equal(memoryAgentSupported(v),true,v);
 for(const v of ['unknown','0.10.1-dev.12','0.10.0','1.bad','0.10.1-dev.13x'])assert.equal(memoryAgentSupported(v),false,v);
});
test('admission dedupes, old Agent denied, policy/grant fence and actor binding remain required',async()=>{
 const f=fixture();try{
  const job=await startGoldMemoryOperation(input,'request1',f.deps);
  assert.equal(f.commands.length,1);assert.equal(await startGoldMemoryOperation(input,'request2',f.deps),job);assert.equal(f.commands.length,1);
  await assert.rejects(startGoldMemoryOperation({...input,memory:{...input.memory,body:'changed'}},'r',f.deps),/conflict/);
  await assert.rejects(startGoldMemoryOperation({...input,accountId:'wrong'},'r',f.deps),/actor_denied/);
  f.deps.devices.get=()=>({agentVersion:'0.10.1-dev.12'});
  await assert.rejects(startGoldMemoryOperation({...input,operationId:'memory-operation-002'},'r',f.deps),/upgrade_required/);
  f.revoke();await assert.rejects(startGoldMemoryOperation(input,'r',f.deps),/grant_required/);
 }finally{f.close();}
});
test('synthetic roundtrip: local SQLite body, transient reply, durable commands/events/results contain no body or title',async()=>{
 const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-memory-boundary-'));
 const modules=createGoldWallModules({file:path.join(dir,'modules.sqlite'),scopeIdentity:owner});
 const res={setHeader(){}};
 try{
  modules.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  const job=await startGoldMemoryOperation(input,'request1',f.deps),command=f.commands[0];
  const channel=(action,payload)=>handleDeviceChannelRoutes({method:'POST',body:{signed:true,payload}},res,new URL('http://local/v1/device-channel/'+action),f.deps);
  const control=await executeRemoteMemory({state:{enrollment:owner},command:command.payload,modules,allowed:()=>true,channel});
  // Deliberately inject a buggy content echo in every durable result field.
  f.deps.emitStream=()=>assert.fail('Memory stdout/stderr was forwarded');
  f.deps.applyDeviceTelemetry=(job,value)=>assert.equal(value,undefined);
  const unsafe={...input.memory};
  await channel('result',{commandId:command.commandId,status:'ok',exitCode:0,stdout:input.memory.body,stderr:input.memory.body,data:{...control,result:unsafe},telemetry:unsafe});
  const reply=await handleRuntimeRoutes({method:'POST',body:{...owner,requestRef:control.memory.requestRef}},res,new URL('http://local'+apiPath('memoryResultInternal')),f.deps);
  assert.equal(reply.ok,true);assert.equal(reply.result.title,input.memory.title);
  assert.equal(modules.readCheckpoint(reply.result.id).body,input.memory.body);
  const ledger=new GoldJobLedger({pool:{query:async(sql,values)=>{f.persisted.push(JSON.stringify(values));return {rows:[]};}},redact:x=>x});
  ledger.save(job);await ledger.flush();
  const durable=f.persisted.join('\n')+JSON.stringify(f.commands)+JSON.stringify(job.resultData);
  for(const sentinel of [input.memory.body,input.memory.title,input.memory.source,Buffer.from(input.memory.body).toString('base64')])assert.ok(!durable.includes(sentinel),'content persisted: '+sentinel);
  f.revoke();await assert.rejects(channel('memory-content-fetch',{...owner,requestRef:control.memory.requestRef}),/grant_required/);
  await assert.rejects(handleRuntimeRoutes({method:'POST',body:{...owner,requestRef:control.memory.requestRef}},res,new URL('http://local'+apiPath('memoryResultInternal')),f.deps),/grant_required/);
 }finally{modules.close();f.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('expired/restarted reply is unknown; historical job admission never recreates an uncertain save',async()=>{
 const f=fixture(),res={setHeader(){}};try{
  const job=await startGoldMemoryOperation(input,'r',f.deps);f.relay.dispose();
  const response=await handleRuntimeRoutes({method:'POST',body:input},res,new URL('http://local'+apiPath('memoryOperationInternal')),f.deps);
  assert.equal(response.outcome,'unknown');assert.match(response.nextAction,/do_not_replay/);assert.equal(f.commands.length,1);
  f.deps.operationDedupe.clear();f.deps.jobs.clear();
  f.deps.reserveGoldJob=async()=>{throw Error('operation_effect_unknown');};
  await assert.rejects(startGoldMemoryOperation(input,'r2',f.deps),/effect_unknown/);
  assert.equal(f.commands.length,1);clearTimeout(job.timer);
 }finally{f.close();}
});
