import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startLocalWall } from '../../device-agent/local-wall.mjs';

const port=24000+(process.pid%10000),brand=new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname;
let connected=false,grace=30,connects=0,disconnects=0,graces=0;
const wall=startLocalWall({host:'127.0.0.1',port,brandSvgPath:brand,
  getLocalStatus:async()=>({ok:true,enrolled:true,deviceId:'dev_localwall_test',deviceName:'LOCAL-WALL-TEST',accountId:'acct-test',cloudDesiredConnected:connected,cloudState:connected?'connected':'dormant',connectionPlan:'free',hardExpiresAt:connected?Date.now()+3600000:null,reconnectGraceMs:grace*60000}),
  getRemoteStatus:async()=>({ok:true,sessions:connected?[{sessionId:'s_localwall_test',agentId:'agent-localwall-test-aaaaaaaa',label:'ChatGPT A',state:'active',lastSeenAt:Date.now(),activeJobs:[]}]:[]}),
  connect:async data=>{connects++;connected=true;grace=Number(data.graceMinutes||grace);return {state:'connected',reconnectGraceMs:grace*60000};},
  disconnect:async()=>{disconnects++;connected=false;return {state:'dormant'};},
  setGrace:async data=>{graces++;grace=Number(data.minutes);return {state:'connected',reconnectGraceMs:grace*60000};}
});
function req(method,target,payload){return new Promise((resolve,reject)=>{const data=payload==null?null:Buffer.from(JSON.stringify(payload));const r=http.request({host:'127.0.0.1',port,method,path:target,headers:data?{'content-type':'application/json','content-length':data.length}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json=null;try{json=JSON.parse(text)}catch{}resolve({status:res.statusCode,text,json});});});r.on('error',reject);if(data)r.write(data);r.end();});}
await new Promise(r=>setTimeout(r,80));
try{
  const html=await req('GET','/');
  if(html.status!==200||!html.text.includes('Light Remote')||!html.text.includes('Local Wall · this device only'))throw new Error('local_wall_html_failed');
  const dormant=await req('GET','/api/status');
  if(dormant.status!==200||dormant.json.local.cloudState!=='dormant'||dormant.json.remote!==null)throw new Error('local_wall_dormant_status_failed');
  const c=await req('POST','/api/connect',{graceMinutes:45});
  if(c.status!==200||connects!==1||grace!==45)throw new Error('local_wall_connect_failed');
  const live=await req('GET','/api/status');
  if(live.status!==200||live.json.local.cloudState!=='connected'||live.json.remote.sessions?.length!==1)throw new Error('local_wall_live_sessions_failed');
  const g=await req('POST','/api/grace',{minutes:60});
  if(g.status!==200||graces!==1||grace!==60)throw new Error('local_wall_grace_failed');
  const d=await req('POST','/api/disconnect',{});
  if(d.status!==200||disconnects!==1||connected)throw new Error('local_wall_disconnect_failed');
  console.log(JSON.stringify({ok:true,loopback:true,brand:true,connects,disconnects,graces,sessionTree:true},null,2));
} finally {await wall.close();}
