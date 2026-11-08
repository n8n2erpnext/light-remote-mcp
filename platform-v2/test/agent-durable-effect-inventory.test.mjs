import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
import {NativeTerminalRegistry} from '../../lib/native-terminal.mjs';
import {durableAtomicWriteSync} from '../../lib/durable-atomic-file.mjs';
import {DevAgentEffectInventory,inspectDevAgentEffectInventory}
  from '../portability/dev-agent-effect-inventory.mjs';

const owner={accountId:'uat_owner',deviceId:'uat_device',
  sessionId:'uat_session',agentId:'uat_agent'};
const intent={owner,commandId:'cmd_inventory_start_1234567890',nodeId:'uat_node',
  kind:'process',writerGeneration:42,bootId:crypto.randomBytes(24).toString('base64url')};
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-durable-effects-'));
  const file=path.join(dir,'inventory.json');
  durableAtomicWriteSync(file,JSON.stringify({schemaVersion:1,entries:[]})+'\n',{mode:0o600});
  return {dir,file,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('pre-spawn intent is fsynced before actual OS child; after exit inventory stays blocked',
  {timeout:15000},async()=>{
  const {dir,file,cleanup}=fixture();
  const inv=new DevAgentEffectInventory({file});
  const registry=new NativeProcessRegistry();
  let pid=null,handle=null;
  try{
    const effectId='eff_real_child_1234567890';
    inv.arm({...intent,effectId});
    let snap=inspectDevAgentEffectInventory({file});
    assert.equal(snap.counts.intent,1);
    assert.equal(snap.entries[0].handleId,null);
    assert.equal(snap.entries[0].osPid,null);
    assert.equal(fs.statSync(file).mode&0o777,0o600);
    assert.throws(()=>new DevAgentEffectInventory({file}),/UNRESOLVED_STARTUP_REFUSED/);
    const child=registry.start({...owner,script:'safe_test_child',cwd:dir,
      spawnSpec:()=>({file:process.execPath,
        args:['-e','setInterval(()=>{},1000)']})});
    pid=child.pid;handle=child.processId;
    assert.ok(Number.isSafeInteger(pid)&&pid>0);
    assert.equal(inspectDevAgentEffectInventory({file}).entries[0].stage,'intent',
      'the OS process exists, but the pre-spawn intent remains durable until handle linkage');
    const linked=inv.recordSpawn(effectId,{registry,handleId:handle});
    assert.equal(linked.stage,'spawned');
    assert.equal(linked.osPid,pid);
    assert.equal(linked.handleId,handle);
    assert.throws(()=>inv.recordExit(effectId,{registry}),/NOT_PROVEN_EXITED/);
    snap=inspectDevAgentEffectInventory({file});
    assert.equal(snap.counts.spawned,1);
    assert.equal(snap.blocked,true);
    assert.equal(snap.settlementAuthorized,false);

    registry.stop(handle,owner,{force:true});
    for(let i=0;i<120&&!registry.list(owner).find(x=>x.processId===handle)?.finishedAt;i++)
      await sleep(20);
    assert.ok(registry.list(owner).find(x=>x.processId===handle)?.finishedAt);
    const observed=inv.recordExit(effectId,{registry});
    assert.equal(observed.entry.stage,'exited');
    assert.equal(observed.verdict,'EXIT_OBSERVED_UNFENCED');
    assert.equal(observed.settlementAuthorized,false);
    assert.equal(inv.unresolved,1);
    assert.throws(()=>inv.releaseClean(),/RELEASE_PENDING/);
    snap=inspectDevAgentEffectInventory({file});
    assert.equal(snap.counts.exited,1);
    assert.equal(snap.unresolved,1);
    assert.equal(snap.blocked,true);
    assert.throws(()=>new DevAgentEffectInventory({file}),/UNRESOLVED_STARTUP_REFUSED/);
    const goneRegistry=new NativeProcessRegistry();
    assert.throws(()=>inv.recordExit(effectId,{registry:goneRegistry}),/WRONG_STAGE/);
  }finally{
    if(handle)try{registry.stop(handle,owner,{force:true});}catch{}
    // Child was spawned by this test only; do not kill any PID unless /proc
    // still identifies the exact isolated Node child for this test.
    if(Number.isSafeInteger(pid)&&pid>0&&process.platform==='linux'){
      try{
        const cmdline=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');
        if(cmdline.startsWith(process.execPath+String.fromCharCode(0))&&
          cmdline.includes('setInterval(()=>{},1000)'))process.kill(pid,'SIGKILL');
      }catch{}
    }
    cleanup();
  }
});
test('mock PTY: intent->spawn->exit, unknown PID and lost registry refuse settlement',async()=>{
  const {file,cleanup}=fixture();
  const inv=new DevAgentEffectInventory({file});
  let exit;
  const ptyProvider={spawn:()=>({
    pid:54321,write(){},resize(){},onData(){},onExit(fn){exit=fn;},
    kill(){queueMicrotask(()=>exit?.({exitCode:0,signal:null}));}
  })};
  const registry=new NativeTerminalRegistry({ptyProvider});
  try{
    const effectId='eff_pty_123456789012';
    inv.arm({...intent,effectId,kind:'terminal'});
    const term=registry.start({...owner,shellSpec:{file:'fake',args:[]},cwd:os.tmpdir()});
    inv.recordSpawn(effectId,{registry,handleId:term.terminalId});
    const restarted=new NativeTerminalRegistry({ptyProvider});
    assert.throws(()=>inv.recordExit(effectId,{registry:restarted}),/HANDLE_UNOBSERVED/);
    restarted.close();
    assert.equal(inspectDevAgentEffectInventory({file}).counts.spawned,1);
    registry.stop(term.terminalId,owner,{force:true});
    await sleep(10);
    assert.equal(inv.recordExit(effectId,{registry}).entry.stage,'exited');
    assert.equal(inspectDevAgentEffectInventory({file}).settlementAuthorized,false);
  }finally{registry.close();cleanup();}
});
test('separate process crash after durable intent denies next Agent owner even with no OS spawn',()=>{
  const {file,cleanup}=fixture();
  try{
    const moduleUrl=pathToFileURL(fileURLToPath(
      new URL('../portability/dev-agent-effect-inventory.mjs',import.meta.url))).href;
    const script=`import {DevAgentEffectInventory} from ${JSON.stringify(moduleUrl)};
const inv=new DevAgentEffectInventory({file:process.argv[1]});
inv.arm(JSON.parse(process.argv[2]));
process.exit(77);`;
    const data={...intent,effectId:'eff_crash_before_spawn_1234'};
    const crashed=spawnSync(process.execPath,['--input-type=module','-e',script,
      file,JSON.stringify(data)],{encoding:'utf8',timeout:6000});
    assert.equal(crashed.status,77,crashed.stderr);
    const snapshot=inspectDevAgentEffectInventory({file});
    assert.equal(snapshot.counts.intent,1);
    assert.equal(snapshot.ownerLockPresent,true);
    assert.equal(snapshot.blocked,true);
    assert.throws(()=>new DevAgentEffectInventory({file}),/UNRESOLVED_STARTUP_REFUSED/);
  }finally{cleanup();}
});
test('pre-spawn fsync failure is sticky fail-closed and cannot produce authoritative intent',()=>{
  const {file,cleanup}=fixture();
  let count=0;
  try{
    const inv=new DevAgentEffectInventory({file,write(){
      count++;throw Error('injected_rename_or_fsync_failure');
    }});
    assert.throws(()=>inv.arm({...intent,effectId:'eff_fault_1234567890'}),
      /injected_rename_or_fsync_failure/);
    assert.equal(count,1);
    assert.equal(inv.unresolved,0);
    assert.throws(()=>inv.arm({...intent,effectId:'eff_second_1234567890'}),
      /NOT_WRITABLE/);
    assert.equal(count,1);
    assert.equal(inspectDevAgentEffectInventory({file}).unresolved,0);
    assert.equal(fs.existsSync(file+'.owner.lock'),true);
    assert.throws(()=>new DevAgentEffectInventory({file}),/EEXIST/);
  }finally{cleanup();}
});
test('untrusted state, owner swap, malformed record and empty clean release remain fail closed',()=>{
  const {dir,file,cleanup}=fixture();
  try{
    const first=new DevAgentEffectInventory({file});
    assert.throws(()=>new DevAgentEffectInventory({file}),/EEXIST/);
    fs.renameSync(file+'.owner.lock',file+'.old-lock');
    assert.throws(()=>first.arm({...intent,effectId:'eff_after_swap_123456'}),
      /OWNER_LOST/);
    assert.equal(inspectDevAgentEffectInventory({file}).unresolved,0);
    fs.rmSync(file+'.old-lock');
    const second=new DevAgentEffectInventory({file});
    assert.equal(second.releaseClean(),true);
    assert.equal(fs.existsSync(file+'.owner.lock'),false);
    const third=new DevAgentEffectInventory({file});
    assert.equal(third.releaseClean(),true);
    const symlink=path.join(dir,'symlink.json');
    fs.symlinkSync(file,symlink);
    assert.throws(()=>inspectDevAgentEffectInventory({file:symlink}),
      /ELOOP|UNTRUSTED_FILE/);
    const wrong=path.join(dir,'mode644.json');
    fs.writeFileSync(wrong,'{"schemaVersion":1,"entries":[]}\n',{mode:0o644});
    fs.chmodSync(wrong,0o644); // the UAT host umask can be 077
    assert.throws(()=>new DevAgentEffectInventory({file:wrong}),/UNTRUSTED_FILE/);
    durableAtomicWriteSync(file,
      '{"schemaVersion":1,"entries":[{"commandId":"unstructured"}]}\n',{mode:0o600});
    assert.throws(()=>inspectDevAgentEffectInventory({file}),/INVALID_ROW/);
    assert.throws(()=>new DevAgentEffectInventory({file}),/INVALID_ROW/);
  }finally{cleanup();}
});

test('ambiguous durable write after spawn poisons owner and never authorizes recovery',()=>{
  const {file,cleanup}=fixture();
  let writes=0;
  try{
    const inv=new DevAgentEffectInventory({file,write(target,data,options){
      durableAtomicWriteSync(target,data,options);
      writes++;
      // Simulate lost write acknowledgement AFTER the durable file was replaced.
      if(writes===2)throw Error('injected_unknown_commit_ack');
      return true;
    }});
    const effectId='eff_lost_commit_ack_123456';
    inv.arm({...intent,effectId});
    const startedAt=Date.now();
    const handleId='lp_'+('a'.repeat(24));
    const registry={list:()=>[{...owner,processId:handleId,pid:54321,startedAt,
      finishedAt:null}]};
    assert.throws(()=>inv.recordSpawn(effectId,{registry,handleId}),
      /injected_unknown_commit_ack/);
    assert.equal(writes,2);
    assert.equal(inv.unresolved,1,'memory never advances after uncertain write');
    assert.equal(inspectDevAgentEffectInventory({file}).counts.spawned,1,
      'durable file may have advanced despite caller seeing error');
    assert.throws(()=>inv.arm({...intent,effectId:'eff_no_more_writes_1234'}),
      /NOT_WRITABLE/);
    assert.throws(()=>new DevAgentEffectInventory({file}),
      /UNRESOLVED_STARTUP_REFUSED/);
  }finally{cleanup();}
});
