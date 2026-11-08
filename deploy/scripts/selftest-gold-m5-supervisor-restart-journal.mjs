import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ProcessSupervisorClient} from '../../device-agent/process-supervisor-client.mjs';
if(process.platform==='win32'){console.log('M5_SUPERVISOR_JOURNAL_POSIX_ONLY=SKIP');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-m5-recovery-'));
fs.chmodSync(dir,0o700);
const journalDir=path.join(dir,'journal');fs.mkdirSync(journalDir,{mode:0o700});
const socketPath=path.join(dir,'svc.sock'),tokenFile=path.join(dir,'token'),stateFile=path.join(dir,'state.json');
const owner={accountId:'fixture-owner',deviceId:'fixture-device',sessionId:'session_restart',agentId:'agent_one'};
fs.writeFileSync(stateFile,JSON.stringify({enrollment:{accountId:owner.accountId,deviceId:owner.deviceId,approvedCapabilities:['filesystem']},policy:{deniedCapabilities:[]}}),{mode:0o600});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server=null,childPid=null,job;
function launch(){
  server=spawn(process.execPath,['device-agent/process-supervisor.mjs'],{cwd:path.resolve('.'),env:{...process.env,
    LIGHT_REMOTE_PROCESS_SUPERVISOR_SOCKET:socketPath,LIGHT_REMOTE_PROCESS_SUPERVISOR_TOKEN_FILE:tokenFile,
    LIGHT_REMOTE_PROCESS_SUPERVISOR_JOURNAL_DIR:journalDir,OPERATOR_AGENT_STATE:stateFile},stdio:['ignore','pipe','pipe']});
  server.stderr.on('data',()=>{});
}
async function waitReady(){
  const client=new ProcessSupervisorClient({socketPath,tokenFile});
  for(let i=0;i<150;i++){
    if(server.exitCode!==null)throw Error('supervisor_crashed_early');
    try{await client.list(owner);return client;}catch{}
    await sleep(35);
  }
  throw Error('supervisor_not_ready');
}
async function stopServer(signal='SIGTERM'){
  if(!server||server.exitCode!==null||server.signalCode!==null)return;
  const proc=server;
  proc.kill(signal);
  await Promise.race([new Promise(resolve=>proc.once('exit',resolve)),sleep(2500)]);
  if(proc.exitCode===null&&proc.signalCode===null){proc.kill('SIGKILL');await new Promise(resolve=>proc.once('exit',resolve));}
}
try{
  launch();
  const first=await waitReady();
  job=await first.start({...owner,cwd:dir,script:'sleep 70',shell:'sh',timeoutMs:90000,operationId:'supervisor-journal-running-job-0001'});
  childPid=job.pid;
  assert.equal(job.state,'running');
  const snapshot=JSON.parse(fs.readFileSync(path.join(journalDir,'supervisor-jobs-v1.json'),'utf8'));
  assert.equal(snapshot.rows[0].state,'running');
  assert.equal(snapshot.rows[0].processId,job.processId);
  assert.equal(fs.statSync(path.join(journalDir,'supervisor-jobs-v1.json')).mode&0o077,0);
  assert.ok(!fs.readFileSync(path.join(journalDir,'supervisor-jobs-v1.json'),'utf8').includes('sleep 70'),'never store script in journal');
  // Abrupt daemon crash, not Agent restart: the old shell's execution outcome
  // is UNKNOWN. Clean up fixture group directly, so test leaves no orphan.
  await stopServer('SIGKILL');
  try{process.kill(-childPid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
  childPid=null;
  launch();
  const next=await waitReady();
  const list=await next.list(owner);
  const recovered=list.find(x=>x.processId===job.processId);
  assert.ok(recovered);
  assert.equal(recovered.state,'unknown');
  assert.equal(recovered.unknownReason,'supervisor_restarted_before_terminal_receipt');
  assert.equal(recovered.outputAvailable,false);
  const all=await next.listDevice(owner.accountId,owner.deviceId);
  assert.equal(all.filter(x=>x.processId===job.processId).length,1);
  await assert.rejects(()=>next.start({...owner,cwd:dir,script:'sleep 70',shell:'sh',
    timeoutMs:90000,operationId:'supervisor-journal-running-job-0001'}),/prior_operation_status_unknown/);
  await assert.rejects(()=>next.start({...owner,cwd:dir,script:'sleep 80',shell:'sh',
    timeoutMs:90000,operationId:'supervisor-journal-running-job-0001'}),/operation_id_conflict/);
  await assert.rejects(()=>next.output(job.processId,owner,{stream:'stdout'}),/prior_operation_status_unknown/);
  await assert.rejects(()=>next.stop(job.processId,owner),/prior_operation_status_unknown/);
  assert.equal((await next.list({...owner,agentId:'different_agent'})).length,0);
  const complete=await next.start({...owner,cwd:dir,script:'printf done',shell:'sh',timeoutMs:5000,operationId:'supervisor-journal-completed-0001'});
  let terminal;
  for(let i=0;i<50;i++){terminal=(await next.list(owner)).find(x=>x.processId===complete.processId);if(terminal?.finishedAt)break;await sleep(45);}
  assert.equal(terminal.state,'finished');
  assert.equal(JSON.parse(fs.readFileSync(path.join(journalDir,'supervisor-jobs-v1.json'),'utf8')).rows.find(x=>x.processId===complete.processId)?.state,'finished','terminal state must reach fsync journal before restart');
  await stopServer();
  launch();
  const last=await waitReady();
  const finished=(await last.list(owner)).find(x=>x.processId===complete.processId);
  assert.equal(finished.state,'finished');
  assert.ok(finished.finishedAt);
  await assert.rejects(()=>last.start({...owner,cwd:dir,script:'printf done',shell:'sh',
    timeoutMs:5000,operationId:'supervisor-journal-completed-0001'}),/prior_operation_status_unknown/);
  console.log('M5_SUPERVISOR_CRASH_RECOVERS_UNKNOWN_NOT_FALSE_RUNNING=PASS');
  console.log('M5_SUPERVISOR_IDEMPOTENT_NO_DUPLICATE_REPLAY_AFTER_RESTART=PASS');
  console.log('M5_SUPERVISOR_TERMINAL_RECEIPT_SURVIVES_RESTART=PASS');
  console.log('M5_SUPERVISOR_PRIVATE_FSYNC_JOURNAL_NO_SCRIPT_LEAK=PASS');
}finally{
  await stopServer();
  if(childPid){try{process.kill(-childPid,'SIGKILL');}catch{}}
  fs.rmSync(dir,{recursive:true,force:true});
}
