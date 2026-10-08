import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

// Experimental owner-initiated macOS GUI Robot sidecar, NOT production agent.
// LaunchServices provides the responsible .app identity; the Node agent retains
// the cloud connection and talks solely through a private local Unix socket.
// Never changes TCC settings or requests permission.
export class MacGuiRobotSidecar {
  constructor({appPath,home=process.env.HOME,spawnImpl=spawn,timeoutMs=10000}={}){
    const root=path.join(String(home||''),'Library/Caches/LightRemote-RMV2-Experimental');
    const app=path.resolve(String(appPath||''));
    if(!app.startsWith(root+path.sep)||!app.endsWith('/LightRemoteRmv2Canary.app')){
      throw new Error('macos_gui_sidecar_experimental_app_required');
    }
    if(!fs.existsSync(path.join(app,'Contents/MacOS/LightRemoteRealRemote'))){
      throw new Error('macos_gui_sidecar_helper_missing');
    }
    this.app=app;
    this.spawnImpl=spawnImpl;
    this.timeoutMs=Math.max(300,Math.min(Number(timeoutMs)||10000,15000));
    this.socketPath='/tmp/lightremote-rmv2-gui-'+crypto.randomBytes(7).toString('hex')+'.sock';
    this.socket=null;
    this.buf='';
    this.pending=new Map();
    this.ready=false;
  }
  async _launch(){
    return await new Promise((resolve,reject)=>{
      const p=this.spawnImpl('/usr/bin/open',['-n','-a',this.app,'--args','--socket',this.socketPath],{stdio:'ignore'});
      const timer=setTimeout(()=>reject(new Error('macos_gui_sidecar_launch_timeout')),this.timeoutMs);
      p.once('error',e=>{clearTimeout(timer);reject(e)});
      p.once('exit',code=>{
        clearTimeout(timer);
        if(code===0)resolve();else reject(new Error('macos_gui_sidecar_launch_exit_'+code));
      });
    });
  }
  async _connect(){
    for(let i=0;i<70;i++){
      try{return await new Promise((resolve,reject)=>{
        const s=net.createConnection(this.socketPath);
        s.once('connect',()=>resolve(s));s.once('error',reject);
      });}catch(e){
        if(i===69)throw e;
        await new Promise(r=>setTimeout(r,100));
      }
    }
    throw new Error('macos_gui_sidecar_connect_timeout');
  }
  _receive(chunk){
    this.buf+=chunk;
    if(this.buf.length>8*1024*1024){this.close();return;}
    while(this.buf.includes('\n')){
      const i=this.buf.indexOf('\n'),line=this.buf.slice(0,i);
      this.buf=this.buf.slice(i+1);if(!line)continue;
      let msg;try{msg=JSON.parse(line)}catch{continue}
      if(msg.type==='event'&&msg.eventName==='robot.ready'){
        this.ready=true;
      }else if(msg.type==='response'){
        const p=this.pending.get(msg.id);if(!p)continue;
        this.pending.delete(msg.id);clearTimeout(p.timer);
        if(msg.ok)p.resolve(msg.data);else p.reject(new Error(String(msg.error||'native_error')));
      }
    }
  }
  async start(){
    if(this.socket)return;
    await this._launch();
    try{
      this.socket=await this._connect();
      this.socket.setEncoding('utf8');
      this.socket.on('data',chunk=>this._receive(chunk));
      this.socket.on('error',e=>this._fail(e));
      this.socket.on('close',()=>this._fail(new Error('macos_gui_sidecar_disconnected')));
      const started=Date.now();
      while(!this.ready&&Date.now()-started<this.timeoutMs){
        await new Promise(r=>setTimeout(r,25));
      }
      if(!this.ready)throw new Error('macos_gui_sidecar_ready_timeout');
    }catch(e){this.close();throw e;}
  }
  _fail(error){
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}
    this.pending.clear();
  }
  async request(op,params={}){
    if(!this.socket||!this.ready)throw new Error('macos_gui_sidecar_not_ready');
    const id='gui_'+crypto.randomBytes(7).toString('hex');
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(id);reject(new Error('macos_gui_sidecar_rpc_timeout'));
      },this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket.write(JSON.stringify({id,op,...params})+'\n');}
      catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  close(){
    this.ready=false;
    this._fail(new Error('macos_gui_sidecar_closed'));
    if(this.socket){this.socket.end();this.socket.destroy();this.socket=null;}
    this.buf='';
    // Native helper exits when the peer disconnects. No production PID killed.
  }
}
