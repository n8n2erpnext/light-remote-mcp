import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGoldWallModules} from './gold-wall-modules.mjs';
import {executeRemoteMemory} from './gold-memory-operation.mjs';
import {GoldMemoryContentRelay} from '../operator-host/gold-memory-content-relay.mjs';
const owner={accountId:'account-test',deviceId:'device-test',agentId:'agent-test',sessionId:'session-test'};
const state={enrollment:owner};
test('client save and receipt commit together, survive reopen, disabled/identity rules persist',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-memory-operation-')),file=path.join(dir,'modules.sqlite');
 let m=createGoldWallModules({file,scopeIdentity:owner});
 try{
  assert.throws(()=>m.remoteMemoryOperation({owner,operationId:'memory-save-test-01',request:{action:'save',title:'a',body:'b',source:'owner'}}),/disabled/);
  m.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  const scope=m.createMemoryScope({displayName:'Synthetic',captureMode:'manual'});
  const request={action:'scope_save',scopeId:scope.scopeId,title:'Owner approved',body:'PRIVATE_MEMORY_SENTINEL_atomic',source:'manual'};
  const x={owner,operationId:'memory-save-test-01',request},saved=m.remoteMemoryOperation(x);
  assert.equal(saved.revision,1);assert.deepEqual(m.remoteMemoryOperation(x),saved);assert.equal(m.scopedHandoff({scopeId:scope.scopeId}).revision,1);
  assert.throws(()=>m.remoteMemoryOperation({...x,request:{...request,body:'changed'}}),/conflict/);
  assert.throws(()=>m.remoteMemoryOperation({...x,owner:{...owner,accountId:'wrong'}}),/actor_denied/);
  m.close();m=createGoldWallModules({file,scopeIdentity:owner});
  assert.deepEqual(m.remoteMemoryOperation(x),saved);assert.equal(m.scopedHandoff({scopeId:scope.scopeId}).revision,1);
  const other={...owner,deviceId:'replica-device'},replica=createGoldWallModules({file,scopeIdentity:other});
  try{assert.throws(()=>replica.remoteMemoryOperation({owner:other,operationId:'memory-replica-test',request}),/home_only/);}finally{replica.close();}
  assert.throws(()=>m.remoteMemoryOperation({...x,operationId:'memory-save-test-02',request:{...request,scopeId:'00000000-0000-0000-0000-000000000000'}}),/scope/);
  assert.equal(m.remoteMemoryOperation({...x,operationId:'memory-save-test-02'}).revision,2);
  m.clearLocalMemory({confirmed:true});
  assert.throws(()=>m.remoteMemoryOperation(x),/operation_deleted/,'delete must not enable replay of an earlier save');
  m.configure({longMemory:false,codexBridge:false,expectedRevision:1});assert.throws(()=>m.remoteMemoryOperation(x),/disabled/);
 }finally{m.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('device fetch/push content path returns no content to control channel',async()=>{
 const r=new GoldMemoryContentRelay();let saves=0,allowed=true;
 const request={action:'save',title:'Private title',body:'PRIVATE_MEMORY_SENTINEL_signed',source:'owner'},ticket=r.put(owner,'memory-remote-test-01',request);
 const command={...owner,...ticket},calls=[];
 const channel=async(action,p)=>{calls.push(action);return action==='memory-content-fetch'?r.fetch(owner,p.requestRef,p.requestDigest):r.push(owner,p.requestRef,p.reply);};
 try{
  const result=await executeRemoteMemory({state,command,allowed:()=>allowed,channel,modules:{remoteMemoryOperation:({request:x})=>{saves++;return {id:'local-only',body:x.body};}}});
  assert.equal(saves,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_MEMORY|Private title|local-only|body/);
  assert.equal(r.read(owner,ticket.requestRef).result.body,request.body);assert.deepEqual(calls,['memory-content-fetch','memory-content-push']);
  allowed=false;await assert.rejects(executeRemoteMemory({state,command,allowed:()=>allowed,channel}),/local_policy_denied/);assert.equal(saves,1);
  await assert.rejects(executeRemoteMemory({state,command:{...command,requestDigest:'forged'},allowed:()=>true,channel}),/conflict/);
 }finally{r.dispose();}
});
