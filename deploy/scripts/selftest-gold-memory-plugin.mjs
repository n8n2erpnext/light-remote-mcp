import assert from 'node:assert/strict';
import {makeGoldMemoryExecScript,parseGoldMemoryExecOutput,runGoldMemoryViaAuthorizedSession} from '../../plugin-server/gold-memory-bridge.mjs';

const marker='LIGHT_REMOTE_GOLD_MEMORY_V1=';
const input={sessionId:'s_exact_owner_A',operationId:'mem_op_1234567890abcdef',
  clientRoot:'/opt/light-remote-gold-uat-candidates/gold-test',
  action:'save',title:'Checkpoint; && whoami',source:'owner_session_A',
  body:'Gold restore ba579f8\nCodex observer did not modify task states'};
const script=makeGoldMemoryExecScript(input);
assert.match(script,/^node --no-warnings device-agent\/gold-memory-cli\.mjs [A-Za-z0-9_-]+$/);
assert.doesNotMatch(script,/whoami/);
const decoded=JSON.parse(Buffer.from(script.split(' ').at(-1),'base64url').toString());
assert.equal(decoded.title,'Checkpoint; && whoami');
const requests=[];
const adapter={
 exec:async(session,cmd,opts)=>{
   requests.push({session,cmd,opts});
   return {ok:true,job:{jobId:'job_exact',state:'ok',exitCode:0}};
 },
 output:async(jobId,stream)=>{
   assert.equal(jobId,'job_exact');assert.equal(stream,'stdout');
   return {output:marker+JSON.stringify({ok:true,action:'save',result:{id:'memory123',signature:'abc'}})+'\n'};
 }
};
const saved=await runGoldMemoryViaAuthorizedSession(adapter,input);
assert.equal(saved.sessionId,input.sessionId);
assert.equal(saved.result.id,'memory123');
assert.equal(requests[0].session,'s_exact_owner_A');
assert.equal(requests[0].opts.cwd,'/opt/light-remote-gold-uat-candidates/gold-test');
assert.equal(requests[0].opts.executionMode,'foreground');
assert.deepEqual(requests[0].opts.requiredCapabilities,['filesystem']);
assert.equal(requests[0].opts.operationId,input.operationId);
const windowsRoot='C:\\Users\\vkphu\\AppData\\Local\\Programs\\Light Remote MCP\\agent';
const winInput={...input,clientRoot:windowsRoot};
const winResult=await runGoldMemoryViaAuthorizedSession(adapter,winInput);
assert.equal(winResult.ok,true);
assert.equal(requests.at(-1).opts.cwd,windowsRoot);
assert.match(requests.at(-1).cmd,/^& 'C:\\Users\\vkphu\\AppData\\Local\\Programs\\Light Remote MCP\\runtime\\node\.exe' --no-warnings/);
assert.doesNotMatch(requests.at(-1).cmd,/whoami/);
const powerShellQuoted=makeGoldMemoryExecScript(input,{nodeBinary:"C:\\root's folder\\node.exe"});
assert.match(powerShellQuoted,/^& 'C:\\root''s folder\\node\.exe' --no-warnings/);
let denied=false;
try{await runGoldMemoryViaAuthorizedSession({exec:async()=>{throw new Error('device_access_grant_required');}},input);}
catch(e){denied=true;assert.match(e.message,/device_access_grant_required/);}
assert.equal(denied,true,'Must never silently select another device or bypass expired A/B');
const pending=await runGoldMemoryViaAuthorizedSession({exec:async()=>({job:{jobId:'job_pending',state:'running'}})},input);
assert.equal(pending.pending,true);
assert.equal(pending.jobId,'job_pending');
assert.throws(()=>parseGoldMemoryExecOutput(marker+'{"ok":false,"error":"gold_checkpoint_integrity_failed"}\n'),/gold_checkpoint_integrity_failed/);
assert.throws(()=>makeGoldMemoryExecScript({...input,action:'evil'}),/gold_memory_action_invalid/);
await assert.rejects(runGoldMemoryViaAuthorizedSession(adapter,{...input,clientRoot:''}),
  /gold_memory_client_root_required/);
const priorRoot=process.env.LIGHT_REMOTE_GOLD_MEMORY_CLIENT_ROOT;
const priorDevice=process.env.LIGHT_REMOTE_GOLD_MEMORY_DEVICE_ID;
try{
  process.env.LIGHT_REMOTE_GOLD_MEMORY_CLIENT_ROOT='/opt/light-remote-gold-uat-candidates/known-gold';
  process.env.LIGHT_REMOTE_GOLD_MEMORY_DEVICE_ID='dev_known';
  const boundAdapter={...adapter,sessionRaw:async()=>({deviceId:'dev_known'})};
  const yes=await runGoldMemoryViaAuthorizedSession(boundAdapter,{...input,clientRoot:undefined});
  assert.equal(yes.ok,true);
  assert.equal(requests.at(-1).opts.cwd,'/opt/light-remote-gold-uat-candidates/known-gold');
  await assert.rejects(runGoldMemoryViaAuthorizedSession({...adapter,sessionRaw:async()=>({deviceId:'dev_other'})},{...input,clientRoot:undefined}),
    /gold_memory_device_binding_mismatch/);
}finally{
  if(priorRoot===undefined)delete process.env.LIGHT_REMOTE_GOLD_MEMORY_CLIENT_ROOT;
  else process.env.LIGHT_REMOTE_GOLD_MEMORY_CLIENT_ROOT=priorRoot;
  if(priorDevice===undefined)delete process.env.LIGHT_REMOTE_GOLD_MEMORY_DEVICE_ID;
  else process.env.LIGHT_REMOTE_GOLD_MEMORY_DEVICE_ID=priorDevice;
}
console.log('GOLD_MEMORY_PLUGIN_AUTHORIZED_EXACT_SESSION_NO_SHELL_INJECTION_PASS');
console.log('GOLD_MEMORY_PLUGIN_NO_AB_FALLBACK_AND_NO_DUPLICATE_WRITE_RETRY_PASS');
