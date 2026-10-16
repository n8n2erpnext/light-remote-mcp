import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
import {NativeTerminalRegistry} from '../../lib/native-terminal.mjs';
import {DevRemoteEffectJournal} from '../../operator-host/dev-remote-effect-journal.mjs';
import {durableAtomicWriteSync} from '../../lib/durable-atomic-file.mjs';
import {signDevAgentLifetimeObservation,verifyDevAgentLifetimeObservation}
  from '../portability/dev-agent-lifetime-observation.mjs';

const owner={accountId:'uat_owner',deviceId:'uat_device',sessionId:'uat_session',agentId:'uat_agent'};
const nodeId='uat_node',commandId='cmd_uat_lifetime_probe_123456789';
const bootId=crypto.randomBytes(24).toString('base64url');
const writerGeneration=42;
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const expectedFor=(kind,handleId,challenge)=>({
  accountId:owner.accountId,deviceId:owner.deviceId,nodeId,commandId,
  writerGeneration,bootId,challenge,kind,handleId
});
function sign(registry,kind,handleId,challenge){
  return signDevAgentLifetimeObservation({registry,kind,handleId,
    owner,nodeId,commandId,writerGeneration,bootId,challenge,privateKey});
}
function verify(receipt,kind,handleId,challenge,extra={}){
  return verifyDevAgentLifetimeObservation({receipt,publicKey,
    expected:expectedFor(kind,handleId,challenge),
    seenChallenges:new Set(),...extra});
}
test('actual OS child: signed active and signed exit are distinct; neither can settle DEV WAL',
  {timeout:14000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-agent-attest-'));
  const file=path.join(dir,'journal.json');
  durableAtomicWriteSync(file,JSON.stringify({schemaVersion:1,pending:[]})+'\n',{mode:0o600});
  const journal=new DevRemoteEffectJournal({file});
  const registry=new NativeProcessRegistry();
  let handle;
  try{
    journal.prepare({accountId:owner.accountId,deviceId:owner.deviceId,
      nodeId,jobId:'uat_job',commandId});
    const row=registry.start({...owner,script:'uat_child',cwd:dir,
      spawnSpec:()=>({file:process.execPath,args:['-e','setInterval(()=>{},1000)']})});
    handle=row.processId;
    const challenge1=crypto.randomBytes(24).toString('base64url');
    const active=sign(registry,'process',handle,challenge1);
    assert.equal(active.body.observation,'active');
    assert.equal(active.body.finishedAt,null);
    const seen=new Set();
    const blocked=verify(active,'process',handle,challenge1,{seenChallenges:seen});
    assert.equal(blocked.verdict,'BLOCK_ACTIVE');
    assert.equal(blocked.settlementAuthorized,false);
    assert.throws(()=>verify(active,'process',handle,challenge1,{seenChallenges:seen}),/REPLAY/);
    assert.equal(journal.pending,1);

    registry.stop(handle,owner,{force:true});
    for(let i=0;i<130&&!registry.list(owner).find(x=>x.processId===handle)?.finishedAt;i++)
      await sleep(20);
    assert.ok(registry.list(owner).find(x=>x.processId===handle)?.finishedAt,
      'real child must EXIT before a signed exit can be observed');
    const challenge2=crypto.randomBytes(24).toString('base64url');
    const exited=sign(registry,'process',handle,challenge2);
    assert.equal(exited.body.observation,'exited');
    const observed=verify(exited,'process',handle,challenge2);
    assert.equal(observed.verdict,'EXIT_OBSERVED_UNFENCED');
    assert.equal(observed.settlementAuthorized,false);
    assert.equal(journal.pending,1,
      'signed exit observation cannot automatically reconcile un-fenced DEV WAL');
    // A new Agent boot that lost the registry cannot claim a completed handle.
    assert.throws(()=>sign(new NativeProcessRegistry(),'process',handle,
      crypto.randomBytes(24).toString('base64url')),/HANDLE_UNOBSERVED/);
  }finally{
    if(handle)try{registry.stop(handle,owner,{force:true});}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
test('mock PTY lifetime: active denies, exited is observation only, missing handle fails closed',
  {timeout:7000},async()=>{
  let onExit;
  const provider={spawn:()=>({
    pid:null,write(){},resize(){},onData(){},onExit(cb){onExit=cb;},
    kill(){queueMicrotask(()=>onExit?.({exitCode:0,signal:null}));}
  })};
  const registry=new NativeTerminalRegistry({ptyProvider:provider});
  let handle;
  try{
    const row=registry.start({...owner,cwd:os.tmpdir(),
      shellSpec:{file:'fake-pty',args:[]}});
    handle=row.terminalId;
    const challenge=crypto.randomBytes(24).toString('base64url');
    assert.equal(verify(sign(registry,'terminal',handle,challenge),
      'terminal',handle,challenge).verdict,'BLOCK_ACTIVE');
    registry.stop(handle,owner,{force:true});
    for(let i=0;i<40&&!registry.list(owner).find(x=>x.terminalId===handle)?.finishedAt;i++)
      await sleep(15);
    const second=crypto.randomBytes(24).toString('base64url');
    assert.equal(verify(sign(registry,'terminal',handle,second),
      'terminal',handle,second).verdict,'EXIT_OBSERVED_UNFENCED');
    assert.throws(()=>sign(registry,'terminal','ltm_'+('a'.repeat(24)),
      crypto.randomBytes(24).toString('base64url')),/HANDLE_UNOBSERVED/);
    const wrongOwner={...owner,agentId:'other_agent'};
    assert.throws(()=>signDevAgentLifetimeObservation({registry,kind:'terminal',handleId:handle,
      owner:wrongOwner,nodeId,commandId,writerGeneration,bootId,
      challenge:crypto.randomBytes(24).toString('base64url'),privateKey}),/HANDLE_UNOBSERVED/);
  }finally{if(handle)try{registry.stop(handle,owner,{force:true});}catch{}registry.close();}
});
test('signature, command, generation, device, boot, challenge, expiry and replay are fail-closed',()=>{
  const now=Date.now();
  const handle='lp_'+('a'.repeat(24));
  const registry={list:()=>[{...owner,processId:handle,startedAt:now-5000,
    finishedAt:now-10}]};
  const challenge=crypto.randomBytes(24).toString('base64url');
  const receipt=signDevAgentLifetimeObservation({registry,kind:'process',
    handleId:handle,owner,nodeId,commandId,writerGeneration,bootId,
    challenge,privateKey,now});
  assert.equal(verify(receipt,'process',handle,challenge,{now}).verdict,
    'EXIT_OBSERVED_UNFENCED');
  const tampered=structuredClone(receipt);
  tampered.body.finishedAt-=1;
  assert.throws(()=>verify(tampered,'process',handle,challenge,{now}),/SIGNATURE_INVALID/);
  assert.throws(()=>verify(receipt,'process',handle,challenge,{
    expected:{...expectedFor('process',handle,challenge),writerGeneration:43},
    now}),/BINDING_MISMATCH/);
  assert.throws(()=>verify(receipt,'process',handle,challenge,{
    expected:{...expectedFor('process',handle,challenge),deviceId:'other_device'},
    now}),/BINDING_MISMATCH/);
  assert.throws(()=>verify(receipt,'process',handle,challenge,{
    expected:{...expectedFor('process',handle,challenge),commandId:'another_command'},
    now}),/BINDING_MISMATCH/);
  assert.throws(()=>verify(receipt,'process',handle,challenge,{
    expected:{...expectedFor('process',handle,challenge),bootId:crypto.randomBytes(24).toString('base64url')},
    now}),/BINDING_MISMATCH/);
  assert.throws(()=>verify(receipt,'process',handle,challenge,{
    expected:{...expectedFor('process',handle,challenge),
      challenge:crypto.randomBytes(24).toString('base64url')},now}),/BINDING_MISMATCH/);
  assert.throws(()=>verify(receipt,'process',handle,challenge,{now:now+15001}),/EXPIRED/);
  const otherKey=crypto.generateKeyPairSync('ed25519').publicKey;
  assert.throws(()=>verify(receipt,'process',handle,challenge,{
    now,publicKey:otherKey}),/SIGNATURE_INVALID/);
  assert.throws(()=>verify(receipt,'process',handle,challenge,{
    now,seenChallenges:null}),/TRUST_CONTEXT_REQUIRED/);
  const malformed=structuredClone(receipt);malformed.body.unknown=true;
  assert.throws(()=>verify(malformed,'process',handle,challenge,{now}),/INVALID_SCHEMA/);
  // A missing handle cannot be inferred as exited after Agent restart.
  assert.throws(()=>signDevAgentLifetimeObservation({registry:{list:()=>[]},kind:'process',
    handleId:handle,owner,nodeId,commandId,writerGeneration,bootId,
    challenge,privateKey,now}),/HANDLE_UNOBSERVED/);
});
