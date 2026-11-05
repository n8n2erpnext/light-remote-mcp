import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  nativeWallSsoSocketPathV4,startNativeWallSsoAgentIpcV4,
  NATIVE_WALL_SSO_WIN_PIPE_V4
} from './desktop-wall-sso-native-ipc-v4.mjs';

const C='C'.repeat(43),T='T'.repeat(43),DEVICE='dev_local_01';
const invalid=e=>e?.code==='native_wall_sso_ipc_denied';
const line=obj=>JSON.stringify(obj)+'\n';
const packet=()=>({challenge:C,ticket:T,deviceId:DEVICE});

async function send(socketPath,value){
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({path:socketPath});
    let data='';
    socket.setTimeout(3000,()=>socket.destroy(Error('client_timeout')));
    socket.on('error',reject);
    socket.on('data',part=>data+=part.toString('utf8'));
    socket.on('end',()=>resolve(data));
    socket.on('connect',()=>socket.write(
      typeof value==='string'?value:line(value)
    ));
  });
}
async function fixture(){
  let approved=0,revoked=false;
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-t04-ipc-'));
  fs.chmodSync(tmp,0o700);
  const wall={desktopSsoBootstrap:{
    pendingForNative:()=>({challenge:C,expiresAt:Date.now()+45000}),
    async approveTrustedNative({challenge,ticket}){
      assert.equal(challenge,C);assert.equal(ticket,T);
      approved++;
      if(approved>1)throw Error('one_use_browser_challenge');
      return {ready:true};
    }
  }};
  const socketPath=process.platform==='win32'
    ?NATIVE_WALL_SSO_WIN_PIPE_V4:
    path.join(tmp,'.light-remote','desktop-v4-owner-wall-sso.sock');
  const server=await startNativeWallSsoAgentIpcV4({
    enabled:true,wall,socketPath,
    getEnrollment:()=>({
      accountId:'acct_owner',deviceId:DEVICE,revoked
    })
  });
  return {server,socketPath,tmp,wall,
    approvals:()=>approved,revoke:()=>revoked=true,
    close:async()=>{
      await server.close();
      fs.rmSync(tmp,{recursive:true,force:true});
    }
  };
}
test('T04b9c3b2 default OFF creates no pipe or Agent channel',async()=>{
  let touched=0;
  const svc=await startNativeWallSsoAgentIpcV4({
    enabled:false,wall:{
      get desktopSsoBootstrap(){touched++;throw Error('must stay OFF');}
    }
  });
  assert.deepEqual({enabled:svc.enabled,path:svc.path},
    {enabled:false,path:null});
  assert.equal(touched,0);
  await svc.close();
});
test('T04b9c3b2 exact OS-private IPC delivers ticket ONLY to enrolled Agent',async()=>{
  const f=await fixture();
  try{
    const reply=await send(f.socketPath,packet());
    assert.equal(reply,'{"ok":true}\n');
    assert.equal(f.approvals(),1);
    assert.equal(reply.includes(C)||reply.includes(T),false);
    if(process.platform!=='win32'){
      const stat=fs.statSync(f.socketPath);
      assert.ok(stat.isSocket());
      assert.equal(stat.mode&0o077,0,'Unix socket is owner-only 0600');
      assert.equal(fs.statSync(path.dirname(f.socketPath)).mode&0o077,0);
    }
  }finally{await f.close();}
});
test('T04b9c3b2 no Agent approval for malformed, oversized or privilege data',async()=>{
  const f=await fixture();
  try{
    for(const value of [
      {},{...packet(),accountId:'attacker'},
      {...packet(),agentGrant:'BYPASS'},
      {...packet(),deviceId:'dev_other'},
      {...packet(),ticket:'bad'},
      {...packet(),challenge:'bad'},
      '{invalid json}\n',
      'X'.repeat(1536)+'\n'
    ]){
      assert.equal(await send(f.socketPath,value),'{"ok":false}\n');
    }
    assert.equal(f.approvals(),0);
  }finally{await f.close();}
});
test('T04b9c3b2 revoked enrollment denies ticket before Agent redemption',async()=>{
  const f=await fixture();
  try{
    f.revoke();
    assert.equal(await send(f.socketPath,packet()),'{"ok":false}\n');
    assert.equal(f.approvals(),0);
  }finally{await f.close();}
});
test('T04b9c3b2 duplicate ticket/challenge cannot promote second Wall cookie',async()=>{
  const f=await fixture();
  try{
    assert.equal(await send(f.socketPath,packet()),'{"ok":true}\n');
    assert.equal(await send(f.socketPath,packet()),'{"ok":false}\n');
    assert.equal(f.approvals(),2,'second is rejected by in-process one-shot approver');
  }finally{await f.close();}
});
test('T04b9c3b2 existing or unsafe OS socket never overwritten',async()=>{
  if(process.platform==='win32')return;
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-t04-ipc-symlink-'));
  const dirname=path.join(temp,'.light-remote');
  fs.mkdirSync(dirname,{mode:0o700});
  const socket=path.join(dirname,'desktop-v4-owner-wall-sso.sock');
  fs.symlinkSync('/etc/passwd',socket);
  const wall={desktopSsoBootstrap:{approveTrustedNative:async()=>({ready:true})}};
  try{
    await assert.rejects(startNativeWallSsoAgentIpcV4({
      enabled:true,wall,getEnrollment:()=>({accountId:'x',deviceId:DEVICE}),
      socketPath:socket
    }),invalid);
    fs.unlinkSync(socket);
    fs.chmodSync(dirname,0o777);
    await assert.rejects(startNativeWallSsoAgentIpcV4({
      enabled:true,wall,getEnrollment:()=>({accountId:'x',deviceId:DEVICE}),
      socketPath:socket
    }),invalid);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('T04b9c3b2 fixed pipe identity cannot be replaced with TCP/browser URL',async()=>{
  assert.equal(NATIVE_WALL_SSO_WIN_PIPE_V4, String.raw`\\.\pipe\light-remote-desktop-v4-owner-wall-sso`);
  assert.equal(nativeWallSsoSocketPathV4({
    platform:'win32',home:'/anything'
  }),NATIVE_WALL_SSO_WIN_PIPE_V4);
  // Node's path.join follows the runner OS even when injecting a different
  // platform selector. Assert the same owner-scoped path portably.
  assert.equal(nativeWallSsoSocketPathV4({
    platform:'linux',home:'/tmp/owner'
  }),path.join('/tmp/owner','.light-remote','desktop-v4-owner-wall-sso.sock'));
  await assert.rejects(startNativeWallSsoAgentIpcV4({
    enabled:true,wall:{desktopSsoBootstrap:{approveTrustedNative:()=>{}}},
    getEnrollment:()=>({}),socketPath:'http://127.0.0.1:5491'
  }),invalid);
});

test('T04b9c3b2 private IPC is never mounted in running Agent or browser',()=>{
  const agent=fs.readFileSync(
    fileURLToPath(new URL('./operator-agent.mjs',import.meta.url)),'utf8'
  );
  const wall=fs.readFileSync(
    fileURLToPath(new URL('./local-wall.mjs',import.meta.url)),'utf8'
  );
  assert.equal(agent.includes("desktop-wall-sso-native-ipc-v4.mjs"),false);
  assert.equal(wall.includes('startNativeWallSsoAgentIpcV4'),false);
  assert.equal(wall.includes('approveTrustedNative(req'),false);
});

test('T04b9c3c private pending returns one challenge but never a ticket',async()=>{
  const f=await fixture();
  try{
    const raw=await send(f.socketPath,{action:'pending'});
    const row=JSON.parse(raw);
    assert.deepEqual(Object.keys(row).sort(),
      ['challenge','deviceId','expiresAt','ok','pending']);
    assert.equal(row.challenge,C);
    assert.equal(row.deviceId,DEVICE);
    assert.equal(row.ok,true);
    assert.equal(row.pending,true);
    assert.ok(row.expiresAt>Date.now());
    assert.equal(raw.includes(T),false);
    assert.equal(raw.includes('accountId'),false);
    assert.equal(f.approvals(),0);
    for(const value of [
      {action:'pending',ticket:T},
      {action:'list'},
      {action:'pending',agentGrant:'yes'}
    ])assert.deepEqual(JSON.parse(await send(f.socketPath,value)),{ok:false});
    assert.equal(f.approvals(),0);
  }finally{await f.close();}
});
test('T04b9c3c revoked device cannot even read pending browser challenge',async()=>{
  const f=await fixture();
  try{
    f.revoke();
    assert.deepEqual(JSON.parse(await send(f.socketPath,{action:'pending'})),
      {ok:false});
    assert.equal(f.approvals(),0);
  }finally{await f.close();}
});
