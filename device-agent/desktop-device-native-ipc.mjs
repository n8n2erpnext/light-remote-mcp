// Native Desktop -> the enrolled same-user Agent. No browser listener,
// ambient Wall cookie, renderer bearer, arbitrary URL, command or file path.
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DESKTOP_DEVICE_PIPE='\\\\.\\pipe\\light-remote-desktop-v4-device';
const SOCKET='desktop-device.sock';
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const ACCESS=/^[A-Za-z0-9_-]{43}$/;
const MAX_REQUEST=32768,MAX_RESPONSE=262144;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const enrolled=x=>object(x)&&ID.test(x.accountId||'')&&ID.test(x.deviceId||'')&&!x.revoked&&!x.revokedAt;
const denied=()=>Object.assign(Error('desktop_device_unavailable'),{status:403});
export function desktopDeviceSocket({platform=process.platform,home=os.homedir()}={}){
 return platform==='win32'?DESKTOP_DEVICE_PIPE:path.join(home,'.light-remote',SOCKET);
}
export async function startDesktopDeviceIpc({enabled=false,readEnrollment,verifyOwner,dispatch,
 socketPath=desktopDeviceSocket()}={}){
 if(!enabled)return {enabled:false,close:async()=>{}};
 if([readEnrollment,verifyOwner,dispatch].some(x=>typeof x!=='function'))throw denied();
 if(process.platform==='win32'){
  if(socketPath!==DESKTOP_DEVICE_PIPE)throw denied();
 }else{
  if(!path.isAbsolute(socketPath)||path.basename(socketPath)!==SOCKET||Buffer.byteLength(socketPath)>102)throw denied();
  const parent=path.dirname(socketPath);fs.mkdirSync(parent,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(parent);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
    (typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw denied();
  try{fs.lstatSync(socketPath);throw denied();}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const sockets=new Set();
 const server=net.createServer(socket=>{
  if(sockets.size>=16){socket.destroy();return;}
  sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  socket.setTimeout(18000,()=>socket.destroy());
  let data=Buffer.alloc(0),done=false;
  socket.on('data',part=>{
   if(done)return;
   data=Buffer.concat([data,part]);
   if(data.length>MAX_REQUEST){done=true;socket.end('{"ok":false,"error":"desktop_request_too_large"}\n');return;}
   const end=data.indexOf(10);if(end<0)return;
   done=true;socket.pause();
   void (async()=>{
    try{
     if(end!==data.length-1)throw denied();
     const request=JSON.parse(data.subarray(0,end).toString('utf8'));
     const keys=['action','access','accountId','deviceId','payload'];
     if(!object(request)||Object.keys(request).length!==keys.length||
       !Object.keys(request).every(k=>keys.includes(k))||!object(request.payload)||
       typeof request.action!=='string'||!/^[a-z][a-z.-]{1,63}$/.test(request.action)||
       !ACCESS.test(request.access||'')||!ID.test(request.accountId||'')||
       !(ID.test(request.deviceId||'')||(request.action==='device.read'&&request.deviceId===null)))throw denied();
     const before=readEnrollment();
     if(!enrolled(before)||before.accountId!==request.accountId||
       (request.deviceId!==null&&before.deviceId!==request.deviceId))throw denied();
     const owner=await verifyOwner(request.access);
     const guard=()=>{
      const current=readEnrollment();
      if(socket.destroyed||owner?.verified!==true||owner.accountId!==before.accountId||!enrolled(current)||
        current.accountId!==before.accountId||current.deviceId!==before.deviceId||
        current.publicIdentityKey!==before.publicIdentityKey||current.enrollmentId!==before.enrollmentId||
        current.deviceToken!==before.deviceToken)throw denied();
     };
     guard();
     const view=await dispatch(request.action,request.payload,guard);
     guard();
     const response=JSON.stringify({ok:true,accountId:before.accountId,deviceId:before.deviceId,view})+'\n';
     if(Buffer.byteLength(response)>MAX_RESPONSE)throw Error('desktop_response_too_large');
     socket.end(response);
    }catch(e){
     // Codes only. Never return raw upstream bodies, exception text, headers,
     // stack traces or the native Owner access value.
     const code=typeof e?.message==='string'&&/^(?:desktop|gold|memory|codex)_[a-z0-9_]{1,100}$/.test(e.message)
      ?e.message:'desktop_device_unavailable';
     socket.end(JSON.stringify({ok:false,error:code,status:[400,403,404,409,503].includes(e.status)?e.status:503})+'\n');
    }
   })();
  });
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen({path:socketPath,readableAll:false,writableAll:false,exclusive:true},resolve);
 });
 if(process.platform!=='win32')fs.chmodSync(socketPath,0o600);
 return {enabled:true,close:async()=>{
  for(const socket of sockets)socket.destroy();
  await new Promise(resolve=>server.close(resolve));
 }};
}
