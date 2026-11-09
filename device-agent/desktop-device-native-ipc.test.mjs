import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {startDesktopDeviceIpc,DESKTOP_DEVICE_PIPE} from './desktop-device-native-ipc.mjs';
const access='A'.repeat(43);
async function send(endpoint,request){
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection(endpoint);let data='';
  socket.setTimeout(2500,()=>{socket.destroy();reject(Error('timeout'));});
  socket.on('error',reject);socket.on('connect',()=>socket.write(JSON.stringify(request)+'\n'));
  socket.on('data',part=>{data+=part;});socket.on('end',()=>{try{resolve(JSON.parse(data));}catch(e){reject(e);}});
 });
}
test('default off and native account/device fence on a real private socket',async t=>{
 assert.equal((await startDesktopDeviceIpc()).enabled,false);
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'dd-'));
 const endpoint=process.platform==='win32'?DESKTOP_DEVICE_PIPE:path.join(parent,'desktop-device.sock');
 let enrollment={accountId:'owner',deviceId:'local',deviceToken:'PRIVATE_DEVICE_SECRET'};
 let calls=0;
 const listener=await startDesktopDeviceIpc({enabled:true,socketPath:endpoint,
  readEnrollment:()=>({...enrollment}),verifyOwner:async token=>token===access?{verified:true,accountId:'owner'}:null,
  dispatch:async(action,payload,guard)=>{calls++;if(payload.rotate){enrollment={...enrollment,deviceId:'changed'};guard();}return {deviceName:'Live device'};}});
 t.after(async()=>{await listener.close();fs.rmSync(parent,{recursive:true,force:true});});
 const req={action:'device.read',access,accountId:'owner',deviceId:null,payload:{}};
 const response=await send(endpoint,req);
 assert.equal(response.ok,true);assert.equal(response.deviceId,'local');
 assert.equal(JSON.stringify(response).includes(access),false);
 assert.equal(JSON.stringify(response).includes('PRIVATE_DEVICE_SECRET'),false);
 for(const wrong of [{...req,access:'B'.repeat(43)},{...req,accountId:'other'},
  {...req,deviceId:'other'},{...req,action:'module.configure'},
  {...req,url:'http://arbitrary'}])assert.equal((await send(endpoint,wrong)).ok,false);
 assert.equal(calls,1);
 assert.equal((await send(endpoint,{...req,deviceId:'local',payload:{rotate:true}})).ok,false);
 if(process.platform!=='win32')assert.equal(fs.statSync(endpoint).mode&0o077,0);
});
