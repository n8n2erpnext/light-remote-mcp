import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const TRUE_VALUES=new Set(['1','true','yes','on']);
const DEFAULT_MAX_LINE_BYTES=1024*1024;

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

export class NativeDesktopBridge {
  constructor({
    command=realRemoteHelperPath(),
    args=['--real-remote-helper'],
    timeoutMs=5000,
    maxLineBytes=DEFAULT_MAX_LINE_BYTES,
    spawnImpl=spawn
  }={}){
    this.command=String(command||'').trim();
    this.args=[...(args||[])].map(String);
    this.timeoutMs=Math.max(250,Math.min(Number(timeoutMs)||5000,30000));
    this.maxLineBytes=Math.max(4096,Math.min(Number(maxLineBytes)||DEFAULT_MAX_LINE_BYTES,8*1024*1024));
    this.spawnImpl=spawnImpl;
    this.child=null;
    this.buffer='';
    this.pending=new Map();
    this.stderr='';
  }

  get running(){return Boolean(this.child&&!this.child.killed&&this.child.exitCode==null);}

  _failAll(error){
    for(const row of this.pending.values()){clearTimeout(row.timer);row.reject(error);}
    this.pending.clear();
  }

  _start(){
    if(this.running)return;
    if(!this.command)throw new Error('real_remote_helper_unavailable');
    const child=this.spawnImpl(this.command,this.args,{
      windowsHide:true,
      stdio:['pipe','pipe','pipe'],
      env:{...process.env,LIGHT_REMOTE_REAL_REMOTE_HELPER:'1'}
    });
    this.child=child;
    this.buffer='';
    this.stderr='';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>this._onStdout(chunk));
    child.stderr.on('data',chunk=>{this.stderr=(this.stderr+String(chunk)).slice(-65536);});
    child.on('error',error=>{if(this.child===child)this.child=null;this._failAll(error);});
    child.on('exit',(code,signal)=>{
      if(this.child===child)this.child=null;
      if(this.pending.size)this._failAll(Object.assign(new Error('real_remote_helper_exited'),{code,signal,stderr:this.stderr}));
    });
  }

  _onStdout(chunk){
    this.buffer+=String(chunk);
    if(Buffer.byteLength(this.buffer,'utf8')>this.maxLineBytes*2){
      const error=new Error('real_remote_helper_output_overflow');
      this._failAll(error);
      this.close();
      return;
    }
    for(;;){
      const index=this.buffer.indexOf('\n');
      if(index<0)break;
      const line=this.buffer.slice(0,index).trim();
      this.buffer=this.buffer.slice(index+1);
      if(!line)continue;
      if(Buffer.byteLength(line,'utf8')>this.maxLineBytes){this._failAll(new Error('real_remote_helper_line_too_large'));this.close();return;}
      let message;try{message=JSON.parse(line);}catch{continue;}
      const id=String(message?.id||''),row=this.pending.get(id);
      if(!row)continue;
      this.pending.delete(id);clearTimeout(row.timer);
      if(message.ok===false)row.reject(Object.assign(new Error(String(message.error||'real_remote_helper_error')),{payload:message}));
      else row.resolve(message.result??message.data??null);
    }
  }

  request(op,args={},options={}){
    const operation=String(op||'').trim();
    if(!/^[a-z][a-z0-9.-]{1,40}$/.test(operation))return Promise.reject(new Error('invalid_desktop_operation'));
    this._start();
    const id='rr_'+crypto.randomBytes(12).toString('base64url');
    const timeoutMs=Math.max(250,Math.min(Number(options.timeoutMs)||this.timeoutMs,30000));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(id);
        reject(new Error('real_remote_helper_timeout'));
      },timeoutMs);
      timer.unref?.();
      this.pending.set(id,{resolve,reject,timer});
      try{this.child.stdin.write(JSON.stringify({id,op:operation,args:args&&typeof args==='object'?args:{}})+'\n');}
      catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }

  close(){
    const child=this.child;
    this.child=null;
    if(!child)return;
    try{child.stdin.end();}catch{}
    try{if(child.exitCode==null&&!child.killed)child.kill();}catch{}
    this._failAll(new Error('real_remote_helper_closed'));
  }
}
