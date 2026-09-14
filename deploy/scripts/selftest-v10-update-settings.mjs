import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

const root=path.resolve(new URL('../..',import.meta.url).pathname);
const brand=path.join(root,'assets/branding/light-remote-mark.svg');
const port=26000+(process.pid%8000);
let checks=0,updates=0;
const wall=startLocalWall({host:'127.0.0.1',port,brandSvgPath:brand,
  getLocalStatus:async()=>({ok:true,enrolled:true,deviceId:'dev_update_settings',deviceName:'UPDATE-TEST',platformAdapter:'linux',version:'0.9.0-rc.6',cloudDesiredConnected:false,cloudState:'dormant',update:{state:'available',currentVersion:'0.9.0-rc.6',targetVersion:'0.9.1',helperVersion:'0.9.0-rc.6',available:true}}),
  getRemoteStatus:async()=>null,getRemoteActivity:async()=>({events:[]}),connect:async()=>({}),disconnect:async()=>({}),setGrace:async()=>({}),setPermissions:async()=>({}),
  requestUpdate:async data=>{if(data?.mode==='check')checks++;else updates++;return {accepted:true,mode:data?.mode||'apply'};}
});
function request(method,target,payload){return new Promise((resolve,reject)=>{const data=payload==null?null:Buffer.from(JSON.stringify(payload));const req=http.request({host:'127.0.0.1',port,path:target,method,headers:data?{'content-type':'application/json','content-length':data.length}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json=null;try{json=JSON.parse(text);}catch{}resolve({status:res.statusCode,text,json});});});req.on('error',reject);if(data)req.write(data);req.end();});}
await new Promise(r=>setTimeout(r,80));
try{
  const rootPage=await request('GET','/');
  if(rootPage.status!==200||!rootPage.text.includes("settingsLink.href='/settings'"))throw new Error('local_settings_link_missing');
  const settings=await request('GET','/settings');
  if(settings.status!==200||!settings.text.includes('Updater Helper is independent from Core'))throw new Error('local_update_settings_contract_failed');
  if(!settings.text.includes('Check now')||!settings.text.includes('Update now'))throw new Error('local_update_actions_missing');
  const check=await request('POST','/api/update/check',{mode:'check'});
  if(check.status!==200||checks!==1||check.json?.update?.mode!=='check')throw new Error('local_update_check_action_failed');
  const apply=await request('POST','/api/update/request',{mode:'apply'});
  if(apply.status!==200||updates!==1||apply.json?.update?.mode!=='apply')throw new Error('local_update_apply_action_failed');
  console.log('v10-local-wall-update-settings=PASS');
} finally {await wall.close();}
