import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {normalizeMemoryAccountSyncInput} from '../../operator-host/gold-memory-account-sync-policy.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-account-ui-'));
const accountId='shared-gold-account';
const roster=[
  {accountId,deviceId:'arm',displayName:'VPS-ARM',state:'online',platform:'linux'},
  {accountId,deviceId:'win',displayName:'DESKTOP-VA16D27',state:'online',platform:'win32'}
];
const instances=[],servers=[];
let policy={enabled:false,revision:0,devices:roster.map(x=>({deviceId:x.deviceId,selected:false,mode:'auto',manualRequestSeq:0}))};
const provider=async input=>{
  if(input.action==='get')return {ok:true,policy:structuredClone(policy)};
  if(input.action==='set'){
    const d=normalizeMemoryAccountSyncInput(input.policy,accountId,roster);
    if(d.expectedRevision!==policy.revision)
      throw Object.assign(new Error('memory_account_sync_revision_conflict'),{status:409});
    policy={enabled:d.enabled,revision:policy.revision+1,
      devices:d.devices.map(x=>({...x,manualRequestSeq:policy.devices.find(d=>d.deviceId===x.deviceId)?.manualRequestSeq||0}))};
    return {ok:true,policy:structuredClone(policy)};
  }
  if(input.action==='manual'){
    const target=policy.devices.find(x=>x.deviceId===input.deviceId);
    if(!policy.enabled||!target?.selected||target.mode!=='manual')
      throw Object.assign(new Error('memory_sync_manual_not_enabled'),{status:409});
    target.manualRequestSeq++;
    return {ok:true,manual:{deviceId:target.deviceId,manualRequestSeq:target.manualRequestSeq}};
  }
  throw Error('unrecognized account action');
};
const auth={enabled:true,identity:req=>req.headers['x-test-owner']==='yes'?{username:'owner'}:null,
  csrfForRequest:()=> 'test-csrf',verifyRequestCsrf:(_req,token)=>token==='test-csrf'};
async function create(deviceId){
  const modules=createGoldWallModules({file:path.join(root,deviceId+'.sqlite'),
    scopeIdentity:{accountId,deviceId}});
  modules.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  instances.push(modules);
  const wall=startLocalWall({host:'127.0.0.1',port:0,modules,auth,
    getMemoryAccountSyncPolicy:provider,
    getMemoryAccountDevices:async()=>({currentDeviceId:deviceId,
      devices:roster.map(d=>({...d,memoryIdentity:null}))}),
    getLocalStatus:async()=>({cloudState:'disconnected'})});
  servers.push(wall.server);
  if(!wall.server.listening)await new Promise((resolve,reject)=>wall.server.once('listening',resolve).once('error',reject));
  return 'http://127.0.0.1:'+wall.server.address().port;
}
const req=(url,method='GET',body=null,headers={})=>fetch(url,{
  method,headers:{'x-test-owner':'yes','x-light-remote-csrf':'test-csrf',
    'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})
});
try{
 const arm=await create('arm'),win=await create('win');
 const html=await (await req(arm+'/')).text();
 assert.match(html,/id="goldSimpleSyncEnabled"/);
 assert.match(html,/id="goldSimpleSyncDevices"/);
 assert.match(html,/syncModes=\['auto','follow_project','manual'\]/);
 assert.match(html,/Đồng bộ ngay/);
 for(const [,js] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))
   if(js.trim())new vm.Script(js);
 assert.equal((await fetch(arm+'/api/gold/modules/sync/account-policy')).status,401);
 const gated=await fetch(arm+'/api/gold/peer/v1',{method:'POST',
   headers:{'content-type':'application/json'},body:'{}'});
 assert.equal(gated.status,403,'direct P2P blocked while Account Sync is OFF');
 assert.equal((await req(arm+'/api/gold/modules/sync/account-policy','POST',{
   enabled:true,expectedRevision:0,devices:policy.devices
 },{'x-light-remote-csrf':'wrong'})).status,403);
 const setPayload={enabled:true,expectedRevision:0,devices:[
   {deviceId:'arm',selected:true,mode:'auto'},
   {deviceId:'win',selected:true,mode:'manual'}
 ]};
 assert.equal((await req(arm+'/api/gold/modules/sync/account-policy','POST',setPayload)).status,200);
 const view=(await (await req(win+'/api/gold/modules/sync/account-policy')).json()).policy;
 assert.equal(view.enabled,true);
 assert.equal(view.revision,1);
 assert.equal(view.devices.find(x=>x.deviceId==='win').mode,'manual');
 const stale=await req(win+'/api/gold/modules/sync/account-policy','POST',setPayload);
 assert.equal(stale.status,409);
 const command=await req(win+'/api/gold/modules/sync/manual','POST',{deviceId:'win'});
 assert.equal(command.status,200);
 assert.equal((await command.json()).manual.manualRequestSeq,1);
 assert.equal((await req(arm+'/api/gold/modules/sync/account-policy')).status,200);
 const off=await req(win+'/api/gold/modules/sync/account-policy','POST',{
   ...setPayload,enabled:false,expectedRevision:1
 });
 assert.equal(off.status,200);
 assert.equal((await (await req(arm+'/api/gold/modules/sync/account-policy')).json()).policy.enabled,false);
 console.log('GOLD_ACCOUNT_WALL_TWO_DEVICES_MODES_CSRF_REVISION_MANUAL_PASS');
}finally{
 for(const srv of servers)await new Promise(resolve=>srv.close(resolve));
 for(const module of instances)module.close();
 fs.rmSync(root,{recursive:true,force:true});
}
