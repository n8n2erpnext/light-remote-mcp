/**
 * Gold Codex Bridge: official Codex app-server ChatGPT-plan sign-in.
 * ONE existing Gold Wall; no API-key requests, no ChatGPT cookies.
 *
 * App-server is a local child with isolated CODEX_HOME. All Codex JSON-RPC
 * server-initiated requests are denied; the Bridge never auto-approves tools.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function fault(code,status=400){return Object.assign(new Error(code),{status});}
const ALLOWED_LOGIN_HOSTS=new Set(['auth.openai.com','chatgpt.com','login.openai.com']);
function verifiedUrl(raw){
  if(typeof raw!=='string')throw fault('codex_login_url_invalid',502);
  let url;try{url=new URL(raw);}catch{throw fault('codex_login_url_invalid',502);}
  if(url.protocol!=='https:'||!ALLOWED_LOGIN_HOSTS.has(url.hostname)||
      url.username||url.password)throw fault('codex_login_url_invalid',502);
  return url.toString();
}
function compactError(value){
  return typeof value==='string'&&/^[a-z0-9_]{1,96}$/.test(value)?value:'codex_rpc_failed';
}
function privateFolder(dir){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const st=fs.statSync(dir);
  if((st.mode&0o077)!==0)throw fault('codex_home_permissions',503);
}
const defaultBinary='/opt/light-remote-gold-codex-runtime/node_modules/.bin/codex';

export function createGoldCodexPlus({home,command=defaultBinary,spawnImpl=spawn}){
  if(!path.isAbsolute(home)||!path.isAbsolute(command))
    throw fault('codex_plus_runtime_paths_invalid');
  let child=null,buffer='',requestId=0,booting=null,pending=new Map();
  let login=null,lastError=null,currentTurn=null;
  const notices=[];
  function emit(msg){
    if(msg?.method==='account/login/completed'){
      const params=msg.params||{};
      if(login&&(!params.loginId||params.loginId===login.loginId)){
        login={...login,state:params.success===false||params.error?'failed':'completed',verificationUrl:null,userCode:null};
      }
    }
    if(msg?.method==='account/updated' && login?.state==='pending'){
      // Account can refresh without completing this particular login.
      notices.push({method:'account/updated'});
    }
    if(currentTurn){
      if(msg.method==='item/agentMessage/delta'){
        if(typeof msg.params?.delta==='string')currentTurn.output=(currentTurn.output+msg.params.delta).slice(0,4000);
      }
      if(msg.method==='turn/completed' && msg.params?.turn?.id===currentTurn.turnId){
        const status=msg.params.turn.status;
        const payload={completed:status==='completed',status:status||'unverified',
          summary:currentTurn.output||null};
        currentTurn.resolve(payload);currentTurn=null;
      }
    }
  }
  function onLine(line){
    if(line.length>2_000_000){stop('codex_rpc_frame_too_large');return;}
    let msg;try{msg=JSON.parse(line);}catch{return;}
    if(msg&&Object.hasOwn(msg,'id')&&typeof msg.method==='string'){
      // Never allow a server-initiated approval or shell request.
      if(child?.stdin?.writable)child.stdin.write(JSON.stringify({id:msg.id,error:{code:-32601,message:'Unsupported: denied by Light Remote Gold'}})+'\n');
      return;
    }
    if(msg&&Object.hasOwn(msg,'id')){
      const item=pending.get(msg.id);if(!item)return;
      pending.delete(msg.id);clearTimeout(item.timer);
      if(msg.error)item.reject(fault(compactError(msg.error.data?.code||msg.error.message||'codex_rpc_failed'),502));
      else item.resolve(msg.result??{});
      return;
    }
    if(msg?.method)emit(msg);
  }
  function stop(reason='codex_runtime_disconnected'){
    const old=child;child=null;booting=null;buffer='';
    for(const [id,item] of pending){clearTimeout(item.timer);item.reject(fault(reason,503));pending.delete(id);}
    if(currentTurn){currentTurn.reject(fault(reason,503));currentTurn=null;}
    if(old && !old.killed){try{old.kill('SIGTERM');}catch{}}
  }
  function rpc(method,params,ms=12000){
    if(!child?.stdin?.writable)return Promise.reject(fault('codex_runtime_not_running',503));
    const id=++requestId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(fault('codex_rpc_timeout',504));},ms);
      timer.unref?.();
      pending.set(id,{resolve,reject,timer});
      const value={id,method};
      if(params!==undefined)value.params=params;
      try{child.stdin.write(JSON.stringify(value)+'\n');}
      catch{clearTimeout(timer);pending.delete(id);reject(fault('codex_rpc_transport_failed',502));}
    });
  }
  async function start(){
    if(child?.stdin?.writable)return;
    if(booting)return booting;
    booting=(async()=>{
      privateFolder(home);
      if(!fs.existsSync(command))throw fault('codex_binary_missing',503);
      const env={...process.env,CODEX_HOME:home};
      for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','ACCESS_TOKEN'])delete env[key];
      const proc=spawnImpl(command,['app-server','--listen','stdio://'],
        {env,cwd:home,stdio:['pipe','pipe','pipe'],windowsHide:true});
      child=proc;
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data',piece=>{
        buffer+=piece;
        if(buffer.length>2_000_000){stop('codex_rpc_output_too_large');return;}
        let idx;
        while((idx=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,idx).trim();buffer=buffer.slice(idx+1);
          if(line)onLine(line);
        }
      });
      // Stderr is never bridged into HTTP responses or Gold logs: it could
      // include auth-related detail.
      proc.stderr.on('data',()=>{});
      proc.on('error',()=>stop('codex_runtime_spawn_failed'));
      proc.on('exit',()=>{if(child===proc)stop('codex_runtime_exited');});
      await rpc('initialize',{clientInfo:{name:'light_remote_gold',title:'Light Remote Gold',version:'0.1.0'},
        capabilities:{experimentalApi:false}},18000);
      if(!child?.stdin?.writable)throw fault('codex_runtime_exited',503);
      child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    })();
    try{await booting;}
    catch(e){stop('codex_runtime_start_failed');throw e;}
    finally{booting=null;}
  }
  async function account(){
    await start();
    const result=await rpc('account/read',{refreshToken:false},15000);
    const a=result?.account;
    return {connected:Boolean(a),authMode:a?.type||a?.authMode||null,
      plan:a?.planType||null,requiresOpenaiAuth:result?.requiresOpenaiAuth!==false,
      runtime:'codex-app-server',billing:'chatgpt_plan',
      login:login&&login.state==='pending'?{state:'pending',
        verificationUrl:login.verificationUrl,userCode:login.userCode}:null};
  }
  async function beginLogin(){
    await start();
    if(login?.state==='pending')return {state:'pending',verificationUrl:login.verificationUrl,userCode:login.userCode};
    const result=await rpc('account/login/start',{type:'chatgptDeviceCode'},30000);
    if(!result||!result.loginId||!result.verificationUrl||!result.userCode)
      throw fault('codex_device_login_unsupported',502);
    login={state:'pending',loginId:String(result.loginId),
      verificationUrl:verifiedUrl(result.verificationUrl),
      userCode:String(result.userCode).slice(0,48)};
    return {state:login.state,verificationUrl:login.verificationUrl,userCode:login.userCode};
  }
  async function cancelLogin(){
    await start();
    if(login?.state==='pending'){
      try{await rpc('account/login/cancel',{loginId:login.loginId},12000);}finally{login=null;}
    }
    return {cancelled:true};
  }
  async function logout(){
    await start();
    if(login?.state==='pending')await cancelLogin();
    await rpc('account/logout',undefined,12000);
    login=null;
    return {signedOut:true};
  }
  async function runReadOnly({tasks=[]}={}){
    if(currentTurn)throw fault('codex_observer_busy',409);
    if(!Array.isArray(tasks)||tasks.length>20)throw fault('codex_task_limit_exceeded');
    const a=await account();
    if(!a.connected||a.authMode==='apiKey')throw fault('codex_chatgpt_sign_in_required',409);
    const isolated=path.join(home,'observer-workspace');
    privateFolder(isolated);
    const started=await rpc('thread/start',{cwd:isolated,
      approvalPolicy:'never',sandbox:'read-only',ephemeral:true},20000);
    const threadId=started?.thread?.id;
    if(!threadId)throw fault('codex_thread_start_failed',502);
    const safeTasks=tasks.map(t=>({title:String(t.title||'').slice(0,240),
      state:String(t.state||'').slice(0,24)}));
    const text='Light Remote Gold owner-authorized observer TEST. Do not execute tools, read files or run commands. Review task states and return one brief next step (80 words maximum):\n'+JSON.stringify(safeTasks);
    const turn=await rpc('turn/start',{threadId,input:[{type:'text',text}]},20000);
    const turnId=turn?.turn?.id;
    if(!turnId)throw fault('codex_turn_start_failed',502);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        if(currentTurn?.turnId===turnId){currentTurn=null;reject(fault('codex_turn_timeout',504));}
      },60000);timer.unref?.();
      currentTurn={turnId,output:'',resolve:r=>{clearTimeout(timer);resolve(r);},
        reject:e=>{clearTimeout(timer);reject(e);}};
    });
  }
  return {account,beginLogin,cancelLogin,logout,runReadOnly,stop};
}
