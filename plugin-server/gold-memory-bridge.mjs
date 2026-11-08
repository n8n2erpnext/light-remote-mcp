/*
 * Requires an A/B-authorized active session on the exact selected device,
 * plus existing remote:execute permission. No additional listener or account.
 * This is a restricted command route over the existing governed Gold Agent.
 */
import crypto from 'node:crypto';
import path from 'node:path';

const MARKER='LIGHT_REMOTE_GOLD_MEMORY_V1=';
function failure(code,status=400){return Object.assign(new Error(code),{status});}
function b64url(value){return Buffer.from(JSON.stringify(value),'utf8').toString('base64url');}
export function makeGoldMemoryExecScript(x,{nodeBinary=null}={}){
  if(!['handoff','list','get','save','scopes','scope_resolve','scope_handoff','scope_get','scope_save','scope_usage','scope_full_context'].includes(x.action))throw failure('gold_memory_action_invalid');
  const clean={action:x.action};
  if(['save','scope_save'].includes(x.action)){
    if(typeof x.title!=='string'||x.title.length<1||x.title.length>240
      ||typeof x.body!=='string'||x.body.length<1||x.body.length>12000
      ||typeof x.source!=='string'||x.source.length<1||x.source.length>512)
      throw failure('gold_memory_save_validation_failed');
    Object.assign(clean,{title:x.title,body:x.body,source:x.source,kind:x.kind||'checkpoint'});
    if(x.action==='scope_save'){
      if(!x.scopeId||!/^[-a-f0-9]{36}$/i.test(x.scopeId))throw failure('gold_scope_id_invalid');
      clean.scopeId=x.scopeId;
      if(x.status!==undefined)clean.status=x.status;
      if(x.evidence!==undefined)clean.evidence=x.evidence;
    }
  }
  if(['get','scope_get'].includes(x.action)){
    if(typeof x.id!=='string'||!/^[a-f0-9-]{36}$/.test(x.id))throw failure('gold_memory_id_invalid');
    clean.id=x.id;
  }
  if(x.action==='list')clean.query=String(x.query||'').slice(0,160);
  if(['list','handoff','scope_handoff'].includes(x.action))clean.limit=Math.max(1,Math.min(Number(x.limit)||5,30));
  if(['scope_handoff','scope_get','scope_full_context'].includes(x.action)){
    if(!x.scopeId||!/^[-a-f0-9]{36}$/i.test(x.scopeId))throw failure('gold_scope_id_invalid');
    clean.scopeId=x.scopeId;
  }
  if(x.action==='scope_full_context'){
    clean.offset=Math.max(0,Math.min(Number(x.offset)||0,524288));
    clean.maxChars=Math.max(1,Math.min(Number(x.maxChars)||8000,10000));
  }
  if(x.action==='scope_resolve'){
    if(!['workspace','repository','job','task','work_context'].includes(x.sourceType)||
       typeof x.sourceId!=='string'||x.sourceId.length>1024)throw failure('gold_scope_resolve_invalid');
    clean.sourceType=x.sourceType;clean.sourceId=x.sourceId;
  }
  const encoded=b64url(clean);
  // base64url is shell-inert on bash, sh and PowerShell.
  if(!/^[A-Za-z0-9_-]+$/.test(encoded))throw failure('gold_memory_encoding_invalid');
  // Windows installations bundle Node beside agent/. Never assume node.exe
  // is globally available in the user's PowerShell PATH.
  const executable=nodeBinary?"& '"+String(nodeBinary).replace(/'/g,"''")+"' ":'node ';
  return executable+'--no-warnings device-agent/gold-memory-cli.mjs '+encoded;
}
export function parseGoldMemoryExecOutput(output){
  if(typeof output!=='string')throw failure('gold_memory_output_invalid',502);
  const row=output.split(/\r?\n/).find(v=>v.startsWith(MARKER));
  if(!row)throw failure('gold_memory_output_not_found',502);
  const value=JSON.parse(row.slice(MARKER.length));
  if(value.ok!==true)throw failure(typeof value.error==='string'&&/^gold_[a-z0-9_]{2,100}$/.test(value.error)?
     value.error:'gold_memory_failed',409);
  return value;
}
// A read-only bootstrap to get the installation root from the exact Windows
// Agent. This cannot run/duplicate the requested memory save or checkpoint.
// Use a known Windows temp cwd so a stale unknown-project claim cannot block
// the bootstrap. The actual memory command uses the verified installation cwd.
async function resolveStandardWindowsMemoryRoot(adapter,sessionId,operationId=null){
  const probe="\u0024base=Join-Path \u0024env:LOCALAPPDATA 'Programs\\Light Remote MCP'; "+
    "\u0024root=Join-Path \u0024base 'agent'; "+
    "if(!(Test-Path -LiteralPath (Join-Path \u0024base 'runtime\\node.exe')) -or "+
    "!(Test-Path -LiteralPath (Join-Path \u0024root 'device-agent\\gold-memory-cli.mjs'))){throw 'gold_memory_client_root_required'}; "+
    "Write-Output ('LIGHT_REMOTE_GOLD_MEMORY_CLIENT_ROOT='+\u0024root)";
  const probeId=typeof operationId==='string'&&operationId.length>=16?
    'gold-memory-path-'+crypto.createHash('sha256').update(sessionId+'|'+operationId).digest('hex').slice(0,32):
    'gold-memory-path-'+crypto.randomUUID();
  const response=await adapter.exec(sessionId,probe,{
    executionMode:'foreground',waitMs:7000,timeoutMs:15000,
    cwd:'C:\\Windows\\Temp',operationId:probeId,
    requiredCapabilities:['filesystem']
  });
  const job=response?.job;
  if(!job?.jobId)throw failure('gold_memory_client_root_probe_receipt_missing',502);
  if(job.state!=='ok'&&job.state!=='completed'&&job.exitCode!==0)
    return {pending:true,jobId:job.jobId};
  const data=await adapter.output(job.jobId,'stdout',0,8192,true);
  const line=String(data?.output||'').split(/\r?\n/).find(row=>row.startsWith('LIGHT_REMOTE_GOLD_MEMORY_CLIENT_ROOT='));
  const root=String(line||'').slice('LIGHT_REMOTE_GOLD_MEMORY_CLIENT_ROOT='.length).trim();
  if(!/^[A-Za-z]:[\\/]/.test(root)||root.length>4096||/[\r\n\0]/.test(root)||
    root.split(/[\\/]/).includes('..')||
    !path.win32.normalize(root).toLowerCase().endsWith('\\programs\\light remote mcp\\agent'))
    throw failure('gold_memory_client_root_probe_invalid',502);
  return {root:path.win32.normalize(root)};
}
export async function runGoldMemoryViaAuthorizedSession(adapter,input){
  // An explicit root is always honored for custom installs. Without it,
  // verify the A/B session AND device platform before deriving the standard
  // Windows installer path locally on that same Windows device.
  const explicitRoot=String(input.clientRoot||'').trim();
  let configuredRoot=explicitRoot;
  let windowsDefault=false;
  if(!explicitRoot){
    const ownedSession=await adapter.sessionRaw(input.sessionId);
    const device=await adapter.deviceRaw(ownedSession.deviceId);
    if(device?.deviceId!==ownedSession.deviceId)
      throw failure('gold_memory_device_binding_mismatch',403);
    if(String(device.platform).toLowerCase()==='win32'){
      windowsDefault=true;
      const resolved=await resolveStandardWindowsMemoryRoot(adapter,input.sessionId,input.operationId);
      if(resolved.pending)return {ok:false,pending:true,jobId:resolved.jobId,
        nextAction:'inspect_existing_job_output_without_reexecuting'};
      configuredRoot=resolved.root;
    }else{
      const allowedId=String(process.env.LIGHT_REMOTE_GOLD_MEMORY_DEVICE_ID||'').trim();
      if(!allowedId)throw failure('gold_memory_device_binding_unconfigured',409);
      if(ownedSession.deviceId!==allowedId)throw failure('gold_memory_device_binding_mismatch',403);
      configuredRoot=String(process.env.LIGHT_REMOTE_GOLD_MEMORY_CLIENT_ROOT||'').trim();
    }
  }
  if(!windowsDefault&&(!configuredRoot||configuredRoot.length>4096||
    !(configuredRoot.startsWith('/')||/^[A-Za-z]:[\\/]/.test(configuredRoot))))
    throw failure('gold_memory_client_root_required',409);
  const isWindowsRoot=/^[A-Za-z]:[\\/]/.test(configuredRoot);
  const nodeBinary=isWindowsRoot?path.win32.join(path.win32.dirname(configuredRoot),'runtime','node.exe'):null;
  const script=makeGoldMemoryExecScript(input,{nodeBinary});

  // A/B, exact session device authorization and local policy are enforced
  // by AccountOperatorAdapter.exec() and the existing Gold Agent.
  const response=await adapter.exec(input.sessionId,script,{
    executionMode:'foreground',waitMs:7000,timeoutMs:25000,
    cwd:configuredRoot,operationId:input.operationId,requiredCapabilities:['filesystem']
  });
  const job=response?.job;
  if(!job?.jobId)throw failure('gold_memory_command_receipt_missing',502);
  if(job.state!=='ok'&&job.state!=='completed'&&job.exitCode!==0){
    // Important: never rerun an unobserved possibly-successful save.
    return {ok:false,pending:true,jobId:job.jobId,
      nextAction:'inspect_existing_job_output_without_reexecuting'};
  }
  const stdout=await adapter.output(job.jobId,'stdout',0,150000,true);
  const parsed=parseGoldMemoryExecOutput(stdout.output);
  return {...parsed,sessionId:input.sessionId,source:'owner_authorized_gold_device'};
}
