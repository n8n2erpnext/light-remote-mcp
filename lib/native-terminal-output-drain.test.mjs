import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeTerminalRegistry} from './native-terminal.mjs';
test('Windows PID disappearance must not dispose ConPTY before late output and its exit receipt',async t=>{
 const previous=process.kill,pid=2147483000;let data,exit,released=false;
 process.kill=(value,signal)=>{if(value===pid)throw Object.assign(Error('fixture missing PID'),{code:'ESRCH'});return previous(value,signal);};
 t.after(()=>{process.kill=previous;});
 const provider={spawn:()=>({pid,write(){},resize(){},kill(){},
  onData(fn){data=fn;},onExit(fn){exit=fn;},
  _agent:{inSocket:{destroy(){released=true;}},_conoutSocketWorker:{dispose(){released=true;}}}})};
 const reg=new NativeTerminalRegistry({platform:'win32',ptyProvider:provider});t.after(()=>reg.close());
 const owner={accountId:'fixture',deviceId:'fixture',sessionId:'fixture',agentId:'fixture'};
 const tty=reg.start({...owner,cwd:process.cwd(),shellSpec:{file:'fixture',args:[]}});
 assert.equal(tty.finishedAt,null);assert.equal(released,false);
 await new Promise(r=>setTimeout(r,50));
 if(!released)data('FINAL_CONPTY_OUTPUT\r\n');
 exit({exitCode:0});
 const result=reg.output(tty.terminalId,owner);
 assert.equal(result.output.text,'FINAL_CONPTY_OUTPUT\r\n');assert.equal(result.exitCode,0);assert.equal(result.exitEvidence,'onExit');assert.equal(released,true);
});
