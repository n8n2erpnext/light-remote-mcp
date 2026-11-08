/**
 * Desktop V4 -> SAME-HOST enrolled Agent Owner B approval.
 * OS-private, never an HTTP/Wall endpoint. Default OFF.
 * Every request requires a live GoldABV2 native Owner token, matching the
 * local enrolled account; Operator still verifies Agent Ed25519 and A/B V2.
 */
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ABV2_NATIVE_WIN_PIPE_V4='\\\\.\\pipe\\light-remote-desktop-v4-abv2';
const UNIX_FILE='desktop-v4-abv2.sock';
const ACCESS=/^[A-Za-z0-9_-]{43}$/;
const REQUEST=/^av2_[a-f0-9]{32}$/;
const B=/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const CONSENT=/^[A-Za-z0-9_-]{32}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const LIMIT=1800;
const TIMEOUT=16000;
const bad=()=>Object.assign(new Error('desktop_abv2_native_unavailable'),{
  code:'desktop_abv2_native_unavailable'
});
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&
  Object.keys(x).every(key=>keys.includes(key));
const valid=(re,value)=>typeof value==='string'&&re.test(value);

export function desktopAbv2NativeSocketPathV4({
 platform=process.platform,home=os.homedir()
}={}){
 return platform==='win32'?ABV2_NATIVE_WIN_PIPE_V4:
   path.join(home,'.light-remote',UNIX_FILE);
}
function checkUnixParent(socketPath){
 if(process.platform==='win32')return;
 if(!path.isAbsolute(socketPath)||Buffer.byteLength(socketPath)>102)throw bad();
 const dir=path.dirname(socketPath);
 fs.mkdirSync(dir,{mode:0o700,recursive:true});
 const stat=fs.lstatSync(dir);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
   (typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw bad();
 try{fs.lstatSync(socketPath);throw bad();}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
const enrolled=x=>record(x)&&valid(ID,x.accountId)&&valid(ID,x.deviceId)&&
  x.revoked!==true&&!x.revokedAt;
function pendingRow(x){
 if(!record(x)||!valid(REQUEST,x.requestId)||
    !Number.isSafeInteger(x.attempt)||x.attempt<1||
    !Number.isSafeInteger(x.expiresAt)||x.expiresAt<=0)return null;
 return {
  requestId:x.requestId,attempt:x.attempt,expiresAt:x.expiresAt,
  aCode:typeof x.aCode==='string'&&x.aCode.length<=32?x.aCode:null
 };
}
export async function startDesktopAbv2NativeAgentIpcV4({
 enabled=false,readEnrollment,verifyOwner,preview,approve,
 socketPath=desktopAbv2NativeSocketPathV4()
}={}){
 if(enabled!==true)return Object.freeze({enabled:false,close:async()=>{}});
 if([readEnrollment,verifyOwner,preview,approve].some(f=>typeof f!=='function')||
    typeof socketPath!=='string'||
    (process.platform==='win32'
      ?socketPath!==ABV2_NATIVE_WIN_PIPE_V4
      :path.basename(socketPath)!==UNIX_FILE))throw bad();
 checkUnixParent(socketPath);
 const server=net.createServer({allowHalfOpen:false});
 let closed=false;
 server.on('connection',socket=>{
  socket.setTimeout(TIMEOUT,()=>socket.destroy());
  socket.on('error',()=>{});
  let data=Buffer.alloc(0),done=false;
  socket.on('data',part=>{
   if(done)return;
   data=Buffer.concat([data,part]);
   if(data.length>LIMIT){done=true;socket.end('{"ok":false}\n');return;}
   const newline=data.indexOf(10);
   if(newline<0)return;
   done=true;socket.pause();
   void (async()=>{
    try{
     if(newline!==data.length-1)throw bad();
     const req=JSON.parse(data.subarray(0,newline).toString('utf8'));
     const isPending=exact(req,['action','access'])&&req.action==='pending';
     const isApprove=exact(req,
      ['action','access','requestId','expectedAttempt','bCode','consentCode'])&&
      req.action==='approve'&&valid(REQUEST,req.requestId)&&
      Number.isSafeInteger(req.expectedAttempt)&&req.expectedAttempt>0&&
      valid(B,req.bCode)&&
      (req.consentCode===''||valid(CONSENT,req.consentCode));
     if(!(isPending||isApprove)||!valid(ACCESS,req.access))throw bad();
     const before=readEnrollment();
     if(!enrolled(before))throw bad();
     const owner=await verifyOwner(req.access);
     if(!record(owner)||owner.verified!==true||
        owner.accountId!==before.accountId)throw bad();
     const signed=await preview(owner);
     if(signed?.ok!==true||signed.deviceId!==before.deviceId||
       !Array.isArray(signed.pending)||signed.pending.length>5||
       typeof signed.ownerConsentRequired!=='boolean'||
       typeof signed.ownerApproveEnabled!=='boolean')throw bad();
     const rows=signed.pending.map(pendingRow);
     if(rows.some(row=>!row))throw bad();
     const current=readEnrollment();
     if(!enrolled(current)||current.accountId!==before.accountId||
       current.deviceId!==before.deviceId)throw bad();
     if(isPending){
      socket.end(JSON.stringify({
       ok:true,deviceId:before.deviceId,
       shortId:typeof signed.shortId==='string'&&
         /^[0-9A-HJKMNP-TV-Z]{6}$/.test(signed.shortId)?signed.shortId:null,
       ownerApproveEnabled:signed.ownerApproveEnabled===true,
       ownerConsentRequired:signed.ownerConsentRequired===true,
       pending:rows
      })+'\n');
      return;
     }
     if(signed.ownerApproveEnabled!==true||!rows.some(row=>
        row.requestId===req.requestId&&row.attempt===req.expectedAttempt))throw bad();
     if(signed.ownerConsentRequired===true&&!valid(CONSENT,req.consentCode))
       throw bad();
     const result=await approve(owner,{requestId:req.requestId,
      expectedAttempt:req.expectedAttempt,bCode:req.bCode,
      consentCode:req.consentCode});
     const after=readEnrollment();
     if(!enrolled(after)||after.accountId!==before.accountId||
       after.deviceId!==before.deviceId||
       result?.ok!==true||result.state!=='granted'||
       result.requestId!==req.requestId)throw bad();
     socket.end(JSON.stringify({
      ok:true,state:'granted',requestId:req.requestId,
      expiresAt:Number.isSafeInteger(result.expiresAt)?result.expiresAt:null
     })+'\n');
    }catch{socket.end('{"ok":false}\n');}
   })();
  });
 });
 try{
  await new Promise((resolve,reject)=>{
   const error=e=>{server.off('listening',ready);reject(e);};
   const ready=()=>{server.off('error',error);resolve();};
   server.once('error',error);server.once('listening',ready);
   server.listen(process.platform==='win32'
     ?{path:socketPath,readableAll:false,writableAll:false,exclusive:true}
     :{path:socketPath,exclusive:true});
  });
  if(process.platform!=='win32'){
   fs.chmodSync(socketPath,0o600);
   const stat=fs.lstatSync(socketPath);
   if(!stat.isSocket()||(stat.mode&0o077)!==0)throw bad();
  }
 }catch{try{server.close();}catch{}throw bad();}
 return Object.freeze({enabled:true,close:async()=>{
  if(closed)return;closed=true;
  await new Promise(resolve=>server.close(resolve));
 }});
}
