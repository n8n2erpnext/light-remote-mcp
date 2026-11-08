// POSIX user-systemd workers: isolated unit/cgroup, durable bounded output,
// terminal receipt. Opt-in only, foreground/interactive processes remain native.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const requireDir=dir=>{
 const stat=fs.lstatSync(dir);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)||
  typeof process.getuid==='function'&&stat.uid!==process.getuid())throw Error('isolated_worker_private_dir_required');
};
const run=async(bin,args,{timeout=7500}={})=>new Promise((resolve,reject)=>{
 const child=spawn(bin,args,{stdio:['ignore','pipe','pipe'],env:{
   ...process.env,XDG_RUNTIME_DIR:'/run/user/'+process.getuid(),
   DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/'+process.getuid()+'/bus'}});
 const out=[],err=[];let total=0,complete=false;
 const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
 child.on('error',reject);
 child.stdout.on('data',x=>{total+=x.length;if(total<=131072)out.push(x);});
 child.stderr.on('data',x=>{total+=x.length;if(total<=131072)err.push(x);});
 child.on('exit',code=>{if(complete)return;complete=true;clearTimeout(timer);
   resolve({code,stdout:Buffer.concat(out).toString(),stderr:Buffer.concat(err).toString()});});
});
const writeJson=(file,data)=>{
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
};
const safeId=x=>/^lp_[A-Za-z0-9_-]{20,80}$/.test(String(x||''));
const knownStatus=new Set(['starting','running','stopping','stopped','finished','error','timeout']);
export class IsolatedWorkerManager {
 constructor({dir,workerScript=fileURLToPath(new URL('../device-agent/isolated-process-worker.mjs',import.meta.url))}={}){
  if(process.platform!=='linux'||typeof process.getuid!=='function')throw Error('isolated_workers_linux_only');
  if(!path.isAbsolute(String(dir||''))||!path.isAbsolute(workerScript))throw Error('isolated_worker_absolute_paths_required');
  if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:false,mode:0o700});
  requireDir(dir);
  this.dir=dir;this.workerScript=workerScript;
  this.uid=process.getuid();
  const userDir='/run/user/'+this.uid;
  requireDir(userDir);
  if(!fs.statSync(path.join(userDir,'bus')).isSocket())throw Error('isolated_worker_user_bus_unavailable');
 }
 directory(id){
  if(!safeId(id))throw Error('isolated_worker_invalid_process_id');
  return path.join(this.dir,id);
 }
 async unitState(unitName){
  if(!/^lr-m5w-[a-f0-9]{24}\.service$/.test(String(unitName||'')))throw Error('isolated_worker_invalid_unit');
  const res=await run('/usr/bin/systemctl',['--user','show',unitName,'-p','ActiveState','-p','MainPID','-p','ControlGroup','--no-pager']);
  if(res.code!==0)return {active:false,pid:null};
  const kv=Object.fromEntries(res.stdout.split(/\r?\n/).filter(Boolean).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
  const pid=Number(kv.MainPID),cg=String(kv.ControlGroup||'');
  const active=['active','activating'].includes(kv.ActiveState) && Number.isInteger(pid)&&pid>0 &&
    cg.includes('/'+unitName);
  // Never infer running from an unverified numeric PID alone.
  if(active){try{const procCg=fs.readFileSync('/proc/'+pid+'/cgroup','utf8');if(!procCg.includes(unitName))return {active:false,pid:null};}catch{return {active:false,pid:null};}}
  return {active,pid:active?pid:null,unitName,cgroup:cg,activeState:kv.ActiveState};
 }
 async launch({owner,processId,script,cwd,shell=null,timeoutMs=3600000}){
  const dir=this.directory(processId);
  fs.mkdirSync(dir,{mode:0o700});requireDir(dir);
  const unitName='lr-m5w-'+crypto.randomBytes(12).toString('hex')+'.service';
  const reqFile=path.join(dir,'request.json');
  writeJson(reqFile,{owner,processId,script,cwd,shell,timeoutMs,unitName});
  const duration=Math.max(20,Math.min(86410,Math.ceil((Number(timeoutMs)||3600000)/1000)+10));
  const args=['--user','--unit='+unitName,'--collect',
   '--property=NoNewPrivileges=yes','--property=KillMode=control-group',
   '--property=TimeoutStopSec=5s','--property=RuntimeMaxSec='+duration+'s',
   process.execPath,this.workerScript,reqFile];
  let result;
  try{result=await run('/usr/bin/systemd-run',args,{timeout:15000});}
  catch(error){try{fs.unlinkSync(reqFile);}catch{}throw Error('isolated_worker_admission_unverified:'+String(error?.code||'FAILED').slice(0,40));}
  if(result.code!==0){
    try{fs.unlinkSync(reqFile);}catch{}
    throw Error('isolated_worker_admission_failed:'+String(result.stderr).slice(0,180));
  }
  // If service starts slowly the status file may be absent. Still retain unit
  // identity in durable owner journal; follow-up uses systemd for proof.
  return {processId,unitName,pid:null,state:'starting',backend:'isolated-user-unit',startedAt:Date.now(),
   finishedAt:null,exitCode:null,stdoutBytes:0,stderrBytes:0};
 }
 readStatus(processId){
  const dir=this.directory(processId);
  requireDir(dir);
  const file=path.join(dir,'status.json');
  try{
   const st=fs.lstatSync(file);
   if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)||st.uid!==this.uid)throw Error('isolated_worker_status_insecure');
   const j=JSON.parse(fs.readFileSync(file,'utf8'));
   if(j.processId!==processId||!knownStatus.has(j.state))throw Error('isolated_worker_status_invalid');
   return j;
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
 }
 async view(record){
  const {processId}=record;if(!safeId(processId))throw Error('isolated_worker_record_without_process');
  const info=this.readStatus(processId);
  const unit=await this.unitState(record.unitName);
  let state='unknown',reason='isolated_worker_liveness_unproven';
  const done=info&&['finished','stopped','timeout','error'].includes(info.state)&&info.finishedAt;
  if(done){state=info.state;reason=null;}
  else if(unit.active){state=info?.state==='stopping'?'stopping':info?.state==='starting'?'starting':'running';reason=null;}
  const total={...info,processId,state,unitName:record.unitName,backend:'isolated-user-unit',
    pid:unit.pid||info?.pid||null,exitCode:done?info.exitCode:null,
    finishedAt:done?info.finishedAt:null,unknownReason:reason,
    resultOrigin:done?'isolated_worker_receipt':'isolated_user_unit',
    outputAvailable:Boolean(info&&fs.existsSync(path.join(this.directory(processId),'stdout.bin')))};
  return total;
 }
 async output(record,{stream='stdout',offset=0,limit=262144}={}){
  const view=await this.view(record);
  if(view.state==='unknown')throw Object.assign(Error('isolated_worker_status_unknown'),{status:409});
  const key=stream==='stderr'?'stderr':'stdout';
  const file=path.join(this.directory(record.processId),key+'.bin');
  let buffer=Buffer.alloc(0);
  try{buffer=fs.readFileSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  const start=Math.min(buffer.length,Math.max(0,Number(offset)||0)),count=Math.max(1,Math.min(Number(limit)||262144,262144));
  const sub=buffer.subarray(start,start+count);
  const total=Number(view[key+'Bytes']||0);
  return {...view,stream:key,output:{offset:start,returnedBytes:sub.length,nextOffset:start+sub.length,
   totalBytes:total,baseOffset:0,truncatedBefore:false,truncatedAfter:total>buffer.length,
   hasMore:start+sub.length<buffer.length,text:sub.toString('utf8')}};
 }
 async stop(record,{force=false}={}){
  const before=await this.view(record);
  if(['finished','stopped','timeout','error'].includes(before.state))return before;
  if(before.state==='unknown')throw Object.assign(Error('isolated_worker_status_unknown'),{status:409});
  const args=force?['--user','kill','--signal=SIGKILL',record.unitName]:['--user','stop',record.unitName];
  const r=await run('/usr/bin/systemctl',args,{timeout:8500});
  if(r.code!==0)throw Object.assign(Error('isolated_worker_stop_failed'),{status:409});
  return this.view(record);
 }
}
