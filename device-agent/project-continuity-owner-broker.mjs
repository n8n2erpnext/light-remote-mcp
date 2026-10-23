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

const MAX_LINE=8192,MAX_REPLY=8192;
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
export function startOwnerBroker({runtimeDir,clientGroupMode=0o660}={}){
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
   if(!['signConsent','rekey'].includes(action))
    return reply({ok:false,error:'continuity_broker_action_denied'});
   const now=Date.now();
   failedAttempts=failedAttempts.filter(timestamp=>now-timestamp<600000);
   if(failedAttempts.length>=5)return reply({ok:false,error:'continuity_broker_rate_limited'});
   try{
    const result=action==='signConsent'
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
export function ownerBrokerRequest({runtimeDir,action,data={},timeoutMs=3500}={}){
 const endpoint=ownerBrokerEndpoint(runtimeDir);
 if(!['health','publicKey','signConsent','rekey'].includes(action))
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
