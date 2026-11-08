#!/usr/bin/env node
// Gold Linux-only optional durable-across-Agent-restart managed process daemon.
// Do not start inside Agent's systemd cgroup: a separate supervisor service owns children.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {NativeProcessRegistry} from '../lib/native-process.mjs';
import {SupervisorJobJournal} from '../lib/supervisor-job-journal.mjs';
import {IsolatedWorkerManager} from '../lib/isolated-worker-manager.mjs';
import {createPlatformAdapter} from './platform-adapters/index.mjs';

const MAX_REQUEST=128*1024;
const AUTH_HEADER='x-lr-supervisor-token';
const isOwner=x=>x&&['accountId','deviceId','sessionId','agentId'].every(k=>/^[a-zA-Z0-9._:-]{1,180}$/.test(String(x[k]||'')));
const errorStatus=e=>Number(e?.status)||400;
const respond=(res,status,data)=>{const str=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(str);};
function requirePrivateDir(dir){
  const stat=fs.statSync(dir);
  if(!stat.isDirectory()||(stat.mode&0o077))throw Error('supervisor_runtime_dir_not_private');
  if(typeof process.getuid==='function'&&stat.uid!==process.getuid())throw Error('supervisor_runtime_dir_owner_mismatch');
}
function ensureToken(filename){
  const dir=path.dirname(filename);requirePrivateDir(dir);
  try{fs.writeFileSync(filename,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}
  catch(e){if(e.code!=='EEXIST')throw e;}
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('supervisor_token_insecure');
  if(typeof process.getuid==='function'&&stat.uid!==process.getuid())throw Error('supervisor_token_owner_mismatch');
  const token=fs.readFileSync(filename,'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(token))throw Error('supervisor_token_invalid');
  return token;
}
export async function startProcessSupervisor({socketPath,tokenFile,stateFile,journalDir=null,isolatedWorkers=false,maxProcesses=16}={}){
  if(process.platform==='win32')throw Error('process_supervisor_windows_not_supported');
  if(!socketPath||!tokenFile||!stateFile||!path.isAbsolute(socketPath)||!path.isAbsolute(tokenFile))throw Error('supervisor_absolute_paths_required');
  if(path.dirname(socketPath)!==path.dirname(tokenFile))throw Error('supervisor_token_must_share_private_socket_dir');
  requirePrivateDir(path.dirname(socketPath));
  const secret=ensureToken(tokenFile);
  const adapter=createPlatformAdapter();
  const journal=journalDir?new SupervisorJobJournal({dir:journalDir}):null;
  if(isolatedWorkers&&!journal)throw Error('isolated_workers_require_crash_safe_journal');
  const durable=isolatedWorkers?new IsolatedWorkerManager({dir:path.join(journalDir,'isolated-jobs')}):null;
  async function viewIsolated(row){
    const status=await durable.view(row);
    if(['finished','stopped','timeout','error'].includes(status.state)&&status.finishedAt)
      journal.markFinished(status);
    return {...journal.byProcess(row.processId,row.owner),...status,
      accountId:row.owner.accountId,deviceId:row.owner.deviceId,sessionId:row.owner.sessionId,agentId:row.owner.agentId};
  }
  async function recoveredRows(owner=null,deviceOnly=false){
    if(!journal)return [];
    const records=deviceOnly?journal.reconciledDevice(owner.accountId,owner.deviceId):journal.reconciled(owner);
    const selected=records.slice(-64);
    const result=[];
    for(const row of selected){
      if(row.backend==='isolated-user-unit'){
        if(!durable){result.push({...row,state:'unknown',unknownReason:'isolated_worker_backend_disabled'});continue;}
        try{result.push(await viewIsolated({...row,owner:{accountId:row.accountId,deviceId:row.deviceId,sessionId:row.sessionId,agentId:row.agentId}}));}
        catch{result.push({...row,state:'unknown',unknownReason:'isolated_worker_probe_failed'});}
      }else result.push(row);
    }
    return result;
  }
  // A journal is authoritative for replay across service restarts, not for
  // pretending the original OS child is still attached after its parent dies.
  let processes;
  processes=new NativeProcessRegistry({maxProcesses,emit:event=>{
    if(event?.type==='process_finished'&&journal){
      try{journal.markFinished(processes.view(event.processId));}
      catch(e){console.error(JSON.stringify({event:'supervisor_journal_terminal_write_failed',code:String(e?.code||'JOURNAL_IO_ERROR')}));}
    }
  }});
  const dedupe=new Map();
  function checkIdentity(owner){
    if(!isOwner(owner))throw Object.assign(Error('supervisor_owner_invalid'),{status:400});
    const raw=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    if(raw?.enrollment?.accountId!==owner.accountId||raw?.enrollment?.deviceId!==owner.deviceId)
      throw Object.assign(Error('supervisor_device_identity_mismatch'),{status:403});
    return raw;
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const supplied=String(req.headers[AUTH_HEADER]||'');
      const ok=/^[a-f0-9]{64}$/.test(supplied)&&crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(secret));
      if(!ok)return respond(res,401,{ok:false,error:'supervisor_auth_required'});
      if(req.method!=='POST'||req.url!=='/v1/process')return respond(res,404,{ok:false,error:'not_found'});
      const chunks=[];let size=0;
      for await(const part of req){size+=part.length;if(size>MAX_REQUEST)throw Object.assign(Error('supervisor_request_too_large'),{status:413});chunks.push(part);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{throw Error('invalid_json');}
      const owner=input.owner;
      if(input.op==='list-device-terminals'||input.op==='ack-device-terminals'){
        const partial=input.owner;
        if(!partial||!['accountId','deviceId'].every(k=>/^[a-zA-Z0-9._:-]{1,180}$/.test(String(partial[k]||''))))
          throw Object.assign(Error('supervisor_owner_invalid'),{status:400});
        const raw=JSON.parse(fs.readFileSync(stateFile,'utf8'));
        if(raw?.enrollment?.accountId!==partial.accountId||
           raw?.enrollment?.deviceId!==partial.deviceId)
          throw Object.assign(Error('supervisor_device_identity_mismatch'),{status:403});
        if(!journal)throw Object.assign(Error('supervisor_journal_required_for_replay'),{status:409});
        if(input.op==='list-device-terminals')
          return respond(res,200,{ok:true,receipts:journal.unackedTerminals(partial.accountId,partial.deviceId,{limit:32})});
        const ack=journal.ackTerminals(partial.accountId,partial.deviceId,input.receipts);
        return respond(res,200,{ok:true,...ack});
      }
      if(input.op==='list-device'){
        const partial=input.owner;
        if(!partial||!['accountId','deviceId'].every(k=>/^[a-zA-Z0-9._:-]{1,180}$/.test(String(partial[k]||''))))
          throw Object.assign(Error('supervisor_owner_invalid'),{status:400});
        const raw=JSON.parse(fs.readFileSync(stateFile,'utf8'));
        if(raw?.enrollment?.accountId!==partial.accountId||raw?.enrollment?.deviceId!==partial.deviceId)
          throw Object.assign(Error('supervisor_device_identity_mismatch'),{status:403});
        const live=processes.list().filter(p=>p.accountId===partial.accountId&&p.deviceId===partial.deviceId);
        const recovered=(await recoveredRows(partial,true)).filter(p=>!live.some(l=>l.processId===p.processId));
        return respond(res,200,{ok:true,processes:[...live,...recovered].slice(0,64)});
      }
      const state=checkIdentity(owner);
      const op=String(input.op||'');
      if(!['start','output','input','stop','list'].includes(op))throw Error('supervisor_operation_invalid');
      // Owner Agent enforces signed A/B and effective policy before IPC; the
      // isolated process additionally checks device enrollment and local hard deny.
      if(op==='start'){
        const script=String(input.script||'');
        if(!script.trim()||Buffer.byteLength(script)>65536)throw Error('supervisor_script_invalid');
        const denied=adapter.hardDeny?.(script);
        if(denied)throw Object.assign(Error('local platform policy denied: '+denied),{status:403});
        const required=adapter.inferRequiredCapabilities(script,{shell:input.shell});
        const effective=(state.enrollment?.approvedCapabilities||[]).filter(x=>!(state.policy?.deniedCapabilities||[]).includes(x));
        if(required.some(cap=>!effective.includes(cap)))throw Object.assign(Error('local capability denied'),{status:403});
        const cwd=String(input.cwd||os.homedir());
        if(!fs.statSync(cwd).isDirectory())throw Error('cwd_not_directory');
        // An Agent can disconnect AFTER spawn but BEFORE receiving the ACK.
        // The same owner-scoped G4 operationId must not spawn a second process.
        const opId=String(input.operationId||'');
        if(opId&&!/^[A-Za-z0-9._:-]{16,128}$/.test(opId))throw Error('invalid_operation_id');
        const dedupeKey=opId?JSON.stringify([owner.accountId,owner.deviceId,owner.sessionId,owner.agentId,opId]):null;
        const fingerprint=crypto.createHash('sha256').update(JSON.stringify([script,cwd,input.timeoutMs||0,input.shell||'default'])).digest('hex');
        if(journal&&!opId)throw Object.assign(Error('supervisor_operation_id_required'),{status:400});
        const priorJournal=journal?journal.previous(owner,opId,fingerprint):null;
        if(priorJournal?.backend==='isolated-user-unit'){
          if(!durable)throw Object.assign(Error('prior_operation_status_unknown'),{status:409});
          const checked=await viewIsolated({...priorJournal,owner});
          if(checked.state==='unknown')throw Object.assign(Error('prior_operation_status_unknown'),{status:409});
          return respond(res,200,{ok:true,deduplicated:true,process:checked});
        }
        if(priorJournal&&!processes.list(owner).some(x=>x.processId===priorJournal.processId))
          throw Object.assign(Error('prior_operation_status_unknown'),{status:409});
        if(dedupeKey){
          const previous=dedupe.get(dedupeKey);
          if(previous){
            if(previous.fingerprint!==fingerprint)throw Object.assign(Error('operation_id_conflict'),{status:409});
            try{return respond(res,200,{ok:true,deduplicated:true,process:processes.view(previous.processId,owner)});}
            catch(error){if(error.message!=='process_not_found')throw error;throw Object.assign(Error('prior_operation_status_unknown'),{status:409});}
          }
        }
        if(dedupeKey&&dedupe.size>=1800){
          for(const [key,value] of dedupe){
            const row=processes.list().find(p=>p.processId===value.processId);
            if(!row||row.finishedAt){dedupe.delete(key);if(dedupe.size<=1500)break;}
          }
        }
        if(dedupeKey&&dedupe.size>=2048)throw Object.assign(Error('supervisor_dedupe_capacity_reached'),{status:429});
        // Write-ahead reservation BEFORE first possible external side effect.
        // On failure, preserve UNKNOWN evidence rather than auto-restarting.
        const reserved=journal?journal.reserve(owner,opId,fingerprint):null;
        const managedIsolated=Boolean(durable&&input.executionMode==='background');
        const proc=managedIsolated?
          await durable.launch({owner,processId:'lp_'+crypto.randomBytes(18).toString('base64url'),
            script,cwd,shell:input.shell,timeoutMs:input.timeoutMs}):
          processes.start({...owner,script,cwd,timeoutMs:input.timeoutMs,
            spawnSpec:value=>adapter.commandFor(value,{shell:input.shell}),
            env:{GPT_OPERATOR_ACCOUNT:owner.accountId,GPT_OPERATOR_DEVICE:owner.deviceId,GPT_OPERATOR_SESSION:owner.sessionId}});
        if(reserved)journal.attach(reserved.recordId,proc);
        if(dedupeKey)dedupe.set(dedupeKey,{fingerprint,processId:proc.processId});
        return respond(res,200,{ok:true,process:proc});
      }
      if(op==='list'){
        const live=processes.list(owner);
        const recovered=(await recoveredRows(owner)).filter(p=>!live.some(x=>x.processId===p.processId));
        return respond(res,200,{ok:true,processes:[...live,...recovered].slice(0,64)});
      }
      if(['output','stop','input'].includes(op)&&journal){
        const saved=journal.byProcess(input.processId,owner);
        if(saved?.backend==='isolated-user-unit'){
          if(!durable)throw Object.assign(Error('isolated_worker_backend_disabled'),{status:503});
          const record={...saved,owner};
          if(op==='output')return respond(res,200,{ok:true,data:await durable.output(record,{stream:input.stream,offset:input.offset,limit:input.limit})});
          if(op==='stop')return respond(res,200,{ok:true,process:await durable.stop(record,{force:input.force===true})});
          throw Object.assign(Error('isolated_background_stdin_unavailable'),{status:409});
        }
        const recovered=journal.byProcess(input.processId,owner);
        if(recovered&&!processes.list(owner).some(p=>p.processId===input.processId))
          throw Object.assign(Error(recovered.finishedAt?'process_output_unavailable_after_supervisor_restart':'prior_operation_status_unknown'),{status:409});
      }
      if(op==='output')return respond(res,200,{ok:true,data:processes.output(input.processId,owner,{stream:input.stream,offset:input.offset,limit:Math.min(262144,Number(input.limit)||262144)})});
      if(op==='stop')return respond(res,200,{ok:true,process:processes.stop(input.processId,owner,{force:input.force===true})});
      if(op==='input')return respond(res,200,{ok:true,process:processes.input(input.processId,owner,{data:input.data,eof:input.eof===true})});
    }catch(e){const status=errorStatus(e);return respond(res,status,{ok:false,error:String(e?.message||e).slice(0,180)});}
  });
  // Never unlink an active server socket. Remove a known stale socket only if
  // connect gets ECONNREFUSED (e.g. supervisor previously crashed).
  if(fs.existsSync(socketPath)){
    const st=fs.lstatSync(socketPath);
    if(!st.isSocket())throw Error('supervisor_socket_path_not_socket');
    const stale=await new Promise(resolve=>{
      const c=http.request({socketPath,path:'/v1/process',method:'POST',timeout:500});
      c.on('response',()=>resolve(false));c.on('error',e=>resolve(e.code==='ECONNREFUSED'));c.on('timeout',()=>{c.destroy();resolve(false);});c.end();
    });
    if(!stale)throw Error('supervisor_socket_already_live');
    fs.unlinkSync(socketPath);
  }
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolve();});});
  fs.chmodSync(socketPath,0o600);
  const shutdown=async()=>{
    processes.close();
    await new Promise(resolve=>server.close(resolve));
    try{fs.unlinkSync(socketPath);}catch{}
  };
  return {server,processes,shutdown,socketPath};
}
const main=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main){
  const socketPath=String(process.env.LIGHT_REMOTE_PROCESS_SUPERVISOR_SOCKET||'');
  const tokenFile=String(process.env.LIGHT_REMOTE_PROCESS_SUPERVISOR_TOKEN_FILE||'');
  const stateFile=String(process.env.OPERATOR_AGENT_STATE||'');
  const journalDir=String(process.env.LIGHT_REMOTE_PROCESS_SUPERVISOR_JOURNAL_DIR||'').trim()||null;
  const isolatedWorkers=process.env.LIGHT_REMOTE_PROCESS_SUPERVISOR_ISOLATED_WORKERS==='1';
  startProcessSupervisor({socketPath,tokenFile,stateFile,journalDir,isolatedWorkers}).then(runtime=>{
    console.log(JSON.stringify({event:'managed_supervisor_ready',pid:process.pid}));
    let shutting=false;const stop=()=>{if(shutting)return;shutting=true;void runtime.shutdown().then(()=>process.exit(0)).catch(()=>process.exit(1));};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
  }).catch(error=>{console.error(JSON.stringify({event:'managed_supervisor_start_failed',error:error.message}));process.exitCode=1;});
}
