import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
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

export function macGuiSidecarRequested(env=process.env){
  return TRUE_VALUES.has(String(env.LIGHT_REMOTE_MACOS_GUI_SIDECAR||'').trim().toLowerCase());
}

// This is strictly the experimental app path, never a generic unsigned app
// supplied by remote commands. A wrong value fails closed, not direct-spawn.
export function macGuiSidecarAppPath(env=process.env){
  if(!macGuiSidecarRequested(env))return '';
  const expected=path.resolve(String(env.HOME||os.homedir()),'Applications','LightRemoteRobotDev.app');
  const supplied=String(env.LIGHT_REMOTE_MACOS_GUI_APP||expected).trim();
  if(path.resolve(supplied)!==expected)return '';
  // Canonicalize the parent: /var is an OS alias of /private/var.
  // Reject symlink escapes at the app directory itself.
  try {
    const expectedReal=path.join(fs.realpathSync(path.dirname(expected)),path.basename(expected));
    if(fs.realpathSync(expected)!==expectedReal)return '';
  }catch{return ''}
  return expected;
}

export function realRemoteAvailable({platform=process.platform,env=process.env,exists=fs.existsSync}={}){
  if(platform!=='win32'&&platform!=='darwin'||!realRemoteEnabled(env))return false;
  if(platform==='darwin'&&macGuiSidecarRequested(env)){
    const app=macGuiSidecarAppPath(env);
    return Boolean(app)&&exists(path.join(app,'Contents','MacOS','LightRemoteRealRemote'));
  }
  const helper=realRemoteHelperPath(env);
  return Boolean(helper)&&exists(helper);
}

function boundedInt(value,fallback,min,max){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(min,Math.min(Math.trunc(n),max)):fallback;
}

function eventToActions(event){
  const type=String(event?.type||'').trim().toLowerCase();
  const guard=String(event?.guardTitleContains||'').trim();
  if(guard.length>256)throw new Error('desktop_input_invalid_guard_title');
  const delayMs=boundedInt(event?.delayMs,0,0,2000);
  const guarded=actions=>actions.map((action,index)=>{
    const next=guard?{...action,guardTitleContains:guard}:action;
    return delayMs>0&&index===actions.length-1?{...next,delayMs}:next;
  });
  if(type==='move'){
    const move={op:'cursor.move',x:Number(event.x),y:Number(event.y),durationMs:boundedInt(event.durationMs,90,0,500),steps:boundedInt(event.steps,8,1,32)};
    if(event.screen!=null)move.screen=boundedInt(event.screen,0,0,255);
    return guarded([move]);
  }
  if(type==='click'){
    const click={op:'cursor.click',button:String(event.button||'left'),count:boundedInt(event.count,1,1,3)};
    if(event.x!=null&&event.y!=null){
      const move={op:'cursor.move',x:Number(event.x),y:Number(event.y)};
      if(event.screen!=null)move.screen=boundedInt(event.screen,0,0,255);
      return guarded([move,click]);
    }
    return guarded([click]);
  }
  if(type==='wheel'){
    const wheel={op:'cursor.wheel',delta:Number(event.delta)||0};
    if(event.x!=null&&event.y!=null){
      const move={op:'cursor.move',x:Number(event.x),y:Number(event.y)};
      if(event.screen!=null)move.screen=boundedInt(event.screen,0,0,255);
      return guarded([move,wheel]);
    }
    return guarded([wheel]);
  }
  if(type==='drag'){
    const drag={op:'cursor.drag',fromX:Number(event.x),fromY:Number(event.y),toX:Number(event.toX),toY:Number(event.toY),button:String(event.button||'left'),steps:boundedInt(event.steps,8,1,32),durationMs:boundedInt(event.durationMs,120,0,1000)};
    if(event.screen!=null)drag.screen=boundedInt(event.screen,0,0,255);
    if(event.toScreen!=null)drag.toScreen=boundedInt(event.toScreen,event.screen==null?0:boundedInt(event.screen,0,0,255),0,255);
    return guarded([drag]);
  }
  if(type==='app.launch') return guarded([{op:'app.launch',bundleId:String(event.bundleId||'').slice(0,128)}]);
  if(type==='type') return guarded([{op:'text.type',text:String(event.text||''),intervalMs:boundedInt(event.intervalMs,48,25,100)}]);
  if(type==='text') return guarded([{op:'text.write',text:String(event.text||''),intervalMs:boundedInt(event.intervalMs,12,0,100)}]);
  if(type==='key'){
    const key=String(event.key||'');
    const modifiers=Array.isArray(event.modifiers)?event.modifiers.map(String):[];
    return guarded([modifiers.length?{op:'key.hotkey',key,modifiers}:{op:'key.press',key}]);
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
    if(args.displayTopologyId)out.displayTopologyId=String(args.displayTopologyId);
    if(args.semanticSessionId){
      out.semanticSessionId=String(args.semanticSessionId);
      out.afterSeq=Math.max(0,Number(args.afterSeq)||0);
      out.settleMs=boundedInt(args.settleMs,90,0,250);
    }
    return out;
  }
  if(operation==='run'){
    const semanticAction=String(args.nodeId||'').trim()&&String(args.action||'').trim()&&!Array.isArray(args.events);
    const out=semanticAction
      ?{op:'desktop.run',semanticSessionId:String(args.semanticSessionId||''),nodeId:String(args.nodeId||'').slice(0,512),action:String(args.action||'').slice(0,80)}
      :{op:'desktop.run',actions:(Array.isArray(args.events)?args.events:[]).flatMap(eventToActions)};
    if(args.value!=null)out.value=String(args.value).slice(0,4096);
    if(args.displayTopologyId)out.displayTopologyId=String(args.displayTopologyId);
    if(args.semanticSessionId){
      out.semanticSessionId=String(args.semanticSessionId);
      out.afterSeq=Math.max(0,Number(args.afterSeq)||0);
      out.settleMs=boundedInt(args.settleMs,90,0,250);
    }
    const wait=args.await&&typeof args.await==='object'&&!Array.isArray(args.await)?args.await:null;
    if(wait){
      const spec={};
      if(wait.foregroundTitleContains!=null)spec.foregroundTitleContains=String(wait.foregroundTitleContains).slice(0,256);
      if(wait.foregroundTitleEquals!=null)spec.foregroundTitleEquals=String(wait.foregroundTitleEquals).slice(0,256);
      if(wait.focusedNameContains!=null)spec.focusedNameContains=String(wait.focusedNameContains).slice(0,256);
      spec.timeoutMs=boundedInt(wait.timeoutMs,3000,50,15000);
      out.await=spec;
    }
    return out;
  }
  if(operation==='visual-attach') return {
    op:'desktop.visual.attach',
    screen:boundedInt(args.screen,0,0,31),
    maxWidth:boundedInt(args.maxWidth,960,160,1280),
    maxHeight:boundedInt(args.maxHeight,540,90,720),
    quality:boundedInt(args.quality,50,25,70),
    leaseMs:boundedInt(args.leaseMs,120000,1000,900000),
    owner:String(args.owner||'').slice(0,80)
  };
  if(operation==='visual-resume') return {
    op:'desktop.visual.resume',
    visualSessionId:String(args.visualSessionId||''),
    leaseToken:String(args.leaseToken||''),
    leaseMs:boundedInt(args.leaseMs,0,0,900000)
  };
  if(operation==='visual-frame') return {
    op:'desktop.visual.frame',
    visualSessionId:String(args.visualSessionId||''),
    leaseToken:String(args.leaseToken||'')
  };
  if(operation==='visual-detach') return {
    op:'desktop.visual.detach',
    visualSessionId:String(args.visualSessionId||''),
    leaseToken:String(args.leaseToken||'')
  };
  if(operation==='semantic-act'){
    const id=String(args.semanticSessionId||'');
    if(sessionRoute(id)==='browser')throw new Error('semantic_action_provider_observation_only');
    const out={
      op:'desktop.semantic.act',
      semanticSessionId:id,
      nodeId:String(args.nodeId||'').slice(0,512),
      action:String(args.action||'').slice(0,80),
      afterSeq:Math.max(0,Number(args.afterSeq)||0),
      settleMs:boundedInt(args.settleMs,90,0,250)
    };
    if(args.value!=null)out.value=String(args.value).slice(0,4096);
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
      scope:String(args.scope||'foreground').toLowerCase()==='desktop'||String(args.scope||'').toLowerCase()==='task'?'desktop':'foreground',
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
    spawnImpl=spawn,
    platform=process.platform,
    env=process.env
  }={}){
    this.command=String(command||'').trim();
    this.platform=platform;
    this.guiRequested=platform==='darwin'&&macGuiSidecarRequested(env);
    this.guiApp=this.guiRequested?macGuiSidecarAppPath(env):'';
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
    this.eventListeners=new Set();
    this.retainCount=0;
  }

  get running(){
    return Boolean((this.guiApp||(this.child&&!this.child.killed&&this.child.exitCode==null))&&this.socket&&!this.socket.destroyed&&this.ready);
  }

  onEvent(listener){
    if(typeof listener!=='function')throw new TypeError('real_remote_event_listener_required');
    this.eventListeners.add(listener);
    return ()=>this.eventListeners.delete(listener);
  }

  _emitEvent(message){
    for(const listener of this.eventListeners){try{listener(message);}catch{}}
  }

  closeIfIdle(){
    if(this.pending.size||this.retainCount>0)return false;
    this.close();
    return true;
  }

  retain(){
    this.retainCount+=1;
    this._clearIdle();
    let released=false;
    return ()=>{
      if(released)return;
      released=true;
      this.retainCount=Math.max(0,this.retainCount-1);
      this._armIdle();
    };
  }

  _clearIdle(){
    if(this.idleTimer){clearTimeout(this.idleTimer);this.idleTimer=null;}
  }

  _armIdle(){
    this._clearIdle();
    if(!this.running||this.pending.size||this.retainCount>0)return;
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

  _restoreSystemCursorBestEffort(){
    if(process.platform!=='win32'||!this.command||!fs.existsSync(this.command))return;
    try{
      const restore=spawn(this.command,['--restore-cursors'],{
        windowsHide:true,
        stdio:['ignore','ignore','ignore'],
        env:{...process.env,LIGHT_REMOTE_REAL_REMOTE_HELPER:'1'}
      });
      restore.on('error',()=>{});
      restore.unref?.();
    }catch{}
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
    if(this.guiRequested&&!this.guiApp)throw new Error('macos_gui_sidecar_invalid_app_path');
    if(!this.guiApp&&!this.command)throw new Error('real_remote_helper_unavailable');
    this.close();
    const pipeName=`lightremote-rmv2-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    // Darwin AF_UNIX has a 104-byte sun_path limit; use a short random path.
    // Helper checks its prefix, binds 0600 and unlinks on shutdown.
    const pipePath=this.platform==='darwin' ? path.join('/tmp',pipeName+'.sock') : '\\\\.\\pipe\\'+pipeName;
    if(this.guiApp){
      // The /usr/bin/open process exits after handing off to LaunchServices.
      // It is NOT the Robot lifetime. The Unix RPC socket owns that lifetime.
      // This path is only possible with an explicit opt-in and fixed dev .app.
      const binary=path.join(this.guiApp,'Contents','MacOS','LightRemoteRealRemote');
      if(!fs.existsSync(binary)||fs.realpathSync(this.guiApp)!==path.join(fs.realpathSync(path.dirname(this.guiApp)),path.basename(this.guiApp)))
        throw new Error('macos_gui_sidecar_helper_unavailable');
      await new Promise((resolve,reject)=>{
        const launch=this.spawnImpl('/usr/bin/open',
          ['-n','-a',this.guiApp,'--args','--socket',pipePath],
          {stdio:'ignore',windowsHide:true});
        let finished=false;
        const timer=setTimeout(()=>done(new Error('macos_gui_sidecar_launch_timeout')),START_TIMEOUT_MS);
        const done=error=>{
          if(finished)return;
          finished=true;clearTimeout(timer);
          if(error)reject(error);else resolve();
        };
        launch.once('error',done);
        launch.once('exit',(code,signal)=>
          done(code===0?null:Object.assign(new Error('macos_gui_sidecar_open_failed'),{code,signal})));
      });
      this.child=null;
      this.stderr='';
    }else{
      const child=this.spawnImpl(this.command,this.platform==='darwin'?['--socket',pipePath]:['--pipe',pipeName],{
        windowsHide:true,
        stdio:['ignore','ignore','pipe'],
        env:{...process.env,LIGHT_REMOTE_REAL_REMOTE_HELPER:'1'}
      });
      this.child=child;
      this.stderr='';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data',chunk=>{this.stderr=(this.stderr+String(chunk)).slice(-65536);});
      child.on('error',error=>{
        if(this.child!==child)return;
        this._restoreSystemCursorBestEffort();
        this.child=null;
        this.ready=false;
        this.startup?.reject(error);
        this._failAll(error);
      });
      child.on('exit',(code,signal)=>{
        if(this.child!==child)return;
        this._restoreSystemCursorBestEffort();
        this.child=null;
        this.ready=false;
        const error=Object.assign(new Error('real_remote_helper_exited'),{code,signal,stderr:this.stderr});
        this.startup?.reject(error);
        if(this.pending.size)this._failAll(error);
        this._emitEvent({type:'event',eventName:'robot.closed',data:{reason:'helper-exit',code,signal}});
      });
    }

    const readyPromise=new Promise((resolve,reject)=>{this.startup={resolve,reject};});
    readyPromise.catch(()=>{});
    const readyTimer=setTimeout(()=>this.startup?.reject(new Error('real_remote_ready_timeout')),START_TIMEOUT_MS);
    readyTimer.unref?.();
    const socket=await this._connectPipe(pipePath);
    this.socket=socket;
    this.buffer='';
    socket.setEncoding('utf8');
    socket.on('data',chunk=>this._onData(chunk));
    socket.on('error',error=>{
      if(this.socket!==socket)return;
      this.socket=null;
      this.ready=false;
      this.startup?.reject(error);
      if(this.pending.size)this._failAll(error);
    });
    socket.on('close',()=>{
      if(this.socket!==socket)return;
      this.socket=null;
      this.ready=false;
      if(this.pending.size)this._failAll(new Error('real_remote_pipe_closed'));
      this._emitEvent({type:'event',eventName:'robot.closed',data:{reason:'pipe-close'}});
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
        this._emitEvent(message);
        this._armIdle();
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
        const error=new Error('real_remote_helper_timeout');
        try{this.close();}catch{}
        reject(error);
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
    this.retainCount=0;
    this.buffer='';
    this.startup?.reject(new Error('real_remote_helper_closed'));
    this.startup=null;
    if(socket){try{socket.end();}catch{}try{socket.destroy();}catch{}}
    if(child&&child.exitCode==null&&!child.killed){
      const timer=setTimeout(()=>{
        let forced=false;
        try{if(child.exitCode==null&&!child.killed){child.kill();forced=true;}}catch{}
        if(forced){
          const restoreTimer=setTimeout(()=>this._restoreSystemCursorBestEffort(),120);
          restoreTimer.unref?.();
        }
      },1500);
      timer.unref?.();
    }
    if(this.pending.size)this._failAll(new Error('real_remote_helper_closed'));
  }
}
