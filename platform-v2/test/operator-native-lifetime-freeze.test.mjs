import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {LocalIngressFreezeGate} from '../../lib/local-ingress-freeze.mjs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
import {NativeTerminalRegistry} from '../../lib/native-terminal.mjs';

// The real Operator acknowledges a START job before the spawned process / PTY
// finishes. Its local drain must count the OS lifetimes, not just request jobs.
// Fake terminal provider keeps this test portable; process is a REAL OS child.
test('rc50 local freeze waits for surviving native process and PTY lifetimes', {timeout:15000}, async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-native-drain-'));
  const markerPath=path.join(root,'operator-freeze.json');
  const owner={accountId:'uat_account',deviceId:'uat_device',sessionId:'uat_session',agentId:'uat_agent'};
  const gate=new LocalIngressFreezeGate({enabled:true,markerPath,service:'operator'});
  const processes=new NativeProcessRegistry({emit(event){
    if(event.type==='process_finished')gate.notifyPendingChanged();
  }});
  let onExit=null;
  let fakeTerminalClosed=false;
  const fakeProvider={spawn(){
    return {pid:null,write(){},resize(){},onData(){},onExit(fn){onExit=fn;},
      kill(){if(fakeTerminalClosed)return;fakeTerminalClosed=true;
        setImmediate(()=>onExit?.({exitCode:0,signal:null}));}};
  }};
  const terminals=new NativeTerminalRegistry({ptyProvider:fakeProvider,emit(event){
    if(event.type==='terminal_finished')gate.notifyPendingChanged();
  }});
  gate.registerPendingSource('nativeProcesses',()=>processes.list().filter(row=>!row.finishedAt).length);
  gate.registerPendingSource('nativeTerminals',()=>terminals.list().filter(row=>!row.finishedAt).length);
  let childId=null,termId=null;
  try{
    // Equivalent to a native process start job that has already returned.
    const child=processes.start({...owner,script:'uat_child',cwd:root,
      spawnSpec:()=>({file:process.execPath,args:['-e','setInterval(()=>{}, 1000)']})});
    childId=child.processId;
    const term=terminals.start({...owner,shellSpec:{file:'fake-pty',args:[]},cwd:root});
    termId=term.terminalId;
    const httpJobDone=gate.beginWork();
    assert.equal(typeof httpJobDone,'function');
    httpJobDone(); // HTTP/Operator job completed; two OS lifetimes persist.

    let acknowledged=false;
    const freezing=gate.freeze().then(()=>{acknowledged=true;});
    await sleep(90);
    assert.equal(gate.snapshot().inflight,0);
    assert.equal(gate.snapshot().pendingExternal,2);
    assert.equal(gate.snapshot().phase,'freezing');
    assert.equal(acknowledged,false,'freeze ACK must not precede PTY/process exit');
    assert.equal(fs.existsSync(markerPath),true);
    // First PTY terminates; process must STILL block the frozen ACK.
    terminals.stop(termId,owner,{force:true});
    for(let i=0;i<100&&gate.snapshot().pendingExternal!==1;i++)await sleep(10);
    assert.equal(gate.snapshot().pendingExternal,1);
    assert.equal(acknowledged,false);
    processes.stop(childId,owner,{force:true});
    const timeout=new AbortController();
    try{
      await Promise.race([freezing,sleep(6000,null,{signal:timeout.signal}).then(()=>{
        throw Error('native_lifetime_freeze_timeout');
      })]);
    }finally{timeout.abort();}
    assert.equal(acknowledged,true);
    assert.equal(gate.snapshot().phase,'frozen');
    assert.equal(gate.snapshot().pendingExternal,0);
    assert.equal(fs.statSync(markerPath).mode&0o777,0o600);
  }finally{
    if(childId){try{processes.stop(childId,owner,{force:true});}catch{}}
    if(termId){try{terminals.stop(termId,owner,{force:true});}catch{}}
    terminals.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('real Operator source registers both long-lived lifetimes and finish notifications',()=>{
  const source=fs.readFileSync(fileURLToPath(new URL('../../operator-host/executor.mjs',import.meta.url)),'utf8');
  assert.match(source,/registerPendingSource\('nativeProcesses',/);
  assert.match(source,/registerPendingSource\('nativeTerminals',/);
  assert.match(source,/NATIVE_PROCESSES\.list\(\)\.filter\(row=>!row\.finishedAt\)/);
  assert.match(source,/NATIVE_TERMINALS\.list\(\)\.filter\(row=>!row\.finishedAt\)/);
  assert.match(source,/event\.type==='process_finished'\)localFreezeGate\.notifyPendingChanged\(\)/);
  assert.match(source,/event\.type==='terminal_finished'\)localFreezeGate\.notifyPendingChanged\(\)/);
});
