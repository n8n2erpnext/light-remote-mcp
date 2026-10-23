/*
 * P1 standalone opt-in local IPC controller.
 * No network/TCP exposure, no Codex launch, no remote execution.
 * IMPORTANT: caller must be an authorized local component; owner account
 * authentication/CSRF bridging from Local Wall comes in next phase.
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ContinuityStore,continuityDefaultRoot} from './project-continuity-store.mjs';

const MAX_REQUEST=64*1024,MAX_REPLY=512*1024;
const reject=(code)=>{throw Error(code);};
export function ipcPath(root=continuityDefaultRoot()){
 if(process.platform==='win32'){
  const h=crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0,24);
  return '\\\\.\\pipe\\light-remote-continuity-'+h;
 }
 return path.join(path.resolve(root),'continuity.sock');
}
function tokenFile(root){return path.join(root,'ipc-token');}
function getToken(root,{create=false}={}){
 const file=tokenFile(root);
 if(!fs.existsSync(file)){
  if(!create)throw Error('continuity_ipc_not_initialized');
  fs.writeFileSync(file,crypto.randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
 }
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||(process.platform!=='win32'&&(stat.mode&0o077)!==0))reject('continuity_ipc_token_unsafe');
 const data=fs.readFileSync(file,'utf8').trim();
 if(!/^[a-f0-9]{64}$/.test(data))reject('continuity_ipc_token_invalid');
 return data;
}
const constantEquals=(a,b)=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export function startContinuityServer({root=continuityDefaultRoot()}={}){
 const store=new ContinuityStore({root}),target=ipcPath(root),secret=getToken(store.root,{create:true});
 const actions={
  health:()=>({status:'ready',version:1,projects:store.projects().length}),
  listProjects:()=>store.projects(),
  getProject:d=>store.project(d.projectId),
  createProject:d=>store.createProject({projectName:d.name,workspace:d.workspace||''}),
  setModules:d=>store.setModules(d.projectId,{memory:d.memory,codex:d.codex,expectedRevision:d.expectedRevision}),
  createTask:d=>store.createTask(d.projectId,d.title),
  addSection:d=>store.addSection(d.taskId,{title:d.title,dependsOn:d.dependsOn||[]}),
  getTask:d=>store.task(d.taskId),
  checkpoint:d=>store.checkpoint(d.projectId),
  exportCheckpoint:d=>store.exportCheckpoint(d.projectId),
  onlineBackup:()=>store.onlineBackup(),
  memoryPut:d=>store.memoryPut(d.projectId,{body:d.body,kind:d.kind,sourceRef:d.sourceRef}),
  memorySearch:d=>store.memorySearch(d.projectId,d.query,{limit:d.limit||8})
 };
 const server=net.createServer(socket=>{
  socket.setTimeout(3000);
  let content='',handled=false;
  function reply(out){
   if(handled)return;handled=true;
   let data=JSON.stringify(out);
   if(Buffer.byteLength(data)>MAX_REPLY)data=JSON.stringify({ok:false,error:'continuity_response_too_large'});
   socket.end(data+'\n');
  }
  socket.on('timeout',()=>socket.destroy());
  socket.on('error',()=>{});
  socket.on('data',buf=>{
   if(handled)return;
   content+=buf.toString('utf8');
   if(Buffer.byteLength(content)>MAX_REQUEST){reply({ok:false,error:'continuity_request_too_large'});return;}
   const end=content.indexOf('\n');if(end<0)return;
   try{
    const raw=JSON.parse(content.slice(0,end));
    if(!raw||!constantEquals(raw.token,secret))return reply({ok:false,error:'continuity_unauthorized'});
    if(!Object.hasOwn(actions,raw.action))return reply({ok:false,error:'continuity_unknown_action'});
    const value=actions[raw.action](raw.data||{});
    Promise.resolve(value).then(result=>reply({ok:true,result})).catch(e=>reply({ok:false,error:/^continuity_/.test(e.message)?e.message:'continuity_action_failed'}));
   }catch(e){reply({ok:false,error:/^continuity_/.test(e.message)?e.message:'continuity_invalid_request'});}
  });
 });
 server.on('close',()=>store.close());
 // No unlink of an existing socket; never take over an active/stale listener silently.
 if(process.platform!=='win32'&&fs.existsSync(target))throw Error('continuity_socket_exists_manual_recovery_required');
 server.on('listening',()=>{
  if(process.platform!=='win32')fs.chmodSync(target,0o600);
 });
 server.listen(target);
 const stop=()=>new Promise(resolve=>server.close(()=>{if(process.platform!=='win32'&&fs.existsSync(target))fs.unlinkSync(target);resolve();}));
 return {server,stop,root:store.root,socketPath:target};
}
export function continuityRequest(action,data={}, {root=continuityDefaultRoot(),timeoutMs=4000}={}){
 const secret=getToken(path.resolve(root)),target=ipcPath(root);
 return new Promise((resolve,rejectPromise)=>{
  const socket=net.createConnection(target);
  let result='',ended=false;
  function done(error,value){
   if(ended)return;ended=true;socket.destroy();
   if(error)rejectPromise(error);else resolve(value);
  }
  socket.setTimeout(timeoutMs,()=>done(Error('continuity_ipc_timeout')));
  socket.on('error',done);
  socket.on('connect',()=>socket.write(JSON.stringify({token:secret,action,data})+'\n'));
  socket.on('data',buf=>{
   result+=buf.toString('utf8');
   if(Buffer.byteLength(result)>MAX_REPLY)return done(Error('continuity_ipc_response_limit'));
   const n=result.indexOf('\n');
   if(n>=0){
    try{const v=JSON.parse(result.slice(0,n));if(!v.ok)return done(Error(v.error||'continuity_ipc_failure'));done(null,v.result);}
    catch(e){done(e);}
   }
  });
  socket.on('end',()=>{if(!ended)done(Error('continuity_ipc_closed'));});
 });
}
