import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {ProcessSupervisorClient} from '../../device-agent/process-supervisor-client.mjs';

if(process.platform==='win32'){console.log('M5_POSIX_SUPERVISOR_NOT_FOR_WINDOWS=SKIP');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-m5-supervisor-'),{mode:0o700});
fs.chmodSync(dir,0o700);
const sock=path.join(dir,'supervisor.sock'),token=path.join(dir,'token'),state=path.join(dir,'device.json');
const owner={accountId:'fixture_account',deviceId:'fixture_device',sessionId:'session_restart_fixture',agentId:'agent_fixture'};
fs.writeFileSync(state,JSON.stringify({enrollment:{accountId:owner.accountId,deviceId:owner.deviceId,approvedCapabilities:['filesystem','build-test']},policy:{deniedCapabilities:[]}}),{mode:0o600});
const child=spawn(process.execPath,['device-agent/process-supervisor.mjs'],{cwd:path.resolve('.'),
  env:{...process.env,LIGHT_REMOTE_PROCESS_SUPERVISOR_SOCKET:sock,LIGHT_REMOTE_PROCESS_SUPERVISOR_TOKEN_FILE:token,OPERATOR_AGENT_STATE:state},
  stdio:['ignore','pipe','pipe']});
let errorText='';child.stderr.on('data',x=>errorText+=x.toString());
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let pid;
try{
  for(let n=0;n<100&&!fs.existsSync(sock);n++){if(child.exitCode!==null)throw Error('supervisor_died:'+errorText);await delay(30);}
  assert.ok(fs.existsSync(sock),'socket running');
  assert.equal(fs.statSync(sock).mode&0o077,0);assert.equal(fs.statSync(token).mode&0o077,0);
  // Real separate "Agent" client process opens job and exits entirely.
  const moduleUrl=pathToFileURL(path.resolve('device-agent/process-supervisor-client.mjs')).href;
  const clientScript="import {ProcessSupervisorClient} from "+JSON.stringify(moduleUrl)+";"+
    "const c=new ProcessSupervisorClient("+JSON.stringify({socketPath:sock,tokenFile:token})+");"+
    "console.log(JSON.stringify(await c.start("+JSON.stringify({...owner,cwd:dir,script:'sleep 25',shell:'sh',timeoutMs:30000,operationId:'m5-agent-restart-dedupe-001'})+")));";
  const first=spawnSync(process.execPath,['--input-type=module','-e',clientScript],{cwd:path.resolve('.'),encoding:'utf8',timeout:15000});
  assert.equal(first.status,0,first.stderr);
  const running=JSON.parse(first.stdout.trim());
  pid=running.pid;
  assert.ok(running.processId.startsWith('lp_'));
  assert.equal(running.state,'running');
  // Mimic complete Agent restart by terminating the first client process:
  // second instance is independent and reconstructs from service/socket alone.
  const restarted=new ProcessSupervisorClient({socketPath:sock,tokenFile:token});
  const list=await restarted.list(owner);
  assert.ok(list.some(p=>p.processId===running.processId&&p.state==='running'));
  const d=await restarted.listDevice(owner.accountId,owner.deviceId);
  assert.ok(d.some(p=>p.processId===running.processId&&p.state==='running'));
  const replay=await restarted.start({...owner,cwd:dir,script:'sleep 25',shell:'sh',timeoutMs:30000,operationId:'m5-agent-restart-dedupe-001'});
  assert.equal(replay.processId,running.processId,'lost ACK replay must not launch a second process');
  await assert.rejects(()=>restarted.start({...owner,cwd:dir,script:'printf mismatch',shell:'sh',timeoutMs:30000,operationId:'m5-agent-restart-dedupe-001'}),/operation_id_conflict/);
  assert.equal((await restarted.output(running.processId,owner,{stream:'stdout',offset:0})).state,'running');
  assert.deepEqual(await restarted.list({...owner,agentId:'another_agent'}),[],'foreign Agent list is empty');
  await assert.rejects(()=>restarted.stop(running.processId,{...owner,agentId:'foreign_agent'}),/process_owner_mismatch/);
  await assert.rejects(()=>restarted.listDevice('other_account',owner.deviceId),/supervisor_device_identity_mismatch/);
  const badToken=new ProcessSupervisorClient({socketPath:sock,tokenFile:path.join(dir,'incorrect-token')});
  fs.writeFileSync(path.join(dir,'incorrect-token'),'0'.repeat(64),{mode:0o600});
  await assert.rejects(()=>badToken.list(owner),/supervisor_auth_required/);
  await restarted.stop(running.processId,owner,{force:false});
  let final;
  for(let n=0;n<70;n++){final=(await restarted.list(owner)).find(x=>x.processId===running.processId);if(final?.finishedAt)break;await delay(70);}
  assert.equal(final.state,'stopped');
  assert.ok(final.finishedAt);
  console.log('M5_SUPERVISOR_CHILD_ALIVE_ACROSS_AGENT_CLIENT_RECONNECT=PASS');
  console.log('M5_SUPERVISOR_PRIVATE_SOCKET_TOKEN_AND_OWNER_BOUNDARY=PASS');
  console.log('M5_SUPERVISOR_REAL_OS_STOP_AND_FINISH=PASS');
}finally{
  child.kill('SIGTERM');
  await new Promise(ok=>{if(child.exitCode!==null)return ok();child.once('exit',ok);setTimeout(ok,1700).unref();});
  if(pid){try{process.kill(pid,'SIGKILL');}catch{}}
  fs.rmSync(dir,{recursive:true,force:true});
}
