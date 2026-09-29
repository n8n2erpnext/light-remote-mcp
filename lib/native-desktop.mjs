import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';

const TRUE_VALUES=new Set(['1','true','yes','on']);
const DEFAULT_MAX_LINE_BYTES=8*1024*1024;
const DEFAULT_IDLE_MS=60_000;
const START_TIMEOUT_MS=8_000;

export function realRemoteEnabled(env=process.env){
  return TRUE_VALUES.has(String(env.LIGHT_REMOTE_REAL_REMOTE||'').trim().toLowerCase());
}

export function realRemoteHelperPath(env=process.env){
  return String(env.LIGHT_REMOTE_CLIENT_EXE||'').trim();
}

export function realRemoteAvailable({platform=process.platform,env=process.env,exists=fs.existsSync}={}){
  const helper=realRemoteHelperPath(env);
  return platform==='win32'&&realRemoteEnabled(env)&&Boolean(helper)&&exists(helper);
}

function boundedInt(value,fallback,min,max){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(min,Math.min(Math.trunc(n),max)):fallback;
}

function eventToActions(event){
  const type=String(event?.type||'').trim().toLowerCase();
  if(type==='move') return [{op:'cursor.move',x:Number(event.x),y:Number(event.y)}];
  if(type==='click'){
    const click={op:'cursor.click',button:String(event.button||'left'),count:boundedInt(event.count,1,1,3)};
    return event.x!=null&&event.y!=null
      ? [{op:'cursor.move',x:Number(event.x),y:Number(event.y)},click]
      : [click];
  }
  if(type==='wheel'){
    const wheel={op:'cursor.wheel',delta:Number(event.delta)||0};
    return event.x!=null&&event.y!=null
      ? [{op:'cursor.move',x:Number(event.x),y:Number(event.y)},wheel]
      : [wheel];
  }
  if(type==='text') return [{op:'text.write',text:String(event.text||''),intervalMs:boundedInt(event.intervalMs,12,0,100)}];
  if(type==='key'){
    const key=String(event.key||'');
    const modifiers=Array.isArray(event.modifiers)?event.modifiers.map(String):[];
    return [modifiers.length?{op:'key.hotkey',key,modifiers}:{op:'key.press',key}];
  }
  throw new Error('desktop_input_event_unsupported');
}
function sessionRoute(id){
  return String(id||'').startsWith('bsem_')?'browser':'semantic';
}

function mapRequest(operation,args={}){
  if(operation==='status') return {op:'desktop.status'};
  if(operation==='windows') return {op:'desktop.windows',maxWindows:boundedInt(args.limit,100,1,250)};
  if(operation==='frame') return {
    op:'desktop.frame',
    screen:boundedInt(args.screen,0,0,31),
    maxWidth:boundedInt(args.maxWidth,960,160,1280),
    maxHeight:boundedInt(args.maxHeight,540,90,720),
    quality:boundedInt(args.quality,50,25,70)
  };
  if(operation==='input'){
    const out={op:'desktop.input',actions:(Array.isArray(args.events)?args.events:[]).flatMap(eventToActions)};
    if(args.semanticSessionId){
      out.semanticSessionId=String(args.semanticSessionId);
      out.afterSeq=Math.max(0,Number(args.afterSeq)||0);
      out.settleMs=boundedInt(args.settleMs,90,0,250);
    }
    return out;
  }
  if(operation==='semantic-attach'){
    const provider=String(args.provider||'windows-uia').toLowerCase();
    if(provider==='browser-cdp') return {
      op:'desktop.browser.attach',
      cdpEndpoint:String(args.cdpEndpoint||''),
      targetId:String(args.targetId||''),
      urlMatch:String(args.urlMatch||''),
      maxDepth:boundedInt(args.maxDepth,8,1,16),
      maxNodes:boundedInt(args.maxNodes,600,1,1500)
    };
    return {
      op:'desktop.semantic.attach',
      maxDepth:boundedInt(args.maxDepth,6,1,16),
      maxNodes:boundedInt(args.maxNodes,500,1,1500)
    };
  }
  if(operation==='semantic-snapshot'){
    const id=String(args.semanticSessionId||'');
    return sessionRoute(id)==='browser'?{op:'desktop.browser.snapshot',browserSessionId:id}:{op:'desktop.semantic.snapshot',semanticSessionId:id};
  }
  if(operation==='semantic-events'){
    const id=String(args.semanticSessionId||'');
    const common={afterSeq:Math.max(0,Number(args.afterSeq)||0),limit:boundedInt(args.limit,100,1,200)};
    return sessionRoute(id)==='browser'?{op:'desktop.browser.events',browserSessionId:id,...common}:{op:'desktop.semantic.events',semanticSessionId:id,...common};
  }
  if(operation==='semantic-detach'){
    const id=String(args.semanticSessionId||'');
    return sessionRoute(id)==='browser'?{op:'desktop.browser.detach',browserSessionId:id}:{op:'desktop.semantic.detach',semanticSessionId:id};
  }
  throw new Error('invalid_desktop_operation');
}

export class NativeDesktopBridge {
  constructor({
    command=realRemoteHelperPath(),
    timeoutMs=5000,
    idleMs=Number(process.env.LIGHT_REMOTE_RMV2_IDLE_MS)||DEFAULT_IDLE_MS,
    maxLineBytes=DEFAULT_MAX_LINE_BYTES,
    spawnImpl=spawn
  }={}){
    this.command=String(command||'').trim();
    this.timeoutMs=Math.max(250,Math.min(Number(timeoutMs)||5000,30000));
    this.idleMs=Math.max(1000,Math.min(Number(idleMs)||DEFAULT_IDLE_MS,15*60*1000));
    this.maxLineBytes=Math.max(4096,Math.min(Number(maxLineBytes)||DEFAULT_MAX_LINE_BYTES,16*1024*1024));
    this.spawnImpl=spawnImpl;
    this.child=null;
    this.socket=null;
    this.buffer='';
    this.pending=new Map();
    this.stderr='';
    this.starting=null;
    this.startup=null;
    this.ready=false;
    this.idleTimer=null;
  }

  get running(){
    return Boolean(this.child&&!this.child.killed&&this.child.exitCode==null&&this.socket&&!this.socket.destroyed&&this.ready);
  }

  _clearIdle(){
    if(this.idleTimer){clearTimeout(this.idleTimer);this.idleTimer=null;}
  }

  _armIdle(){
    this._clearIdle();
    if(!this.running||this.pending.size)return;
    this.idleTimer=setTimeout(()=>{
      this.idleTimer=null;
      if(!this.pending.size)this.close();
      else this._armIdle();
    },this.idleMs);
    this.idleTimer.unref?.();
  }

  _failAll(error){
    for(const row of this.pending.values()){clearTimeout(row.timer);row.reject(error);}
    this.pending.clear();
  }

  async _connectPipe(pipePath){
    const deadline=Date.now()+START_TIMEOUT_MS;
    let lastError=new Error('real_remote_pipe_unavailable');
    while(Date.now()<deadline){
      try{
        return await new Promise((resolve,reject)=>{
          const socket=net.createConnection(pipePath);
          const fail=error=>{try{socket.destroy();}catch{};reject(error);};
          socket.once('error',fail);
          socket.once('connect',()=>{
            socket.removeListener('error',fail);
            resolve(socket);
          });
        });
      }catch(error){
        lastError=error;
        await new Promise(resolve=>setTimeout(resolve,40));
      }
    }
    throw lastError;
  }

  async _start(){
    if(this.running)return;
    if(this.starting)return this.starting;
    this.starting=this._startOnce().finally(()=>{this.starting=null;});
    return this.starting;
  }

  async _startOnce(){
    if(!this.command)throw new Error('real_remote_helper_unavailable');
    this.close();
    const pipeName=`lightremote-rmv2-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    const child=this.spawnImpl(this.command,['--pipe',pipeName],{
      windowsHide:true,
      stdio:['ignore','ignore','pipe'],
      env:{...process.env,LIGHT_REMOTE_REAL_REMOTE_HELPER:'1'}
    });
    this.child=child;
    this.stderr='';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data',chunk=>{this.stderr=(this.stderr+String(chunk)).slice(-65536);});
    child.on('error',error=>{
      if(this.child===child)this.child=null;
      this.ready=false;
      this.startup?.reject(error);
      this._failAll(error);
    });
    child.on('exit',(code,signal)=>{
      if(this.child===child)this.child=null;
      this.ready=false;
      const error=Object.assign(new Error('real_remote_helper_exited'),{code,signal,stderr:this.stderr});
      this.startup?.reject(error);
      if(this.pending.size)this._failAll(error);
    });

    const readyPromise=new Promise((resolve,reject)=>{this.startup={resolve,reject};});
    const readyTimer=setTimeout(()=>this.startup?.reject(new Error('real_remote_ready_timeout')),START_TIMEOUT_MS);
    readyTimer.unref?.();
    const pipePath='\\\\.\\pipe\\'+pipeName;
    const socket=await this._connectPipe(pipePath);
    this.socket=socket;
    this.buffer='';
    socket.setEncoding('utf8');
    socket.on('data',chunk=>this._onData(chunk));
    socket.on('error',error=>{
      if(this.socket===socket)this.socket=null;
      this.ready=false;
      this.startup?.reject(error);
      if(this.pending.size)this._failAll(error);
    });
    socket.on('close',()=>{
      if(this.socket===socket)this.socket=null;
      this.ready=false;
      if(this.pending.size)this._failAll(new Error('real_remote_pipe_closed'));
    });

    try{await readyPromise;}
    finally{clearTimeout(readyTimer);this.startup=null;}
    this._armIdle();
  }

  _onData(chunk){
    this.buffer+=String(chunk);
    if(Buffer.byteLength(this.buffer,'utf8')>this.maxLineBytes*2){
      const error=new Error('real_remote_helper_output_overflow');
      this._failAll(error);this.close();return;
    }
    for(;;){
      const index=this.buffer.indexOf('\n');
      if(index<0)break;
      const line=this.buffer.slice(0,index).trim();
      this.buffer=this.buffer.slice(index+1);
      if(!line)continue;
      if(Buffer.byteLength(line,'utf8')>this.maxLineBytes){this._failAll(new Error('real_remote_helper_line_too_large'));this.close();return;}
      let message;try{message=JSON.parse(line);}catch{continue;}
      if(message?.type==='event'){
        if(message.eventName==='robot.ready'&&!this.ready){
          this.ready=true;
          this.startup?.resolve(message);
        }
        continue;
      }
      if(message?.type!=='response')continue;
      const id=String(message.id||''),row=this.pending.get(id);
      if(!row)continue;
      this.pending.delete(id);clearTimeout(row.timer);
      if(message.ok===false)row.reject(Object.assign(new Error(String(message.error||'real_remote_helper_error')),{payload:message}));
      else row.resolve(message.data??message.result??null);
      this._armIdle();
    }
  }

  async request(op,args={},options={}){
    const operation=String(op||'').trim();
    if(!/^[a-z][a-z0-9.-]{1,40}$/.test(operation))throw new Error('invalid_desktop_operation');
    await this._start();
    this._clearIdle();
    const id='rr_'+crypto.randomBytes(12).toString('base64url');
    const timeoutMs=Math.max(250,Math.min(Number(options.timeoutMs)||this.timeoutMs,30000));
    const payload={id,...mapRequest(operation,args&&typeof args==='object'?args:{})};
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(id);
        reject(new Error('real_remote_helper_timeout'));
        this._armIdle();
      },timeoutMs);
      timer.unref?.();
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket.write(JSON.stringify(payload)+'\n');}
      catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);this._armIdle();}
    });
  }

  close(){
    this._clearIdle();
    const socket=this.socket;
    const child=this.child;
    this.socket=null;
    this.child=null;
    this.ready=false;
    this.buffer='';
    this.startup?.reject(new Error('real_remote_helper_closed'));
    this.startup=null;
    if(socket){try{socket.end();}catch{}try{socket.destroy();}catch{}}
    if(child&&child.exitCode==null&&!child.killed){
      const timer=setTimeout(()=>{try{if(child.exitCode==null&&!child.killed)child.kill();}catch{}},1500);
      timer.unref?.();
    }
    if(this.pending.size)this._failAll(new Error('real_remote_helper_closed'));
  }
}
