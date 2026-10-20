import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

export class NativeProcessError extends Error {
  constructor(message,status=400){super(message);this.name='NativeProcessError';this.status=status;}
}

const DEFAULT_BUFFER_BYTES=4*1024*1024;
const MAX_BUFFER_BYTES=16*1024*1024;
const MAX_INPUT_BYTES=1024*1024;
const FINISHED_TTL_MS=6*60*60*1000;
const DEFAULT_STOP_GRACE_MS=750;

class ByteRing {
  constructor(limit=DEFAULT_BUFFER_BYTES){this.limit=Math.max(65536,Math.min(Number(limit)||DEFAULT_BUFFER_BYTES,MAX_BUFFER_BYTES));this.buffer=Buffer.alloc(0);this.baseOffset=0;this.totalBytes=0;}
  add(value){const chunk=Buffer.from(value);this.totalBytes+=chunk.length;this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>this.limit){const drop=this.buffer.length-this.limit;this.buffer=this.buffer.subarray(drop);this.baseOffset+=drop;}}
  read(offset=0,limit=262144){const requested=Math.max(0,Number(offset)||0),start=Math.max(requested,this.baseOffset),local=Math.max(0,start-this.baseOffset),max=Math.max(1,Math.min(Number(limit)||262144,1024*1024));const slice=this.buffer.subarray(local,local+max);return {offset:start,returnedBytes:slice.length,nextOffset:start+slice.length,totalBytes:this.totalBytes,baseOffset:this.baseOffset,truncatedBefore:requested<this.baseOffset,hasMore:start+slice.length<this.totalBytes,text:slice.toString('utf8')};}
}

const validHandle=value=>/^lp_[A-Za-z0-9_-]{20,80}$/.test(String(value||''));
const validOwner=value=>/^[A-Za-z0-9._:-]{1,180}$/.test(String(value||''));
export class NativeProcessRegistry {
  constructor({maxProcesses=16,bufferBytes=DEFAULT_BUFFER_BYTES,now=()=>Date.now(),emit=()=>{},stopGraceMs=DEFAULT_STOP_GRACE_MS}={}){
    this.maxProcesses=Math.max(1,Math.min(Number(maxProcesses)||16,64));this.bufferBytes=bufferBytes;this.now=now;this.emit=emit;this.stopGraceMs=Math.max(50,Math.min(Number(stopGraceMs)||DEFAULT_STOP_GRACE_MS,5000));this.rows=new Map();
  }
  _id(){return `lp_${crypto.randomBytes(18).toString('base64url')}`;}
  // POSIX children receive their own process group so stop/timeout signals can
  // reach shells and their descendants. Windows preserves legacy child.kill.
  _signal(row,signal){
    if(process.platform==='win32'&&Number.isInteger(row.pid)&&row.pid>0){
      // Node's child.kill() only terminates its direct child on Windows. Use
      // the OS tool to terminate the *owned* PID and its descendants before
      // the parent exits, otherwise its detached children become orphaned.
      const tool=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe');
      const result=spawnSync(tool,['/PID',String(row.pid),'/T','/F'],{windowsHide:true,timeout:3000,stdio:'ignore'});
      if(!result.error&&result.status===0){row.treeStopMethod='taskkill-tree';row.stopForce=true;return true;}
      row.treeStopMethod='direct-fallback';
      this.emit({type:'process_tree_stop_fallback',accountId:row.accountId,deviceId:row.deviceId,sessionId:row.sessionId,agentId:row.agentId,processId:row.processId,code:result.error?.code||'TASKKILL_FAILED',at:this.now()});
      return row.child.kill(signal);
    }
    if(row.processGroupId){try{process.kill(-row.processGroupId,signal);return true;}catch(error){if(error?.code!=='ESRCH')throw error;}}return row.child.kill(signal);
  }
  _owner(input){const accountId=String(input.accountId||''),deviceId=String(input.deviceId||''),sessionId=String(input.sessionId||''),agentId=String(input.agentId||'');if(![accountId,deviceId,sessionId,agentId].every(validOwner))throw new NativeProcessError('invalid_process_owner');return {accountId,deviceId,sessionId,agentId};}
  _row(processId,owner){if(!validHandle(processId))throw new NativeProcessError('invalid_process_id');const row=this.rows.get(String(processId));if(!row)throw new NativeProcessError('process_not_found',404);if(owner){for(const key of ['accountId','deviceId','sessionId','agentId'])if(String(owner[key]||'')!==row[key])throw new NativeProcessError('process_owner_mismatch',403);}return row;}
  prune(){const now=this.now();for(const [id,row] of this.rows)if(row.finishedAt&&now-row.finishedAt>FINISHED_TTL_MS)this.rows.delete(id);}
  start({accountId,deviceId,sessionId,agentId,script,cwd,env={},timeoutMs=0,spawnSpec}){
    this.prune();const owner=this._owner({accountId,deviceId,sessionId,agentId});const active=[...this.rows.values()].filter(x=>!x.finishedAt).length;if(active>=this.maxProcesses)throw new NativeProcessError('process_capacity_reached',429);
    if(typeof spawnSpec!=='function')throw new NativeProcessError('process_spawn_spec_required');const spec=spawnSpec(String(script||''));if(!spec?.file||!Array.isArray(spec.args))throw new NativeProcessError('invalid_process_spawn_spec');
    const processId=this._id(),startedAt=this.now(),stdout=new ByteRing(this.bufferBytes),stderr=new ByteRing(this.bufferBytes);
    const grouped=process.platform!=='win32';
    // Gold Windows native host publishes a trusted in-package Job Object helper.
    // It launches the approved script suspended, binds it to a per-process job,
    // and closes the job when the parent naturally exits (killing descendants).
    const helper=process.platform==='win32'?String(process.env.LIGHT_REMOTE_MANAGED_PROCESS_HELPER||'').trim():'';
    if(helper&&!path.win32.isAbsolute(helper))throw new NativeProcessError('windows_process_helper_not_absolute');
    const wrapped=Boolean(helper);
    const child=spawn(wrapped?helper:spec.file,wrapped?['--managed-process',spec.file,...spec.args]:spec.args,{cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe'],detached:grouped,windowsHide:true});
    const row={processId,...owner,script:String(script||''),cwd:String(cwd||''),pid:child.pid||null,processGroupId:grouped&&Number.isInteger(child.pid)&&child.pid>0?child.pid:null,state:'running',startedAt,firstOutputAt:null,finishedAt:null,exitCode:null,signal:null,timedOut:false,stopRequested:false,stopForce:false,treeStopMethod:null,groupCleanup:null,treeContainment:wrapped?'job-object-kill-on-close':grouped?'posix-process-group':'none',stdinState:'open',stdinErrorCode:null,stdout,stderr,child,timer:null,stopTimer:null};
    this.rows.set(processId,row);this.emit({type:'process_started',...owner,processId,pid:row.pid,startedAt});
    const markOutput=(ring,data,stream)=>{if(!row.firstOutputAt)row.firstOutputAt=this.now();ring.add(data);this.emit({type:'process_output',...owner,processId,stream,bytes:Buffer.byteLength(data),at:this.now()});};
    child.stdout.on('data',data=>markOutput(stdout,data,'stdout'));child.stderr.on('data',data=>markOutput(stderr,data,'stderr'));
    // stdin failures are asynchronous on Node pipes (e.g. EPIPE after a child
    // closes fd 0). An unhandled stdin error otherwise terminates the Agent.
    child.stdin.on('error',error=>{row.stdinState='error';row.stdinErrorCode=['EPIPE','ERR_STREAM_DESTROYED'].includes(error?.code)?error.code:'STDIN_ERROR';this.emit({type:'process_stdin_error',...owner,processId,code:row.stdinErrorCode,at:this.now()});});
    child.stdin.on('close',()=>{if(row.stdinState!=='error')row.stdinState='closed';});
    const finish=(code,signal)=>{if(row.finishedAt)return;
      // A managed POSIX shell may exit 0 while background descendants remain
      // in its dedicated process group. The group is owned by this job only;
      // reap it immediately rather than letting a successful parent create
      // unmanaged children that survive a remote job's logical completion.
      if(row.processGroupId){
        try{process.kill(-row.processGroupId,'SIGKILL');row.groupCleanup='sent';}
        catch(error){row.groupCleanup=error?.code==='ESRCH'?'empty':'failed';if(error?.code!=='ESRCH')this.emit({type:'process_group_cleanup_failed',...owner,processId,code:String(error?.code||'UNKNOWN').slice(0,30),at:this.now()});}
      }
      row.finishedAt=this.now();row.exitCode=Number.isInteger(code)?code:null;row.signal=signal||null;row.state=row.timedOut?'timeout':row.stopRequested?'stopped':row.exitCode===0?'finished':'error';if(row.timer)clearTimeout(row.timer);if(row.stopTimer&&!row.processGroupId){clearTimeout(row.stopTimer);row.stopTimer=null;}this.emit({type:'process_finished',...owner,processId,state:row.state,exitCode:row.exitCode,signal:row.signal,durationMs:row.finishedAt-row.startedAt});};
    child.on('error',error=>{stderr.add(`${error.message}\n`);finish(127,null);});child.on('exit',finish);
    const timeout=Math.max(0,Math.min(Number(timeoutMs)||0,24*60*60*1000));if(timeout){row.timer=setTimeout(()=>{if(row.finishedAt)return;row.timedOut=true;try{this._signal(row,'SIGTERM');}catch{}setTimeout(()=>{if(!row.finishedAt||row.processGroupId)try{this._signal(row,'SIGKILL');}catch{}},5000).unref();},timeout);row.timer.unref();}
    return this.view(processId,owner);
  }
  input(processId,owner,{data='',eof=false}={}){const row=this._row(processId,owner);if(row.finishedAt)throw new NativeProcessError('process_not_running',409);const buf=Buffer.from(String(data));if(buf.length>MAX_INPUT_BYTES)throw new NativeProcessError('process_input_too_large',413);if(row.stdinState!=='open'||row.child.stdin.destroyed||row.child.stdin.writableEnded)throw new NativeProcessError('process_stdin_unavailable',409);try{if(buf.length)row.child.stdin.write(buf);if(eof){row.stdinState='closing';row.child.stdin.end();}}catch(error){row.stdinState='error';row.stdinErrorCode=['EPIPE','ERR_STREAM_DESTROYED'].includes(error?.code)?error.code:'STDIN_ERROR';throw new NativeProcessError('process_stdin_unavailable',409);}this.emit({type:'process_input',...owner,processId,bytes:buf.length,eof:Boolean(eof)});return this.view(processId,owner);}
  output(processId,owner,{stream='stdout',offset=0,limit=262144}={}){const row=this._row(processId,owner),selected=stream==='stderr'?row.stderr:row.stdout;return {...this.view(processId,owner),stream:stream==='stderr'?'stderr':'stdout',output:selected.read(offset,limit)};}
  stop(processId,owner,{force=false}={}){const row=this._row(processId,owner);if(row.finishedAt)return this.view(processId,owner);const requestedForce=Boolean(force);if(row.stopRequested&&!requestedForce)return this.view(processId,owner);try{this._signal(row,requestedForce?'SIGKILL':'SIGTERM');}catch(error){throw new NativeProcessError(`process_stop_failed:${error.message}`,409);}row.stopRequested=true;row.stopForce ||= requestedForce||row.treeStopMethod==='taskkill-tree';row.state='stopping';if(row.stopTimer){clearTimeout(row.stopTimer);row.stopTimer=null;}if(!requestedForce&&row.treeStopMethod!=='taskkill-tree'){row.stopTimer=setTimeout(()=>{row.stopTimer=null;if(row.finishedAt&&!row.processGroupId)return;row.stopForce=true;try{this._signal(row,'SIGKILL');}catch{}this.emit({type:'process_stop_escalated',...owner,processId,signal:'SIGKILL',at:this.now()});},this.stopGraceMs);row.stopTimer.unref?.();}this.emit({type:'process_stop_requested',...owner,processId,force:requestedForce});return this.view(processId,owner);}
  // Runtime shutdown only; session hold deliberately retains managed jobs.
  close(){for(const row of this.rows.values()){if(row.timer)clearTimeout(row.timer);if(row.stopTimer)clearTimeout(row.stopTimer);row.timer=null;row.stopTimer=null;if(row.finishedAt&&!(row.processGroupId&&row.stopRequested))continue;row.stopRequested=true;row.stopForce=true;if(!row.finishedAt)row.state='stopping';try{this._signal(row,'SIGKILL');}catch{}this.emit({type:'process_shutdown_stop_requested',processId:row.processId,sessionId:row.sessionId,at:this.now()});}}
  view(processId,owner=null){const row=this._row(processId,owner);return {processId:row.processId,accountId:row.accountId,deviceId:row.deviceId,sessionId:row.sessionId,agentId:row.agentId,pid:row.pid,processGroupId:row.processGroupId,state:row.state,startedAt:row.startedAt,firstOutputAt:row.firstOutputAt,finishedAt:row.finishedAt,exitCode:row.exitCode,signal:row.signal,timedOut:row.timedOut,stopRequested:row.stopRequested,stopForce:row.stopForce,treeStopMethod:row.treeStopMethod,groupCleanup:row.groupCleanup,treeContainment:row.treeContainment,stdinState:row.stdinState,stdinErrorCode:row.stdinErrorCode,cwd:row.cwd,stdoutBytes:row.stdout.totalBytes,stderrBytes:row.stderr.totalBytes};}
  list(owner){this.prune();return [...this.rows.values()].filter(row=>!owner||['accountId','deviceId','sessionId','agentId'].every(key=>String(owner[key]||'')===row[key])).map(row=>this.view(row.processId,owner));}
}
