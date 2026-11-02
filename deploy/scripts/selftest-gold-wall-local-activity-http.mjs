import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {updateSettingsHtml} from '../../device-agent/update-settings-page.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-wall-log-api-'));
const start=Date.now();
let seq=1,connected=true;
const auth={enabled:true,identity:()=>({username:'owner'}),verifyRequestCsrf:req=>req.headers['x-light-remote-csrf']==='owner-fixture-token',csrfForRequest:()=> 'owner-fixture-token'};
const wall=startLocalWall({
 host:'127.0.0.1',port:0,auth,activityLogRoot:dir,
 getLocalStatus:async()=>({deviceId:'dev_local_fixture',enrolled:true,cloudDesiredConnected:connected,cloudState:connected?'connected':'dormant'}),
 getRemoteActivity:async()=>({events:[{id:seq,at:new Date(start+seq*100).toISOString(),type:'job_started',jobId:'job_'+seq,script:'echo safe',deviceId:'dev_local_fixture'}]})
});
try{
 if(!wall.server.listening)await new Promise(resolve=>wall.server.once('listening',resolve));
 const base='http://127.0.0.1:'+wall.server.address().port;
 const req=async(route,opts={})=>{const r=await fetch(base+route,opts);return {status:r.status,data:await r.json()};};
 await new Promise(r=>setTimeout(r,110));
 const config=await req('/api/activity/logs/state');
 assert.equal(config.status,200);
 assert.equal(config.data.log.preset,'standard');
 assert.match(config.data.log.directory,/dev_local_fixture$/);
 assert.ok(config.data.log.ramEvents>=1,'records collected without browser client');
 const unauthWall=startLocalWall({
  host:'127.0.0.1',port:0,activityLogRoot:dir,
  auth:{enabled:true,identity:()=>null,verifyRequestCsrf:()=>true},
  getLocalStatus:async()=>({deviceId:'dev_local_fixture',enrolled:true})
 });
 try{
   if(!unauthWall.server.listening)await new Promise(resolve=>unauthWall.server.once('listening',resolve));
   const result=await fetch('http://127.0.0.1:'+unauthWall.server.address().port+'/api/activity/logs/state');
   assert.equal(result.status,401,'log config is Owner-only');
 }finally{await unauthWall.close();}
 const post=(route,body,csrf='owner-fixture-token')=>req(route,{method:'POST',headers:{'content-type':'application/json','x-light-remote-csrf':csrf},body:JSON.stringify(body)});
 assert.equal((await post('/api/activity/logs/config',{preset:'extended'},'wrong')).status,403);
 assert.equal((await post('/api/activity/logs/config',{preset:'unlimited'})).status,400);
 const extended=await post('/api/activity/logs/config',{preset:'extended'});
 assert.equal(extended.status,200);assert.equal(extended.data.log.maxDiskBytes,300*1024*1024);
 assert.equal((await post('/api/activity/logs/clean',{confirmText:'oops'})).status,400);
 const cleaned=await post('/api/activity/logs/clean',{confirmText:'CLEAN ACTIVITY LOGS'});
 assert.equal(cleaned.status,200);assert.equal(cleaned.data.log.usedBytes,0);
 seq++;await new Promise(r=>setTimeout(r,5600));
 const recent=await req('/api/activity?limit=50');
 assert.equal(recent.status,200);assert.equal(recent.data.source,'device_local');
 assert.equal(recent.data.events.length,1,'old events not reimported after Clean');
 connected=false;const offline=await req('/api/activity?limit=50');
 assert.equal(offline.data.events.length,1,'disconnected Wall still serves local memory');
 const html=updateSettingsHtml({surface:'local',modulesAvailable:true,csrfToken:'fixture'});
 assert.match(html,/id="activityLogSettings"/);
 assert.match(html,/CLEAN ACTIVITY LOGS/);
 assert.match(html,/api\/activity\/logs\/config/);
 assert.match(html,/api\/activity\/logs\/clean/);
 const plain=updateSettingsHtml({surface:'fleet',modulesAvailable:true});
 assert.doesNotMatch(plain,/id="activityLogSettings"/);
 console.log('GOLD_ABV2_WALL_ACTIVITY_LOG_OWNER_AUTH_CSRF_SETTINGS_CLEAN_OFFLINE_PASS');
}finally{
 await wall.close();
 fs.rmSync(dir,{recursive:true,force:true});
}
