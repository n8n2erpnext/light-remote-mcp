/* Cross-platform Owner Broker POC. Opt-in standalone local OS process.
 * Release integration requires platform ACL, privileged trust anchor and
 * verified owner-account step-up. No automatic install/launch by Gold.
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {provisionContinuityOwnerAuthority,signContinuityConsent,rekeyContinuityOwnerAuthority,
 ownerAuthorityPublicKey} from './project-continuity-owner-grants.mjs';
import {verifyProjectReadDelegation} from '../lib/project-continuity-session-proof.mjs';

// Preserve Memory's 12KiB note capability plus source/JSON overhead,
// but keep bounded broker IPC and deny oversized payloads.
const MAX_LINE=20*1024,MAX_REPLY=64*1024;
const abort=(code)=>{throw Error(code);};
export function ownerBrokerEndpoint(runtimeDir,{platform=process.platform}={}){
 if(typeof runtimeDir!=='string'||!(platform==='win32'?path.win32.isAbsolute(runtimeDir):path.posix.isAbsolute(runtimeDir)))
  abort('continuity_broker_root_invalid');
 if(platform==='win32'){
  const digest=crypto.createHash('sha256').update(path.win32.normalize(runtimeDir).toLowerCase()).digest('hex').slice(0,28);
  return '\\\\.\\pipe\\light-remote-owner-broker-'+digest;
 }
 return path.join(runtimeDir,'owner-broker.sock');
}
function safeBrokerRoot(runtimeDir){
 const st=fs.lstatSync(runtimeDir);
 if(!st.isDirectory()||st.isSymbolicLink())abort('continuity_broker_dir_unsafe');
 if(process.platform!=='win32'&&(st.mode&0o007)!==0)abort('continuity_broker_dir_world_access');
 if(process.platform!=='win32'&&(st.mode&0o020)!==0)abort('continuity_broker_dir_group_writable');
 // Must NOT fall back to an arbitrary writable shared /tmp directory.
 if(process.platform!=='win32'&&st.uid!==process.getuid())abort('continuity_broker_wrong_owner');
}
export function bootstrapOwnerBroker({runtimeDir,password}={}){
 safeBrokerRoot(runtimeDir);
 if(typeof password!=='string'||password.length<12||password.length>1024)
  abort('continuity_broker_bootstrap_password_invalid');
 const existing=ownerAuthorityPublicKey(runtimeDir);
 if(existing)abort('continuity_broker_already_initialized');
 // Bootstrapping is a LOCAL service-identity operation, never an IPC action.
 return provisionContinuityOwnerAuthority({root:runtimeDir,signerDir:path.join(runtimeDir,'private'),password});
}
/**
 * Operator signing trust is provisioned manually by the broker's OS owner,
 * never over the group socket. No key auto-download from the Agent.
 * Account/device pin constrains a compromised operator service identity.
 */
export function provisionTrustedContinuityOperator({runtimeDir,accountId,deviceId,publicKeyPem}={}){
 safeBrokerRoot(runtimeDir);
 if(typeof accountId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(accountId)||
    typeof deviceId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId))
  abort('continuity_operator_trust_scope_invalid');
 const key=crypto.createPublicKey(publicKeyPem);
 if(key.asymmetricKeyType!=='ed25519')abort('continuity_operator_trust_key_invalid');
 const file=path.join(runtimeDir,'trusted-operator-relay.json');
 const data={schema:1,accountId,deviceId,
  publicKeyPem:key.export({format:'pem',type:'spki'})};
 fs.writeFileSync(file,JSON.stringify(data)+'\n',{mode:0o600,flag:'wx'});
 return {configured:true,accountId,deviceId};
}
function loadTrustedContinuityOperator(runtimeDir){
 const file=path.join(runtimeDir,'trusted-operator-relay.json');
 if(!fs.existsSync(file))return null;
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||(process.platform!=='win32'&&(st.mode&0o077)!==0))
  abort('continuity_operator_trust_file_unsafe');
 const trust=JSON.parse(fs.readFileSync(file,'utf8'));
 if(trust.schema!==1||!trust.accountId||!trust.deviceId)abort('continuity_operator_trust_invalid');
 const publicKey=crypto.createPublicKey(trust.publicKeyPem);
 if(publicKey.asymmetricKeyType!=='ed25519')abort('continuity_operator_trust_key_invalid');
 return {...trust,publicKey};
}
export function startOwnerBroker({runtimeDir,clientGroupMode=0o660,controller=null}={}){
 // node:net does not expose an independently audited, explicit Windows
 // pipe security descriptor. Do not open a privileged pipe on Windows until
 // the service SID / DACL adapter is implemented and physically checked.
 if(process.platform==='win32')abort('continuity_broker_windows_dacl_unverified');
 if(![0o600,0o660].includes(clientGroupMode))abort('continuity_broker_socket_mode_invalid');
 safeBrokerRoot(runtimeDir);
 const endpoint=ownerBrokerEndpoint(runtimeDir);
 if(process.platform!=='win32'&&fs.existsSync(endpoint))
  abort('continuity_broker_socket_exists_manual_recovery');
 if(!ownerAuthorityPublicKey(runtimeDir))abort('continuity_broker_not_bootstrapped');
 // One global rate bucket, not keyed by caller-supplied principal. Otherwise
 // an attacker could bypass throttling by changing the claimed username.
 let failedAttempts=[];
 const operatorTrust=controller?loadTrustedContinuityOperator(runtimeDir):null;
 const server=net.createServer(socket=>{
  let bytes=0,seen=false,buffer='';
  socket.setTimeout(3500,()=>socket.destroy());
  socket.on('error',()=>{});
  function reply(body){
   if(seen)return;seen=true;
   let serialized=JSON.stringify(body);
   if(Buffer.byteLength(serialized)>MAX_REPLY)
    serialized='{"ok":false,"error":"continuity_broker_reply_too_large"}';
   socket.end(serialized+'\n');
  }
  socket.on('data',chunk=>{
   bytes+=chunk.length;
   if(bytes>MAX_LINE)return reply({ok:false,error:'continuity_broker_request_too_large'});
   buffer+=chunk.toString('utf8');
   const pos=buffer.indexOf('\n');
   if(pos<0||seen)return;
   let request;
   try{request=JSON.parse(buffer.slice(0,pos));}catch{return reply({ok:false,error:'continuity_broker_bad_request'});}
   const action=request?.action,params=request?.data||{};
   // No request details, password, grant body or context content logged.
   if(action==='health')return reply({ok:true,result:{ready:true,protocol:1}});
   if(action==='publicKey'){
    const pk=ownerAuthorityPublicKey(runtimeDir);
    return reply({ok:true,result:{publicKeyPem:pk.export({type:'spki',format:'pem'})}});
   }
   if(action==='controller'){
    if(!controller)return reply({ok:false,error:'continuity_broker_controller_disabled'});
    // OS group membership authorizes bounded LOCAL actions only.
    // Never provide arbitrary SQL, owner boolean, worker transitions or
    // remoteBrief without a verified device A/B session-bound scope.
    const op=params.action,body=params.data||{};
    const actions={
     listProjects:()=>controller.projects(),
     getProject:()=>controller.project(body.projectId),
     createProject:()=>controller.createProject({projectName:body.name,workspace:body.workspace||''}),
     setModules:()=>controller.setModules(body.projectId,{memory:body.memory,codex:body.codex,expectedRevision:body.expectedRevision}),
     createTask:()=>controller.createTask(body.projectId,body.title),
     addSection:()=>controller.addSection(body.taskId,{title:body.title,dependsOn:body.dependsOn||[],resources:body.resources||[]}),
     getTask:()=>controller.task(body.taskId),
     checkpoint:()=>controller.checkpoint(body.projectId),
     memoryPut:()=>controller.memoryPut(body.projectId,{body:body.body,kind:body.kind,sourceRef:body.sourceRef}),
     memorySearch:()=>controller.memorySearch(body.projectId,body.query,{limit:body.limit||8}),
     memoryRecent:()=>{
      const p=controller.project(body.projectId);
      if(!p?.memory_enabled)abort('continuity_memory_disabled');
      return controller.db.prepare('SELECT f.id,f.kind,f.body,f.source_ref,f.created_at,a.confidence FROM memory_facts f JOIN memory_annotations a ON a.fact_id=f.id WHERE f.project_id=? ORDER BY f.created_at DESC LIMIT 16').all(p.id);
     },
     contextBrief:()=>controller.contextBrief(body.projectId,{query:body.query||'',maxChars:body.maxChars||4000})
    };
    if(!Object.hasOwn(actions,op))return reply({ok:false,error:'continuity_broker_controller_action_denied'});
    try{return reply({ok:true,result:actions[op]()});}
    catch(error){return reply({ok:false,error:/^continuity_/.test(error?.message||'')?error.message:'continuity_broker_controller_failed'});}
   }
   if(action==='remoteRead'){
    // No fallback to ordinary Controller actions. Only the operator that
    // authenticated a currently active A/B session can sign this scoped
    // request; the broker pins its account/device and validates consent.
    if(!controller||!operatorTrust)
     return reply({ok:false,error:'continuity_operator_trust_missing'});
    try{
     const projectId=params.projectId,query=params.query??'';
     const maxChars=params.maxChars??8000,requestId=params.requestId;
     const grant=verifyProjectReadDelegation({
      proof:params.proof,publicKey:operatorTrust.publicKey,
      accountId:operatorTrust.accountId,deviceId:operatorTrust.deviceId,
      projectId,requestId,query,maxChars
     });
     // Keep the in-memory and DB operation one-shot. Durable replay
     // table survives service restarts within the token validity window.
     const context=controller.tx(()=>{
      controller.db.prepare('INSERT INTO operator_read_nonces(request_id,project_id,expires_at) VALUES (?,?,?)')
       .run(grant.requestId,projectId,grant.expiresAt);
      return controller.remoteBrief(projectId,{query,maxChars});
     });
     return reply({ok:true,result:context});
    }catch(error){
     return reply({ok:false,error:/^continuity_/.test(error?.message||'')?error.message:'continuity_remote_read_denied'});
    }
   }
   if(!['signConsent','rekey','ownerConsent'].includes(action))
    return reply({ok:false,error:'continuity_broker_action_denied'});
   if(action==='ownerConsent'&&!controller)
    return reply({ok:false,error:'continuity_broker_controller_disabled'});
   const now=Date.now();
   failedAttempts=failedAttempts.filter(timestamp=>now-timestamp<600000);
   if(failedAttempts.length>=5)return reply({ok:false,error:'continuity_broker_rate_limited'});
   try{
    const result=action==='ownerConsent'
      ?(()=>{
         const p=controller.project(params.projectId);
         if(!p||!p.memory_enabled||p.revision!==params.revision)
          abort('continuity_broker_owner_scope_invalid');
         const proof=signContinuityConsent({root:runtimeDir,signerDir:path.join(runtimeDir,'private'),
          password:params.password,projectId:params.projectId,enabled:params.enabled,
          revision:params.revision,principal:params.principal});
         return controller.setRemoteReadConsent(params.projectId,{proof});
        })()
      :action==='signConsent'
      ?signContinuityConsent({root:runtimeDir,signerDir:path.join(runtimeDir,'private'),password:params.password,
        projectId:params.projectId,enabled:params.enabled,revision:params.revision,
        principal:params.principal})
      :rekeyContinuityOwnerAuthority({root:runtimeDir,signerDir:path.join(runtimeDir,'private'),
        oldPassword:params.oldPassword,newPassword:params.newPassword});
    failedAttempts=[];
    return reply({ok:true,result});
   }catch{
    failedAttempts.push(now);
    return reply({ok:false,error:'continuity_broker_owner_verification_failed'});
   }
  });
 });
 server.on('listening',()=>{
  if(process.platform!=='win32')fs.chmodSync(endpoint,clientGroupMode);
 });
 server.listen(endpoint);
 const stop=()=>new Promise(resolve=>server.close(()=>{
  if(process.platform!=='win32'&&fs.existsSync(endpoint))fs.unlinkSync(endpoint);
  resolve();
 }));
 return {server,stop,endpoint};
}
/**
 * Only the dedicated broker identity opens the canonical SQLite database
 * and the pinned Ed25519 public trust anchor. A device Agent group client
 * can use only the explicitly allowed local IPC actions.
 */
export async function startIsolatedControllerBroker({runtimeDir,clientGroupMode=0o660}={}){
 if(process.platform==='win32')abort('continuity_broker_windows_dacl_unverified');
 safeBrokerRoot(runtimeDir);
 const anchor=path.join(runtimeDir,'owner-authority-public.pem');
 if(!ownerAuthorityPublicKey(runtimeDir))abort('continuity_broker_not_bootstrapped');
 const dir=path.join(runtimeDir,'controller');
 if(fs.existsSync(dir)){
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)
   abort('continuity_broker_controller_dir_unsafe');
 }else fs.mkdirSync(dir,{mode:0o700});
 const dest=path.join(dir,'owner-authority-public.pem'), canonical=fs.readFileSync(anchor);
 if(fs.existsSync(dest)){
  const st=fs.lstatSync(dest);
  if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0)
   abort('continuity_broker_controller_anchor_unsafe');
  if(!fs.readFileSync(dest).equals(canonical))
   abort('continuity_broker_controller_anchor_mismatch');
 }else fs.writeFileSync(dest,canonical,{mode:0o600,flag:'wx'});
 const {ContinuityStore}=await import('./project-continuity-store.mjs');
 const store=new ContinuityStore({root:dir});
 try{
  const broker=startOwnerBroker({runtimeDir,clientGroupMode,controller:store});
  return {...broker,stop:async()=>{await broker.stop();store.close();}};
 }catch(error){store.close();throw error;}
}
export function ownerBrokerRequest({runtimeDir,action,data={},timeoutMs=3500}={}){
 const endpoint=ownerBrokerEndpoint(runtimeDir);
 if(!['health','publicKey','signConsent','rekey','controller','ownerConsent','remoteRead'].includes(action))
  return Promise.reject(Error('continuity_broker_action_denied'));
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>15000)
  return Promise.reject(Error('continuity_broker_timeout_invalid'));
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection(endpoint);
  let ended=false,response='';
  function finish(err,result){
   if(ended)return;ended=true;socket.destroy();
   if(err)reject(err);else resolve(result);
  }
  socket.setTimeout(timeoutMs,()=>finish(Error('continuity_broker_timeout')));
  socket.on('error',error=>finish(Error(['EACCES','EPERM'].includes(error.code)?'continuity_broker_access_denied':'continuity_broker_unavailable')));
  socket.on('connect',()=>{
   const payload=JSON.stringify({action,data})+'\n';
   if(Buffer.byteLength(payload)>MAX_LINE)return finish(Error('continuity_broker_request_too_large'));
   socket.write(payload);
  });
  socket.on('data',chunk=>{
   response+=chunk.toString('utf8');
   if(Buffer.byteLength(response)>MAX_REPLY)return finish(Error('continuity_broker_response_too_large'));
   const pos=response.indexOf('\n');
   if(pos<0)return;
   try{
    const msg=JSON.parse(response.slice(0,pos));
    if(msg.ok!==true)return finish(Error(msg.error||'continuity_broker_failed'));
    finish(null,msg.result);
   }catch(error){finish(error);}
  });
  socket.on('end',()=>{if(!ended)finish(Error('continuity_broker_closed'));});
 });
}
