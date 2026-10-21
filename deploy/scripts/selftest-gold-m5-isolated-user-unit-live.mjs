import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ProcessSupervisorClient} from '../../device-agent/process-supervisor-client.mjs';

// Real Linux user-systemd services. Intentionally NOT in default GitHub CI:
// requires pre-provisioned *isolated UAT* lingering user manager. No sudo.
if(process.platform!=='linux'||process.env.GOLD_M5_REAL_USER_SYSTEMD_UAT!=='1'){
 console.log('M5_ISOLATED_USER_UNIT_UAT_NOT_REQUESTED=SKIP');process.exit(0);
}
const root=process.env.GOLD_M5_TEST_PRIVATE_ROOT;
assert.ok(root&&path.isAbsolute(root));
const stat=fs.statSync(root);
assert.equal(stat.mode&0o077,0);
const dir=fs.mkdtempSync(path.join(root,'isolated-smoke-'));fs.chmodSync(dir,0o700);
const jobDir=path.join(dir,'journal');fs.mkdirSync(jobDir,{mode:0o700});
const sock=path.join(dir,'supervisor.sock'),token=path.join(dir,'token'),state=path.join(dir,'state.json');
const owner={accountId:'fixture_owner',deviceId:'fixture_device',sessionId:'fixture_session',agentId:'fixture_agent'};
fs.writeFileSync(state,JSON.stringify({enrollment:{accountId:owner.accountId,deviceId:owner.deviceId,approvedCapabilities:['filesystem']},policy:{deniedCapabilities:[]}}),{mode:0o600});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let supervisor=null,job=null,unitName=null;
function start(){
 supervisor=spawn(process.execPath,['device-agent/process-supervisor.mjs'],{cwd:path.resolve('.'),
  env:{...process.env,OPERATOR_AGENT_STATE:state,LIGHT_REMOTE_PROCESS_SUPERVISOR_SOCKET:sock,
   LIGHT_REMOTE_PROCESS_SUPERVISOR_TOKEN_FILE:token,LIGHT_REMOTE_PROCESS_SUPERVISOR_JOURNAL_DIR:jobDir,
   LIGHT_REMOTE_PROCESS_SUPERVISOR_ISOLATED_WORKERS:'1'},stdio:['ignore','pipe','pipe']});
 supervisor.stderr.on('data',()=>{});
}
async function ready(){
 const c=new ProcessSupervisorClient({socketPath:sock,tokenFile:token});
 for(let n=0;n<140;n++){if(supervisor.exitCode!==null||supervisor.signalCode!==null)throw Error('supervisor_fixture_died');
  try{await c.list(owner);return c;}catch{}await pause(40);}
 throw Error('supervisor_fixture_not_ready');
}
async function exit(signal){
 if(!supervisor)return;
 const node=supervisor;supervisor=null;
 if(node.exitCode===null&&node.signalCode===null)node.kill(signal);
 if(node.exitCode===null&&node.signalCode===null)await Promise.race([
  new Promise(done=>node.once('exit',done)),pause(2000)]);
 if(node.exitCode===null&&node.signalCode===null)node.kill('SIGKILL');
}
function getRecords(){return JSON.parse(fs.readFileSync(path.join(jobDir,'supervisor-jobs-v1.json'),'utf8')).rows;}
async function waitProcess(c,id,cond,limit=70){
 for(let i=0;i<limit;i++){
  const x=(await c.list(owner)).find(p=>p.processId===id);
  if(x&&cond(x))return x;
  await pause(100);
 }
 throw Error('expected_worker_state_timeout');
}
try{
 start();let c=await ready();
 job=await c.start({...owner,script:'printf M5_STARTED; sleep 24; printf M5_FINISHED',cwd:dir,shell:'sh',
  timeoutMs:30000,operationId:'m5-isolated-supervisor-crash-20261021-01',executionMode:'background'});
 assert.ok(job.processId.startsWith('lp_'));assert.equal(job.backend,'isolated-user-unit');
 unitName=job.unitName;
 await waitProcess(c,job.processId,p=>p.state==='running');
 await exit('SIGKILL'); // An independent user manager must keep this job alive.
 start();c=await ready();
 const recovered=await waitProcess(c,job.processId,p=>p.state==='running');
 assert.equal(recovered.processId,job.processId);
 assert.equal(recovered.backend,'isolated-user-unit');
 const replay=await c.start({...owner,script:'printf M5_STARTED; sleep 24; printf M5_FINISHED',cwd:dir,shell:'sh',
  timeoutMs:30000,operationId:'m5-isolated-supervisor-crash-20261021-01',executionMode:'background'});
 assert.equal(replay.processId,job.processId,'no second process may spawn after reconnect');
 await assert.rejects(()=>c.start({...owner,script:'printf ALTERED',cwd:dir,shell:'sh',
  timeoutMs:30000,operationId:'m5-isolated-supervisor-crash-20261021-01',executionMode:'background'}),/operation_id_conflict/);
 const stdout=await c.output(job.processId,owner,{stream:'stdout'});
 assert.match(stdout.output.text,/M5_STARTED/);
 await c.stop(job.processId,owner,{force:false});
 const final=await waitProcess(c,job.processId,p=>['stopped','finished','error','timeout'].includes(p.state),60);
 assert.ok(final.finishedAt);
 const persisted=await c.output(job.processId,owner,{stream:'stdout'});
 assert.match(persisted.output.text,/M5_STARTED/);
 assert.equal(getRecords().filter(row=>row.processId===job.processId).length,1);
 console.log('M5_USER_SYSTEMD_WORKER_SURVIVES_SUPERVISOR_SIGKILL=PASS');
 console.log('M5_USER_SYSTEMD_RECONNECT_OWNER_REPLAY_OUTPUT_CANCEL=PASS');
 console.log('M5_USER_SYSTEMD_INDEPENDENT_CGROUP_AND_RESULT=PASS');
}finally{
 await exit('SIGTERM');
 if(unitName){
  const {spawnSync}=await import('node:child_process');
  const env={...process.env,XDG_RUNTIME_DIR:'/run/user/'+process.getuid(),DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/'+process.getuid()+'/bus'};
  spawnSync('/usr/bin/systemctl',['--user','stop',unitName],{env,timeout:8000,stdio:'ignore'});
 }
 fs.rmSync(dir,{recursive:true,force:true});
}
