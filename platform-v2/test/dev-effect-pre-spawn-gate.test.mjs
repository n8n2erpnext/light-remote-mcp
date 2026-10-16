import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
import {durableAtomicWriteSync} from '../../lib/durable-atomic-file.mjs';
import {DevAgentEffectInventory,inspectDevAgentEffectInventory}
  from '../portability/dev-agent-effect-inventory.mjs';
import {startDevTrackedAgentEffect}
  from '../portability/dev-effect-pre-spawn-gate.mjs';

const owner={accountId:'uat_owner',deviceId:'uat_device',sessionId:'uat_session',agentId:'uat_agent'};
const intent={effectId:'eff_gate_0123456789012',owner,
  commandId:'cmd_gate_0123456789012',nodeId:'uat_node',kind:'process',
  writerGeneration:42,bootId:crypto.randomBytes(24).toString('base64url')};
function create(options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-gate-'));
  const file=path.join(dir,'inventory.json');
  durableAtomicWriteSync(file,JSON.stringify({schemaVersion:1,entries:[]})+'\n',{mode:0o600});
  const inventory=new DevAgentEffectInventory({file,...options});
  return {dir,file,inventory,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('DEV gate verifies native owner BEFORE durable arm or spawn',()=>{
  let armed=0,spawned=0;
  const inventory={arm(){armed++;},recordSpawn(){}};
  const registry={start(){spawned++;}};
  assert.throws(()=>startDevTrackedAgentEffect({inventory,registry,intent,
    nativeStart:{...owner,deviceId:'wrong_device'}}),/OWNER_MISMATCH/);
  assert.equal(armed,0);assert.equal(spawned,0);
});
test('DEV gate refuses native spawn when pre-spawn durable intent write fails',()=>{
  let spawned=0;
  const registry={start(){spawned++;throw Error('should_not_be_called');}};
  const {file:failFile,inventory:failing,cleanup:cleanup2}=create({
    write(){throw Error('injected_fsync_failure');}
  });
  try{
    assert.throws(()=>startDevTrackedAgentEffect({inventory:failing,registry,intent,
      nativeStart:owner}),/injected_fsync_failure/);
    assert.equal(spawned,0);
    assert.equal(inspectDevAgentEffectInventory({file:failFile}).unresolved,0);
    assert.equal(fs.existsSync(failFile+'.owner.lock'),true);
  }finally{cleanup2();}
});
test('DEV gate preserves unresolved intent if native spawn fails',()=>{
  const {file,inventory,cleanup}=create();
  try{
    assert.throws(()=>startDevTrackedAgentEffect({inventory,
      registry:{start(){throw Error('injected_native_spawn_failed');}},
      intent,nativeStart:owner}),/injected_native_spawn_failed/);
    const snapshot=inspectDevAgentEffectInventory({file});
    assert.equal(snapshot.counts.intent,1);
    assert.equal(snapshot.blocked,true);
    assert.equal(snapshot.settlementAuthorized,false);
    assert.throws(()=>new DevAgentEffectInventory({file}),
      /UNRESOLVED_STARTUP_REFUSED/);
  }finally{cleanup();}
});
test('DEV gate real native process is linked only AFTER durable intent; exit still unresolved',
  {timeout:12000},async()=>{
  const {file,dir,inventory,cleanup}=create();
  const registry=new NativeProcessRegistry();
  let processId=null,pid=null;
  try{
    const launched=startDevTrackedAgentEffect({inventory,registry,intent,
      nativeStart:{...owner,cwd:dir,script:'DEV_GATED_CHILD',
        spawnSpec:()=>({file:process.execPath,args:['-e','setTimeout(()=>{},9000)']})}});
    processId=launched.native.processId;pid=launched.native.pid;
    assert.equal(launched.entry.stage,'spawned');
    assert.equal(launched.settlementAuthorized,false);
    assert.equal(launched.entry.osPid,pid);
    assert.equal(inspectDevAgentEffectInventory({file}).counts.spawned,1);
    registry.stop(processId,owner,{force:true});
    for(let i=0;i<90&&!registry.list(owner)[0]?.finishedAt;i++)await sleep(25);
    assert.ok(registry.list(owner)[0]?.finishedAt);
    const exited=inventory.recordExit(intent.effectId,{registry});
    assert.equal(exited.entry.stage,'exited');
    assert.equal(inventory.unresolved,1);
    assert.throws(()=>inventory.releaseClean(),/RELEASE_PENDING/);
  }finally{
    if(processId)try{registry.stop(processId,owner,{force:true});}catch{}
    if(Number.isSafeInteger(pid)&&pid>0&&process.platform==='linux'){
      try{
        const parts=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\x00');
        if(parts[0]===process.execPath&&parts.includes('setTimeout(()=>{},9000)'))
          process.kill(pid,'SIGKILL');
      }catch{}
    }
    cleanup();
  }
});
