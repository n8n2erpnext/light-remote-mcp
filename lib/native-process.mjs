import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export class NativeProcessError extends Error {
  constructor(message,status=400){super(message);this.name='NativeProcessError';this.status=status;}
}

const DEFAULT_BUFFER_BYTES=4*1024*1024;
const MAX_BUFFER_BYTES=16*1024*1024;
const MAX_INPUT_BYTES=1024*1024;
const FINISHED_TTL_MS=6*60*60*1000;

class ByteRing {
  constructor(limit=DEFAULT_BUFFER_BYTES){this.limit=Math.max(65536,Math.min(Number(limit)||DEFAULT_BUFFER_BYTES,MAX_BUFFER_BYTES));this.buffer=Buffer.alloc(0);this.baseOffset=0;this.totalBytes=0;}
  add(value){const chunk=Buffer.from(value);this.totalBytes+=chunk.length;this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>this.limit){const drop=this.buffer.length-this.limit;this.buffer=this.buffer.subarray(drop);this.baseOffset+=drop;}}
  read(offset=0,limit=262144){const requested=Math.max(0,Number(offset)||0),start=Math.max(requested,this.baseOffset),local=Math.max(0,start-this.baseOffset),max=Math.max(1,Math.min(Number(limit)||262144,1024*1024));const slice=this.buffer.subarray(local,local+max);return {offset:start,returnedBytes:slice.length,nextOffset:start+slice.length,totalBytes:this.totalBytes,baseOffset:this.baseOffset,truncatedBefore:requested<this.baseOffset,hasMore:start+slice.length<this.totalBytes,text:slice.toString('utf8')};}
}

const validHandle=value=>/^lp_[A-Za-z0-9_-]{20,80}$/.test(String(value||''));
const validOwner=value=>/^[A-Za-z0-9._:-]{1,180}$/.test(String(value||''));
export class NativeProcessRegistry {
  constructor({maxProcesses=16,bufferBytes=DEFAULT_BUFFER_BYTES,now=()=>Date.now(),emit=()=>{}}={}){
    this.maxProcesses=Math.max(1,Math.min(Number(maxProcesses)||16,64));this.bufferBytes=bufferBytes;this.now=now;this.emit=emit;this.rows=new Map();
  }
  _id(){return `lp_${crypto.randomBytes(18).toString('base64url')}`;}
  _owner(input){const accountId=String(input.accountId||''),deviceId=String(input.deviceId||''),sessionId=String(input.sessionId||''),agentId=String(input.agentId||'');if(![accountId,deviceId,sessionId,agentId].every(validOwner))throw new NativeProcessError('invalid_process_owner');return {accountId,deviceId,sessionId,agentId};}
  _row(processId,owner){if(!validHandle(processId))throw new NativeProcessError('invalid_process_id');const row=this.rows.get(String(processId));if(!row)throw new NativeProcessError('process_not_found',404);if(owner){for(const key of ['accountId','deviceId','sessionId','agentId'])if(String(owner[key]||'')!==row[key])throw new NativeProcessError('process_owner_mismatch',403);}return row;}
  prune(){const now=this.now();for(const [id,row] of this.rows)if(row.finishedAt&&now-row.finishedAt>FINISHED_TTL_MS)this.rows.delete(id);}
  start({accountId,deviceId,sessionId,agentId,script,cwd,env={},timeoutMs=0,spawnSpec}){
    this.prune();const owner=this._owner({accountId,deviceId,sessionId,agentId});const active=[...this.rows.values()].filter(x=>!x.finishedAt).length;if(active>=this.maxProcesses)throw new NativeProcessError('process_capacity_reached',429);
    if(typeof spawnSpec!=='function')throw new NativeProcessError('process_spawn_spec_required');const spec=spawnSpec(String(script||''));if(!spec?.file||!Array.isArray(spec.args))throw new NativeProcessError('invalid_process_spawn_spec');
    const processId=this._id(),startedAt=this.now(),stdout=new ByteRing(this.bufferBytes),stderr=new ByteRing(this.bufferBytes);
    const child=spawn(spec.file,spec.args,{cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
    const row={processId,...owner,script:String(script||''),cwd:String(cwd||''),pid:child.pid||null,state:'running',startedAt,firstOutputAt:null,finishedAt:null,exitCode:null,signal:null,timedOut:false,stdout,stderr,child,timer:null};
    this.rows.set(processId,row);this.emit({type:'process_started',...owner,processId,pid:row.pid,startedAt});
    const markOutput=(ring,data,stream)=>{if(!row.firstOutputAt)row.firstOutputAt=this.now();ring.add(data);this.emit({type:'process_output',...owner,processId,stream,bytes:Buffer.byteLength(data),at:this.now()});};
    child.stdout.on('data',data=>markOutput(stdout,data,'stdout'));child.stderr.on('data',data=>markOutput(stderr,data,'stderr'));
    const finish=(code,signal)=>{if(row.finishedAt)return;row.finishedAt=this.now();row.exitCode=Number.isInteger(code)?code:null;row.signal=signal||null;row.state=row.timedOut?'timeout':row.exitCode===0?'finished':'error';if(row.timer)clearTimeout(row.timer);this.emit({type:'process_finished',...owner,processId,state:row.state,exitCode:row.exitCode,signal:row.signal,durationMs:row.finishedAt-row.startedAt});};
    child.on('error',error=>{stderr.add(`${error.message}\n`);finish(127,null);});child.on('exit',finish);
    const timeout=Math.max(0,Math.min(Number(timeoutMs)||0,24*60*60*1000));if(timeout){row.timer=setTimeout(()=>{if(row.finishedAt)return;row.timedOut=true;try{child.kill('SIGTERM');}catch{}setTimeout(()=>{if(!row.finishedAt)try{child.kill('SIGKILL');}catch{}},5000).unref();},timeout);row.timer.unref();}
    return this.view(processId,owner);
  }
  input(processId,owner,{data='',eof=false}={}){const row=this._row(processId,owner);if(row.finishedAt)throw new NativeProcessError('process_not_running',409);const buf=Buffer.from(String(data));if(buf.length>MAX_INPUT_BYTES)throw new NativeProcessError('process_input_too_large',413);if(buf.length)row.child.stdin.write(buf);if(eof)row.child.stdin.end();this.emit({type:'process_input',...owner,processId,bytes:buf.length,eof:Boolean(eof)});return this.view(processId,owner);}
  output(processId,owner,{stream='stdout',offset=0,limit=262144}={}){const row=this._row(processId,owner),selected=stream==='stderr'?row.stderr:row.stdout;return {...this.view(processId,owner),stream:stream==='stderr'?'stderr':'stdout',output:selected.read(offset,limit)};}
  stop(processId,owner,{force=false}={}){const row=this._row(processId,owner);if(row.finishedAt)return this.view(processId,owner);try{row.child.kill(force?'SIGKILL':'SIGTERM');}catch(error){throw new NativeProcessError(`process_stop_failed:${error.message}`,409);}this.emit({type:'process_stop_requested',...owner,processId,force:Boolean(force)});return this.view(processId,owner);}
  view(processId,owner=null){const row=this._row(processId,owner);return {processId:row.processId,accountId:row.accountId,deviceId:row.deviceId,sessionId:row.sessionId,agentId:row.agentId,pid:row.pid,state:row.state,startedAt:row.startedAt,firstOutputAt:row.firstOutputAt,finishedAt:row.finishedAt,exitCode:row.exitCode,signal:row.signal,timedOut:row.timedOut,cwd:row.cwd,stdoutBytes:row.stdout.totalBytes,stderrBytes:row.stderr.totalBytes};}
  list(owner){this.prune();return [...this.rows.values()].filter(row=>!owner||['accountId','deviceId','sessionId','agentId'].every(key=>String(owner[key]||'')===row[key])).map(row=>this.view(row.processId,owner));}
}
