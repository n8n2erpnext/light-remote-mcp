import assert from 'node:assert/strict';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {NativeTerminalRegistry} from '../../lib/native-terminal.mjs';
const owner={accountId:'g2-pty',deviceId:'gold-device',sessionId:'g2-session',agentId:'g2-agent'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const records=[];
let command="setTimeout(()=>process.exit(0),150)";
const provider={spawn(){
  const child=spawn(process.execPath,['-e',command],{cwd:os.tmpdir(),windowsHide:true,stdio:'ignore'});
  records.push(child);
  return {pid:child.pid,write(){},resize(){},onData(){},onExit(){},kill(signal){try{process.kill(child.pid,signal||'SIGKILL')}catch(e){if(e?.code!=='ESRCH')throw e}}};
}};
const events=[];
const reg=new NativeTerminalRegistry({platform:process.platform,ptyProvider:provider,emit:e=>events.push(e),stopGraceMs:110});
const poll=async(id,expect,ms=4000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){const row=reg.view(id,owner);if(expect(row))return row;await wait(25)}throw Error('missing_exit_timeout:'+JSON.stringify(reg.view(id,owner)))};
try{
  const natural=reg.start({...owner,cwd:os.tmpdir(),shellSpec:{file:process.execPath,args:[],shell:'node'}});
  const done=await poll(natural.terminalId,row=>!!row.finishedAt);
  assert.equal(done.state,'finished');
  assert.equal(done.exitCode,null,'missing callback must not invent exit code 0');
  assert.equal(done.exitEvidence,'pid_disappeared');
  assert.ok(events.some(e=>e.type==='terminal_exit_reconciled'&&e.terminalId===natural.terminalId));
  console.log('G2_PTY_LOST_ONEXIT_NATURAL_PID_RECONCILED=PASS');
  command="setInterval(()=>{},1000)";
  const terminated=reg.start({...owner,cwd:os.tmpdir(),shellSpec:{file:process.execPath,args:[],shell:'node'}});
  await wait(100);
  reg.stop(terminated.terminalId,owner,{force:false});
  const stopped=await poll(terminated.terminalId,row=>!!row.finishedAt,5500);
  assert.equal(stopped.exitEvidence,'pid_disappeared');
  assert.ok(['finished','expired'].includes(stopped.state));
  console.log('G2_PTY_LOST_ONEXIT_STOP_PID_RECONCILED=PASS');
  assert.equal(reg.list(owner).filter(row=>!row.finishedAt).length,0);
  console.log('G2_PTY_LOST_ONEXIT_NO_ACTIVE_SLOT=PASS');
}finally{
  reg.close();
  for(const child of records)if(child.pid)try{process.kill(child.pid,'SIGKILL')}catch{}
}
