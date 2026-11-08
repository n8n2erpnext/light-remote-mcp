/**
 * T04b9c3b2 — private OS-local Desktop -> enrolled Device Agent SSO delivery.
 *
 * This listener is SOURCE-ONLY and is NOT imported by operator-agent.mjs.
 * It is NOT HTTP and is invisible to browser JavaScript, Local Wall routes,
 * and the Agent A/B remote-command channel. Windows uses an OS named pipe
 * with no readableAll/writableAll grants; Unix uses a mode-0600 socket in
 * a private mode-0700 directory owned by the same OS account.
 *
 * It accepts exactly one bounded JSON line containing a purpose-scoped 45s
 * ticket, non-bearer challenge, and exact already-enrolled local Device ID.
 * The Device Agent's own Ed25519 signer still verifies the ticket at
 * Operator; this OS IPC never grants remote privileges.
 *
 * Do not mount until native owner credential generation fencing, OS-user
 * identity and an explicit Owner-initiated UI flow are independently accepted.
 */
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const MAX_BYTES=1536;
const TIMEOUT_MS=5000;
const UNIX_FILE='desktop-v4-owner-wall-sso.sock';
export const NATIVE_WALL_SSO_WIN_PIPE_V4=String.raw`\\.\pipe\light-remote-desktop-v4-owner-wall-sso`;
const denied=()=>Object.assign(new Error('native_wall_sso_ipc_denied'),{
  code:'native_wall_sso_ipc_denied'
});
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).length===keys.length&&
  Object.keys(x).every(key=>keys.includes(key));
const valid=(regex,value)=>typeof value==='string'&&regex.test(value);

export function nativeWallSsoSocketPathV4({
  platform=process.platform,home=os.homedir()
}={}){
  return platform==='win32'?NATIVE_WALL_SSO_WIN_PIPE_V4:
    path.join(home,'.light-remote',UNIX_FILE);
}
function ensurePrivateUnixParent(socketPath){
  if(process.platform==='win32')return;
  if(!path.isAbsolute(socketPath)||Buffer.byteLength(socketPath)>102)
    throw denied();
  const parent=path.dirname(socketPath);
  fs.mkdirSync(parent,{mode:0o700,recursive:true});
  const stat=fs.lstatSync(parent);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (stat.mode&0o077)!==0||
     (typeof process.getuid==='function'&&stat.uid!==process.getuid()))
    throw denied();
  // Refuse to unlink someone else's preexisting socket or symlink; native
  // clients must never be redirected to an attacker-controlled endpoint.
  try{fs.lstatSync(socketPath);throw denied();}
  catch(error){if(error?.code!=='ENOENT')throw error;}
}
export async function startNativeWallSsoAgentIpcV4({
  enabled=false,wall,getEnrollment,socketPath=nativeWallSsoSocketPathV4()
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,path:null,close:async()=>{}
  });
  if(typeof wall?.desktopSsoBootstrap?.approveTrustedNative!=='function'||
     typeof wall?.desktopSsoBootstrap?.pendingForNative!=='function'||
     typeof getEnrollment!=='function'||typeof socketPath!=='string'||
     (process.platform==='win32'
       ?socketPath!==NATIVE_WALL_SSO_WIN_PIPE_V4
       :path.basename(socketPath)!==UNIX_FILE))
    throw denied();
  ensurePrivateUnixParent(socketPath);
  const server=net.createServer({allowHalfOpen:false});
  let closed=false;
  server.on('connection',socket=>{
    socket.setTimeout(TIMEOUT_MS,()=>socket.destroy());
    socket.on('error',()=>{});
    let buffer=Buffer.alloc(0),finished=false;
    socket.on('data',bytes=>{
      if(finished)return;
      buffer=Buffer.concat([buffer,bytes]);
      if(buffer.length>MAX_BYTES){finished=true;socket.end('{"ok":false}\n');return;}
      const newline=buffer.indexOf(10);
      if(newline<0)return;
      finished=true;
      socket.pause();
      // Do not echo ticket, challenge or enrollment into error messages.
      const input=buffer.subarray(0,newline).toString('utf8');
      void (async()=>{
        try{
          if(newline!==buffer.length-1)throw denied();
          const row=JSON.parse(input);
          // A native Owner can request the ONE current non-bearer browser
          // challenge, but cannot list accounts, tickets or Wall cookies.
          if(exact(row,['action'])&&row.action==='pending'){
            const before=getEnrollment();
            if(before?.revoked===true||before?.revokedAt||
               !valid(ID,before?.accountId)||!valid(ID,before?.deviceId))
              throw denied();
            const pending=wall.desktopSsoBootstrap.pendingForNative();
            const after=getEnrollment();
            if(!pending||!valid(TOKEN,pending.challenge)||
               !Number.isSafeInteger(pending.expiresAt)||
               after?.revoked===true||after?.revokedAt||
               after?.deviceId!==before.deviceId||
               after?.accountId!==before.accountId)throw denied();
            socket.end(JSON.stringify({
              ok:true,pending:true,challenge:pending.challenge,
              deviceId:before.deviceId,expiresAt:pending.expiresAt
            })+'\n');
            return;
          }
          if(!exact(row,['challenge','ticket','deviceId'])||
             !valid(TOKEN,row.challenge)||!valid(TOKEN,row.ticket)||
             !valid(ID,row.deviceId))throw denied();
          const before=getEnrollment();
          if(before?.revoked===true||before?.revokedAt||
             !valid(ID,before?.deviceId)||!valid(ID,before?.accountId)||
             before.deviceId!==row.deviceId)throw denied();
          const result=await wall.desktopSsoBootstrap.approveTrustedNative({
            challenge:row.challenge,ticket:row.ticket
          });
          const after=getEnrollment();
          if(result?.ready!==true||after?.revoked===true||after?.revokedAt||
             after?.deviceId!==before.deviceId||
             after?.accountId!==before.accountId)
            throw denied();
          socket.end('{"ok":true}\n');
        }catch{socket.end('{"ok":false}\n');}
      })();
    });
  });
  try{
    await new Promise((resolve,reject)=>{
      const onError=error=>{server.off('listening',onListen);reject(error);};
      const onListen=()=>{server.off('error',onError);resolve();};
      server.once('error',onError);
      server.once('listening',onListen);
      server.listen(process.platform==='win32'
        ?{path:socketPath,readableAll:false,writableAll:false,exclusive:true}
        :{path:socketPath,exclusive:true});
    });
    if(process.platform!=='win32'){
      fs.chmodSync(socketPath,0o600);
      const stat=fs.lstatSync(socketPath);
      if(!stat.isSocket()||(stat.mode&0o077)!==0)throw denied();
    }
  }catch(error){
    try{server.close();}catch{}
    throw denied();
  }
  async function close(){
    if(closed)return;
    closed=true;
    await new Promise(resolve=>server.close(resolve));
    // Node automatically unlinks Unix socket on close. Do not delete a
    // replacement file someone put in its place after the listener exits.
  }
  return Object.freeze({enabled:true,path:socketPath,close});
}
