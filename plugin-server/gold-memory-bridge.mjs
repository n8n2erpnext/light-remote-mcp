/*
 * Requires an A/B-authorized active session on the exact selected device,
 * plus existing remote:execute permission. No additional listener or account.
 * This is a restricted command route over the existing governed Gold Agent.
 */
import crypto from 'node:crypto';

const MARKER='LIGHT_REMOTE_GOLD_MEMORY_V1=';
function failure(code,status=400){return Object.assign(new Error(code),{status});}
function b64url(value){return Buffer.from(JSON.stringify(value),'utf8').toString('base64url');}
export function makeGoldMemoryExecScript(x){
  if(!['handoff','list','get','save'].includes(x.action))throw failure('gold_memory_action_invalid');
  const clean={action:x.action};
  if(x.action==='save'){
    if(typeof x.title!=='string'||x.title.length<1||x.title.length>240
      ||typeof x.body!=='string'||x.body.length<1||x.body.length>12000
      ||typeof x.source!=='string'||x.source.length<1||x.source.length>512)
      throw failure('gold_memory_save_validation_failed');
    Object.assign(clean,{title:x.title,body:x.body,source:x.source,kind:x.kind||'checkpoint'});
  }
  if(x.action==='get'){
    if(typeof x.id!=='string'||!/^[a-f0-9-]{36}$/.test(x.id))throw failure('gold_memory_id_invalid');
    clean.id=x.id;
  }
  if(x.action==='list')clean.query=String(x.query||'').slice(0,160);
  if(x.action==='list'||x.action==='handoff')clean.limit=Math.max(1,Math.min(Number(x.limit)||5,30));
  const encoded=b64url(clean);
  // base64url is shell-inert on bash, sh and PowerShell.
  if(!/^[A-Za-z0-9_-]+$/.test(encoded))throw failure('gold_memory_encoding_invalid');
  return 'node --no-warnings device-agent/gold-memory-cli.mjs '+encoded;
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
export async function runGoldMemoryViaAuthorizedSession(adapter,input){
  const script=makeGoldMemoryExecScript(input);
  // A/B, exact session device authorization and local policy are enforced
  // by AccountOperatorAdapter.exec() and the existing Gold Agent.
  const response=await adapter.exec(input.sessionId,script,{
    executionMode:'foreground',waitMs:7000,timeoutMs:25000,
    operationId:input.operationId,requiredCapabilities:['filesystem']
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
