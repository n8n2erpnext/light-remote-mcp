import assert from 'node:assert/strict';
import os from 'node:os';
import {NativeTerminalRegistry} from '../../lib/native-terminal.mjs';

let clock=1730000000000;
let killCount=0;
let onExit=null;
const events=[];
const fakeProvider={spawn(){return{
  pid:null,
  onData(){},
  onExit(fn){onExit=fn;},
  write(){},
  resize(){},
  kill(){killCount++;}
};}};
const owner={accountId:'g2missingpid',deviceId:'golddev',sessionId:'g2session',agentId:'g2agent'};
const reg=new NativeTerminalRegistry({maxTerminals:1,platform:'linux',ptyProvider:fakeProvider,now:()=>clock,emit:e=>events.push(e),idleTtlMs:60000,hardTtlMs:90000});
try{
  const started=reg.start({...owner,cwd:os.tmpdir(),shellSpec:{file:'/bin/sh',args:[],shell:'sh'}});
  assert.equal(started.pid,null);
  clock+=91000;
  reg.prune();
  assert.equal(killCount,1);
  const pending=reg.view(started.terminalId,owner);
  assert.equal(pending.state,'expired');
  assert.equal(pending.finishedAt,null,'exit without evidence must not be claimed finished');
  assert.equal(pending.exitCode,null);
  assert.equal(pending.terminationStopAttemptedAt,clock);
  assert.equal(pending.terminationUnverifiedAt,clock);
  assert.equal(events.filter(e=>e.type==='terminal_exit_unverified').length,1);
  clock+=61000;
  reg.prune();
  assert.equal(killCount,1,'prune must not endlessly re-kill a PTY with no PID/onExit');
  assert.equal(events.filter(e=>e.type==='terminal_exit_unverified').length,1);
  assert.throws(()=>reg.start({...owner,cwd:os.tmpdir(),shellSpec:{file:'/bin/sh',args:[],shell:'sh'}}),/terminal_capacity_reached/,'do not free unverified live capacity');
  console.log('G2_PTY_MISSING_PID_ONEXIT_FAIL_CLOSED=PASS');
  console.log('G2_PTY_MISSING_PID_NO_REPEATED_KILL=PASS');
  onExit({exitCode:0,signal:null});
  const done=reg.view(started.terminalId,owner);
  assert.equal(done.finishedAt,clock);
  assert.equal(done.state,'expired','late exit confirms termination but preserves the TTL expiry cause');
  assert.equal(done.exitEvidence,'onExit');
  assert.equal(done.exitCode,0);
  assert.equal(reg.list(owner).filter(x=>!x.finishedAt).length,0);
  console.log('G2_PTY_LATE_ONEXIT_RECOVERY_RELEASES_SLOT=PASS');
}finally{reg.close();}
