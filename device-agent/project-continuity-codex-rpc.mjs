/* Optional Codex app-server client. Read-only proposals only.
 * No automatic approval of any command/network/file-change request.
 * No Codex secrets stored in Project Memory. */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_LINE=1024*1024;
function ensure(ok,code){if(!ok)throw Error(code);}
export function validateSupervisorProposal(snapshot,input){
 ensure(snapshot?.project&&Array.isArray(snapshot.tasks),'continuity_codex_snapshot_missing');
 ensure(input&&typeof input==='object'&&!Array.isArray(input),'continuity_codex_proposal_invalid');
 const recommendation=input.recommendation;
 ensure(['CONTINUE','WAIT_OWNER','CONTINUE_SECTION_B','DONE'].includes(recommendation),'continuity_codex_recommendation_invalid');
 ensure(input.projectId===snapshot.project.id,'continuity_codex_project_mismatch');
 ensure(typeof input.reason==='string'&&input.reason.length>=3&&input.reason.length<=2048,'continuity_codex_reason_invalid');
 const all=snapshot.tasks.flatMap(t=>t.sections);
 const sectionIds=Array.isArray(input.sectionIds)?input.sectionIds:[];
 ensure(sectionIds.length<=64&&new Set(sectionIds).size===sectionIds.length,'continuity_codex_section_set_invalid');
 for(const id of sectionIds)ensure(all.some(s=>s.id===id),'continuity_codex_section_not_found');
 if(recommendation==='WAIT_OWNER')ensure(snapshot.pendingApprovals.length>0,'continuity_codex_wait_without_owner');
 if(recommendation==='DONE')ensure(all.length>0&&all.every(s=>s.state==='DONE')&&snapshot.pendingApprovals.length===0,'continuity_codex_done_unverified');
 if(['CONTINUE','CONTINUE_SECTION_B'].includes(recommendation)){
  ensure(sectionIds.length>0,'continuity_codex_continue_empty');
  for(const id of sectionIds){
   const section=all.find(s=>s.id===id);
   ensure(section.state==='READY','continuity_codex_section_not_ready');
   ensure(section.dependsOn.every(dep=>all.some(s=>s.id===dep&&s.state==='DONE')),'continuity_codex_dependency_unfinished');
  }
 }
 return {status:'PROPOSED',projectId:input.projectId,sectionIds,recommendation,reason:input.reason,
  evidenceRefs:Array.isArray(input.evidenceRefs)?input.evidenceRefs.filter(v=>typeof v==='string').slice(0,12):[],
  authorized:false,executionAllowed:false,webTurnContinuation:'NOT_SUPPORTED_BY_THIS_BRIDGE'};
}
export class CodexAppServerClient {
 constructor({cwd,binary='codex',args=['app-server','--listen','stdio://'],timeoutMs=45000,env={},spawnFn=spawn}={}){
  ensure(typeof cwd==='string'&&path.isAbsolute(cwd)&&fs.existsSync(cwd)&&fs.statSync(cwd).isDirectory(),'continuity_codex_cwd_required');
  ensure(Number.isInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=300000,'continuity_codex_timeout_invalid');
  this.cwd=cwd;this.timeoutMs=timeoutMs;this.nextId=0;this.buffer='';this.pending=new Map();this.listeners=new Set();this.closed=false;
  this.process=spawnFn(binary,args,{cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe'],windowsHide:true});
  this.process.stdout.on('data',chunk=>this.receive(chunk));
  let stderrSize=0;
  this.process.stderr.on('data',chunk=>{stderrSize+=chunk.length;if(stderrSize>MAX_LINE)this.process.kill();});
  this.process.on('error',()=>this.rejectAll(Error('continuity_codex_spawn_failed')));
  this.process.on('exit',()=>this.rejectAll(Error('continuity_codex_exited')));
 }
 rejectAll(error){
  if(this.closed)return;this.closed=true;
  for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}
  this.pending.clear();
  for(const listener of this.listeners)listener({method:'continuity/exited'});
 }
 receive(chunk){
  this.buffer+=chunk.toString('utf8');
  if(Buffer.byteLength(this.buffer)>MAX_LINE){this.rejectAll(Error('continuity_codex_rpc_oversize'));this.process.kill();return;}
  let pos;
  while((pos=this.buffer.indexOf('\n'))>=0){
   const line=this.buffer.slice(0,pos);this.buffer=this.buffer.slice(pos+1);
   if(!line.trim())continue;
   let value;try{value=JSON.parse(line);}catch{this.rejectAll(Error('continuity_codex_rpc_invalid'));this.process.kill();return;}
   if(value.method&&value.id!==undefined){
    this.process.stdin.write(JSON.stringify({id:value.id,result:{decision:'decline'}})+'\n');
   }else if(value.id!==undefined){
    const p=this.pending.get(value.id);if(!p)continue;
    this.pending.delete(value.id);clearTimeout(p.timer);
    if(value.error)p.reject(Error('continuity_codex_rpc_error'));else p.resolve(value.result);
   }else if(typeof value.method==='string'){
    for(const listener of this.listeners)listener(value);
   }
  }
 }
 request(method,params={}){
  ensure(!this.closed,'continuity_codex_exited');
  const id=++this.nextId;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('continuity_codex_rpc_timeout'));},this.timeoutMs);
   this.pending.set(id,{resolve,reject,timer});
   this.process.stdin.write(JSON.stringify({id,method,params})+'\n',err=>{
    if(err){clearTimeout(timer);this.pending.delete(id);reject(Error('continuity_codex_write_failed'));}
   });
  });
 }
 async initialize(){
  await this.request('initialize',{clientInfo:{name:'light_remote_project_continuity',title:'Light Remote Project Continuity',version:'0.1.0'}});
  this.process.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 }
 async startSupervisorThread(){
  const result=await this.request('thread/start',{cwd:this.cwd,approvalPolicy:'on-request',sandbox:'read-only',ephemeral:false});
  ensure(typeof result?.thread?.id==='string','continuity_codex_no_thread_id');
  return result.thread.id;
 }
 async resumeSupervisorThread(threadId){
  ensure(typeof threadId==='string'&&threadId.length<=256,'continuity_codex_invalid_thread');
  const resumed=await this.request('thread/resume',{threadId});
  ensure(resumed?.thread?.id===threadId,'continuity_codex_resume_mismatch');
  return resumed.thread.id;
 }
 async supervise({threadId,snapshot,maxChars=8000}){
  ensure(typeof threadId==='string'&&threadId.length<=256,'continuity_codex_invalid_thread');
  ensure(snapshot?.project,'continuity_codex_snapshot_missing');
  ensure(Number.isInteger(maxChars)&&maxChars>=1024&&maxChars<=16000,'continuity_codex_context_limit');
  const prompt='You are a READ-ONLY observer and coordinator for a ChatGPT Web work plan. Never execute, edit, approve, dispatch any worker, or use external tools. Return exactly one JSON object with projectId, sectionIds, recommendation, reason, evidenceRefs. Allowed recommendations: CONTINUE, WAIT_OWNER, CONTINUE_SECTION_B, DONE. Base conclusions on state and evidence; do not invent receipts. Project snapshot:\n'+JSON.stringify(snapshot).slice(0,maxChars);
  let reply='',finished=false,finish,fail;
  const done=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
  const timer=setTimeout(()=>{if(!finished){finished=true;fail(Error('continuity_codex_turn_timeout'));}},this.timeoutMs);
  const onEvent=ev=>{
   if(finished)return;
   if(ev.method==='item/agentMessage/delta'){
    reply+=String(ev.params?.delta||'');
    if(reply.length>64000){finished=true;fail(Error('continuity_codex_output_too_large'));}
   }else if(ev.method==='turn/completed'){
    finished=true;
    if(ev.params?.turn?.status==='completed')finish();else fail(Error('continuity_codex_turn_failed'));
   }else if(ev.method==='continuity/exited'){finished=true;fail(Error('continuity_codex_exited'));}
  };
  this.listeners.add(onEvent);
  try{
   const started=await this.request('turn/start',{threadId,input:[{type:'text',text:prompt}],approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly',access:{type:'restricted',includePlatformDefaults:true,readableRoots:[this.cwd]}}});
   ensure(started?.turn?.id,'continuity_codex_no_turn_id');
   await done;
   let parsed;
   try{parsed=JSON.parse(reply.trim());}catch{throw Error('continuity_codex_non_json_response');}
   return {threadId,turnId:started.turn.id,proposal:validateSupervisorProposal(snapshot,parsed)};
  }catch(error){
   // A timed-out/suspended Codex must not run invisibly after the Controller stops awaiting it.
   await this.close();throw error;
  }finally{clearTimeout(timer);this.listeners.delete(onEvent);}
 }
 async close(){
  if(this.closed)return;
  this.process.kill('SIGTERM');
  await new Promise(resolve=>{
   if(this.process.exitCode!==null)return resolve();
   const timeout=setTimeout(()=>{this.process.kill('SIGKILL');resolve();},1200);
   this.process.once('exit',()=>{clearTimeout(timeout);resolve();});
  });
 }
}
