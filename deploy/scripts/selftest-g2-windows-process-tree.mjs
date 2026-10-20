import assert from 'node:assert/strict';
import os from 'node:os';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';

if(process.platform!=='win32'){
  console.log('G2_WINDOWS_PROCESS_TREE=SKIP_NON_WINDOWS');
  process.exit(0);
}
const owner={accountId:'g2win',deviceId:'g2windev',sessionId:'g2winsession',agentId:'g2winagent'};
const reg=new NativeProcessRegistry({stopGraceMs:120});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
const childScript='setInterval(()=>{},1000)';
const parentScript="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"+JSON.stringify(childScript)+"],{windowsHide:true,stdio:'ignore'});console.log('G2_CHILD_PID='+child.pid);setInterval(()=>{},1000);";
const spawnSpec=()=>({file:process.execPath,args:['-e',parentScript]});
const waitUntil=async(fn,label,ms=4500)=>{const until=Date.now()+ms;while(Date.now()<until){const value=fn();if(value)return value;await sleep(25);}throw Error('G2_TIMEOUT:'+label);};
const tracked=[];
const startFixture=async(timeoutMs=0)=>{
  const processRow=reg.start({...owner,script:'G2_FIXTURE',cwd:os.tmpdir(),spawnSpec,timeoutMs});
  const fixture={id:processRow.processId,pid:processRow.pid,childPid:null};tracked.push(fixture);
  const pid=await waitUntil(()=>{
    const match=reg.output(fixture.id,owner,{stream:'stdout',limit:200}).output.text.match(/G2_CHILD_PID=(\d+)/);
    return match?Number(match[1]):null;
  },'child_pid',6000);
  fixture.childPid=pid;
  assert.ok(alive(pid),'spawned descendant must be live');
  return fixture;
};
try{
  const first=await startFixture();
  const stopped=reg.stop(first.id,owner,{force:false});
  assert.equal(stopped.stopRequested,true);
  assert.equal(stopped.stopForce,true,'Windows /F must be reflected in status');
  assert.equal(stopped.treeStopMethod,'taskkill-tree');
  await waitUntil(()=>!alive(first.childPid),'stop_descendant_not_alive',4000);
  await waitUntil(()=>reg.view(first.id,owner).finishedAt!=null,'stop_finished');
  assert.equal(reg.view(first.id,owner).state,'stopped');
  console.log('G2_WINDOWS_PROCESS_TREE_STOP_NO_ORPHAN=PASS');

  const timed=await startFixture(1800);
  await waitUntil(()=>reg.view(timed.id,owner).finishedAt!=null,'timeout_parent',8500);
  const t=reg.view(timed.id,owner);
  assert.equal(t.state,'timeout');
  assert.equal(t.timedOut,true);
  assert.equal(t.treeStopMethod,'taskkill-tree');
  await waitUntil(()=>!alive(timed.childPid),'timeout_descendant_not_alive');
  console.log('G2_WINDOWS_PROCESS_TREE_TIMEOUT_NO_ORPHAN=PASS');

  const closing=await startFixture();
  reg.close();
  await waitUntil(()=>!alive(closing.childPid),'shutdown_descendant_not_alive',4500);
  console.log('G2_WINDOWS_PROCESS_TREE_SHUTDOWN_NO_ORPHAN=PASS');
}finally{
  reg.close();
  for(const fixture of tracked){
    if(fixture.childPid&&alive(fixture.childPid))try{process.kill(fixture.childPid,'SIGKILL');}catch{}
    if(fixture.pid&&alive(fixture.pid))try{process.kill(fixture.pid,'SIGKILL');}catch{}
  }
}
