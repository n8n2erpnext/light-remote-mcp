import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {
 desktopAbv2NativeSocketPathV4,startDesktopAbv2NativeAgentIpcV4,
 ABV2_NATIVE_WIN_PIPE_V4
} from './desktop-abv2-native-ipc-v4.mjs';

const REQUEST='av2_'+'a'.repeat(32);
const ACCESS='B'.repeat(43);
const B='4RFG-F3C6';
const enrollment={accountId:'acct_owner',deviceId:'dev_123',revoked:false};
const signed={
 ok:true,deviceId:'dev_123',shortId:'R01KAP',
 ownerApproveEnabled:true,ownerConsentRequired:false,
 pending:[{requestId:REQUEST,attempt:2,expiresAt:Date.now()+60000,
   aCode:'R01KAP-ABCDE',requester:{private:'NOT_EXPOSED'}}]
};
async function send(socketPath,payload){
 return await new Promise((resolve,reject)=>{
  const socket=net.createConnection(socketPath);
  let received='';
  socket.setTimeout(2500,()=>{socket.destroy();reject(Error('timeout'));});
  socket.on('error',reject);
  socket.on('connect',()=>socket.write(JSON.stringify(payload)+'\n'));
  socket.on('data',chunk=>{received+=chunk.toString('utf8');});
  socket.on('end',()=>{try{resolve(JSON.parse(received));}catch(e){reject(e)}});
 });
}
test('OS-private path chooses Windows pipe or same-user Unix socket',()=>{
 assert.equal(desktopAbv2NativeSocketPathV4({platform:'win32'}),
  ABV2_NATIVE_WIN_PIPE_V4);
 assert.equal(desktopAbv2NativeSocketPathV4({platform:'linux',home:'/home/alice'}),
  path.join('/home/alice','.light-remote','desktop-v4-abv2.sock'));
});
test('default disabled creates no listener',async()=>{
 const service=await startDesktopAbv2NativeAgentIpcV4();
 assert.equal(service.enabled,false);
 await service.close();
});
test('ABV2 native pending/Approve verifies Owner, enrollment and returns no secrets',async(t)=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-v4-abv2-'));
 const parent=path.join(tmp,'.light-remote');
 fs.mkdirSync(parent,{mode:0o700});
 const socketPath=process.platform==='win32'?ABV2_NATIVE_WIN_PIPE_V4:
   path.join(parent,'desktop-v4-abv2.sock');
 let approvals=0,checks=0;
 const service=await startDesktopAbv2NativeAgentIpcV4({
  enabled:true,socketPath,readEnrollment:()=>({...enrollment}),
  verifyOwner:async(access)=>{
   checks++;
   return access===ACCESS?{verified:true,accountId:'acct_owner'}:null;
  },
  preview:async()=>signed,
  approve:async(_owner,params)=>{
   assert.equal(params.requestId,REQUEST);
   assert.equal(params.expectedAttempt,2);
   assert.equal(params.bCode,B);
   approvals++;return {ok:true,state:'granted',requestId:REQUEST,expiresAt:123456};
  }
 });
 t.after(async()=>{await service.close();fs.rmSync(tmp,{recursive:true,force:true});});
 if(process.platform!=='win32'){
  assert.equal(fs.statSync(parent).mode&0o077,0);
  assert.equal(fs.statSync(socketPath).mode&0o077,0);
 }
 const preview=await send(socketPath,{action:'pending',access:ACCESS});
 assert.equal(preview.ok,true);
 assert.equal(preview.pending.length,1);
 assert.equal(preview.deviceId,enrollment.deviceId);
 assert.equal(preview.pending[0].aCode,'R01KAP-ABCDE');
 assert.equal(JSON.stringify(preview).includes('NOT_EXPOSED'),false);
 assert.equal(JSON.stringify(preview).includes(ACCESS),false);
 assert.deepEqual(await send(socketPath,{action:'pending',access:'C'.repeat(43)}),
  {ok:false});
 assert.deepEqual(await send(socketPath,{action:'approve',access:ACCESS,
  requestId:REQUEST,expectedAttempt:1,bCode:B,consentCode:''}),{ok:false});
 const granted=await send(socketPath,{action:'approve',access:ACCESS,
  requestId:REQUEST,expectedAttempt:2,bCode:B,consentCode:''});
 assert.deepEqual(granted,{ok:true,state:'granted',requestId:REQUEST,expiresAt:123456});
 assert.equal(approvals,1);
 assert.ok(checks>=4);
});
test('revoked enrollment blocks native request before Owner check',async(t)=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-v4-abv2-revoked-'));
 const parent=path.join(tmp,'.light-remote');
 fs.mkdirSync(parent,{mode:0o700});
 let verified=false;
 const service=await startDesktopAbv2NativeAgentIpcV4({
  enabled:true,socketPath:process.platform==='win32'?ABV2_NATIVE_WIN_PIPE_V4:
    path.join(parent,'desktop-v4-abv2.sock'),
  readEnrollment:()=>({...enrollment,revoked:true}),
  verifyOwner:async()=>{verified=true;return {verified:true,accountId:'acct_owner'};},
  preview:async()=>signed,approve:async()=>({ok:true})
 });
 t.after(async()=>{await service.close();fs.rmSync(tmp,{recursive:true,force:true});});
 const denied=await send(process.platform==='win32'?ABV2_NATIVE_WIN_PIPE_V4:
   path.join(parent,'desktop-v4-abv2.sock'),{action:'pending',access:ACCESS});
 assert.deepEqual(denied,{ok:false});
 assert.equal(verified,false);
});
