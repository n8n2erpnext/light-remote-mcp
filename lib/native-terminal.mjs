import crypto from 'node:crypto';
import { createRequire } from 'node:module';

export class NativeTerminalError extends Error {
  constructor(message,status=400){super(message);this.name='NativeTerminalError';this.status=status;}
}

const require=createRequire(import.meta.url);
const DEFAULT_BUFFER_BYTES=4*1024*1024,MAX_BUFFER_BYTES=16*1024*1024,MAX_INPUT_BYTES=1024*1024;
const FINISHED_TTL_MS=6*60*60*1000,DEFAULT_IDLE_TTL_MS=30*60*1000,DEFAULT_HARD_TTL_MS=4*60*60*1000;

class ByteRing {
  constructor(limit=DEFAULT_BUFFER_BYTES){this.limit=Math.max(65536,Math.min(Number(limit)||DEFAULT_BUFFER_BYTES,MAX_BUFFER_BYTES));this.buffer=Buffer.alloc(0);this.baseOffset=0;this.totalBytes=0;}
  add(value){const chunk=Buffer.from(String(value));this.totalBytes+=chunk.length;this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>this.limit){const drop=this.buffer.length-this.limit;this.buffer=this.buffer.subarray(drop);this.baseOffset+=drop;}}
  read(offset=0,limit=262144){const requested=Math.max(0,Number(offset)||0),start=Math.max(requested,this.baseOffset),local=Math.max(0,start-this.baseOffset),max=Math.max(1,Math.min(Number(limit)||262144,1024*1024)),slice=this.buffer.subarray(local,local+max);return {offset:start,returnedBytes:slice.length,nextOffset:start+slice.length,totalBytes:this.totalBytes,baseOffset:this.baseOffset,truncatedBefore:requested<this.baseOffset,hasMore:start+slice.length<this.totalBytes,text:slice.toString('utf8')};}
}

function defaultPtyProvider(platform=process.platform){
  if(platform==='linux')return require('@homebridge/node-pty-prebuilt-multiarch');
  return require('node-pty');
}
const validHandle=value=>/^ltm_[A-Za-z0-9_-]{20,80}$/.test(String(value||''));
const validOwner=value=>/^[A-Za-z0-9._:-]{1,180}$/.test(String(value||''));
const clampSize=(value,min,max,fallback)=>Math.max(min,Math.min(Number(value)||fallback,max));

export class NativeTerminalRegistry {
  constructor({maxTerminals=8,bufferBytes=DEFAULT_BUFFER_BYTES,now=()=>Date.now(),emit=()=>{},platform=process.platform,ptyProvider=null,idleTtlMs=DEFAULT_IDLE_TTL_MS,hardTtlMs=DEFAULT_HARD_TTL_MS}={}){
    this.maxTerminals=Math.max(1,Math.min(Number(maxTerminals)||8,32));this.bufferBytes=bufferBytes;this.now=now;this.emit=emit;this.platform=platform;this.ptyProvider=ptyProvider;this.idleTtlMs=Math.max(60000,Number(idleTtlMs)||DEFAULT_IDLE_TTL_MS);this.hardTtlMs=Math.max(this.idleTtlMs,Number(hardTtlMs)||DEFAULT_HARD_TTL_MS);this.rows=new Map();
    this.timer=setInterval(()=>this.prune(),60000);this.timer.unref?.();
  }
  _id(){return `ltm_${crypto.randomBytes(18).toString('base64url')}`;}
  _owner(input){const accountId=String(input.accountId||''),deviceId=String(input.deviceId||''),sessionId=String(input.sessionId||''),agentId=String(input.agentId||'');if(![accountId,deviceId,sessionId,agentId].every(validOwner))throw new NativeTerminalError('invalid_terminal_owner');return {accountId,deviceId,sessionId,agentId};}
  _row(terminalId,owner){if(!validHandle(terminalId))throw new NativeTerminalError('invalid_terminal_id');const row=this.rows.get(String(terminalId));if(!row)throw new NativeTerminalError('terminal_not_found',404);if(owner){for(const key of ['accountId','deviceId','sessionId','agentId'])if(String(owner[key]||'')!==row[key])throw new NativeTerminalError('terminal_owner_mismatch',403);}return row;}
  _provider(){if(!this.ptyProvider)this.ptyProvider=defaultPtyProvider(this.platform);if(typeof this.ptyProvider?.spawn!=='function')throw new NativeTerminalError('terminal_backend_unavailable',503);return this.ptyProvider;}
  prune(){const now=this.now();for(const [id,row] of this.rows){if(row.finishedAt&&now-row.finishedAt>FINISHED_TTL_MS){this.rows.delete(id);continue;}if(!row.finishedAt&&(now-row.startedAt>this.hardTtlMs||now-row.lastActivityAt>this.idleTtlMs)){try{row.pty.kill();}catch{}row.state='expired';}}}
  start({accountId,deviceId,sessionId,agentId,shellSpec,cwd,env={},cols=120,rows=32,term='xterm-256color'}){
    this.prune();const owner=this._owner({accountId,deviceId,sessionId,agentId}),active=[...this.rows.values()].filter(x=>!x.finishedAt).length;if(active>=this.maxTerminals)throw new NativeTerminalError('terminal_capacity_reached',429);
    if(!shellSpec?.file||!Array.isArray(shellSpec.args))throw new NativeTerminalError('invalid_terminal_shell_spec');
    const terminalId=this._id(),startedAt=this.now(),output=new ByteRing(this.bufferBytes),pty=this._provider().spawn(shellSpec.file,shellSpec.args,{name:String(term||'xterm-256color'),cols:clampSize(cols,20,500,120),rows:clampSize(rows,5,200,32),cwd,env:{...process.env,...env}});
    const row={terminalId,...owner,shell:String(shellSpec.shell||shellSpec.file),cwd:String(cwd||''),pid:pty.pid||null,state:'running',startedAt,lastActivityAt:startedAt,firstOutputAt:null,finishedAt:null,exitCode:null,signal:null,cols:clampSize(cols,20,500,120),rows:clampSize(rows,5,200,32),output,pty};
    this.rows.set(terminalId,row);this.emit({type:'terminal_started',...owner,terminalId,pid:row.pid,shell:row.shell,cols:row.cols,rows:row.rows,startedAt});
    pty.onData(data=>{if(!row.firstOutputAt)row.firstOutputAt=this.now();row.lastActivityAt=this.now();output.add(data);this.emit({type:'terminal_output',...owner,terminalId,bytes:Buffer.byteLength(String(data)),at:this.now()});});
    pty.onExit(event=>{if(row.finishedAt)return;row.finishedAt=this.now();row.lastActivityAt=row.finishedAt;row.exitCode=Number.isInteger(event?.exitCode)?event.exitCode:null;row.signal=event?.signal==null?null:String(event.signal);row.state=row.state==='expired'?'expired':row.exitCode===0?'finished':'error';this.emit({type:'terminal_finished',...owner,terminalId,state:row.state,exitCode:row.exitCode,signal:row.signal,durationMs:row.finishedAt-row.startedAt});});
    return this.view(terminalId,owner);
  }
  input(terminalId,owner,{data=''}={}){const row=this._row(terminalId,owner);if(row.finishedAt)throw new NativeTerminalError('terminal_not_running',409);const text=String(data),bytes=Buffer.byteLength(text);if(bytes>MAX_INPUT_BYTES)throw new NativeTerminalError('terminal_input_too_large',413);if(text)row.pty.write(text);row.lastActivityAt=this.now();this.emit({type:'terminal_input',...owner,terminalId,bytes});return this.view(terminalId,owner);}
  output(terminalId,owner,{offset=0,limit=262144}={}){const row=this._row(terminalId,owner);row.lastActivityAt=this.now();return {...this.view(terminalId,owner),output:row.output.read(offset,limit)};}
  resize(terminalId,owner,{cols,rows}={}){const row=this._row(terminalId,owner);if(row.finishedAt)throw new NativeTerminalError('terminal_not_running',409);row.cols=clampSize(cols,20,500,row.cols);row.rows=clampSize(rows,5,200,row.rows);try{row.pty.resize(row.cols,row.rows);}catch(error){throw new NativeTerminalError(`terminal_resize_failed:${error.message}`,409);}row.lastActivityAt=this.now();this.emit({type:'terminal_resized',...owner,terminalId,cols:row.cols,rows:row.rows});return this.view(terminalId,owner);}
  signal(terminalId,owner,{signal='interrupt'}={}){const row=this._row(terminalId,owner);if(row.finishedAt)return this.view(terminalId,owner);const kind=String(signal||'interrupt').toLowerCase();try{if(kind==='interrupt')row.pty.write('\x03');else if(kind==='terminate')row.pty.kill(this.platform==='win32'?undefined:'SIGTERM');else if(kind==='kill')row.pty.kill(this.platform==='win32'?undefined:'SIGKILL');else throw new NativeTerminalError('terminal_signal_unsupported');}catch(error){if(error instanceof NativeTerminalError)throw error;throw new NativeTerminalError(`terminal_signal_failed:${error.message}`,409);}row.lastActivityAt=this.now();this.emit({type:'terminal_signal',...owner,terminalId,signal:kind});return this.view(terminalId,owner);}
  stop(terminalId,owner,{force=false}={}){return this.signal(terminalId,owner,{signal:force?'kill':'terminate'});}
  view(terminalId,owner=null){const row=this._row(terminalId,owner);return {terminalId:row.terminalId,accountId:row.accountId,deviceId:row.deviceId,sessionId:row.sessionId,agentId:row.agentId,pid:row.pid,state:row.state,shell:row.shell,cwd:row.cwd,cols:row.cols,rows:row.rows,startedAt:row.startedAt,lastActivityAt:row.lastActivityAt,firstOutputAt:row.firstOutputAt,finishedAt:row.finishedAt,exitCode:row.exitCode,signal:row.signal,outputBytes:row.output.totalBytes};}
  list(owner){this.prune();return [...this.rows.values()].filter(row=>!owner||['accountId','deviceId','sessionId','agentId'].every(key=>String(owner[key]||'')===row[key])).map(row=>this.view(row.terminalId,owner));}
  close(){if(this.timer)clearInterval(this.timer);for(const row of this.rows.values())if(!row.finishedAt)try{row.pty.kill();}catch{}}
}
