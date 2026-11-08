import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';

const owner={accountId:'g2',deviceId:'g2',sessionId:'g2',agentId:'g2'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reg=new NativeProcessRegistry({stopGraceMs:100});
const procState=pid=>{
  if(process.platform!=='linux')return null;
  try{return fs.readFileSync('/proc/'+pid+'/stat','utf8').split(' ')[2];}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
};
const live=pid=>{
  if(process.platform==='linux')return ![null,'X','Z'].includes(procState(pid));
  try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}
};
const childSpec=process.platform==='win32'
  ? script=>({file:process.execPath,args:['-e',script]})
  : script=>({file:'/bin/bash',args:['-lc',script]});
const code=process.platform==='win32'
  ? 'setInterval(()=>{},1000)'
  : 'sleep 30 & p=$!; echo G2_CHILD_PID=$p; wait $p';
const started=reg.start({...owner,cwd:os.tmpdir(),script:code,spawnSpec:childSpec});
let childPid=null,ready=false;
try{
  for(let i=0;i<100;i++){
    const s=reg.output(started.processId,owner).output.text;
    if(process.platform==='win32'){ready=reg.view(started.processId,owner).state==='running';break;}
    const match=s.match(/G2_CHILD_PID=(\d+)/);
    if(match){childPid=Number(match[1]);ready=true;break;}
    await sleep(15);
  }
  assert.equal(ready,true,'process must be running before shutdown');
  assert.ok(live(reg.view(started.processId,owner).pid),'managed process alive pre-shutdown');
  if(childPid)assert.ok(live(childPid),'descendant alive pre-shutdown');
  reg.close();
  reg.close(); // idempotent on shutdown
  for(let i=0;i<150&&live(started.pid);i++)await sleep(20);
  assert.equal(live(started.pid),false,'managed process must not survive shutdown');
  if(childPid){
    for(let i=0;i<150&&live(childPid);i++)await sleep(20);
    assert.equal(live(childPid),false,'POSIX descendant must not survive shutdown');
  }
  const row=reg.view(started.processId,owner);
  assert.equal(row.stopRequested,true);
  assert.equal(row.stopForce,true);
  console.log('G2_RUNTIME_SHUTDOWN_MANAGED_PROCESS=PASS');
  if(childPid)console.log('G2_RUNTIME_SHUTDOWN_POSIX_CHILD_GROUP=PASS');
}finally{
  reg.close();
  if(childPid&&live(childPid))try{process.kill(childPid,'SIGKILL');}catch{}
}
