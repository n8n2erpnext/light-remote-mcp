import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {WALL_UI_REFINEMENT_CSS} from '../../device-agent/wall-ui-refinement.mjs';
const source=fs.readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
let wall;
try{
 wall=startLocalWall({host:'127.0.0.1',port:0,modules:null,auth:{enabled:true,identity:()=>({username:'owner@example.invalid'}),csrfForRequest:()=> 'test-csrf'},
  getLocalStatus:async()=>({deviceName:'wall-test',deviceId:'device-test',cloudDesiredConnected:false,cloudState:'dormant'}),
  getRemoteStatus:async()=>({ok:false,error:'offline'})});
 if(!wall.server.listening)await new Promise((resolve,reject)=>wall.server.once('listening',resolve).once('error',reject));
 const url='http://127.0.0.1:'+wall.server.address().port;
 const html=await (await fetch(url+'/')).text();
 for(const token of ['id="wallSidebar"','id="sidebarToggle"','class="sidebar-items"','id="abV2ShortId"','id="abV2State"','id="abV2Timer"','id="abV2ApproveLink"','LIVE OPERATOR STREAM','id="wallNotificationBell"','Approve B'])
  assert.ok(html.includes(token),token);
 assert.equal((html.match(/id="abV2WallStatus"/g)||[]).length,1,'no duplicate status element');
 assert.equal((html.match(/id="wallNotificationBell"/g)||[]).length,1,'one notification bell');
 assert.ok(html.indexOf('id="wallSidebar"')<html.indexOf('<div class="wrap">'),'sidebar outside inner wall container');
 assert.ok(html.indexOf('id="wallNotificationBell"')<html.indexOf('class="wall-primary"'),'notification in slim header');
 assert.doesNotMatch(html,/AI Access V2|V1 locked/);
 assert.match(WALL_UI_REFINEMENT_CSS,/\.term\{font-family:'Google Sans Code'/);
 assert.match(WALL_UI_REFINEMENT_CSS,/\.term \.opbadge,\.term \.riskbadge/);
 assert.match(WALL_UI_REFINEMENT_CSS,/prefers-reduced-motion/);
 assert.match(WALL_UI_REFINEMENT_CSS,/wall-sidebar-collapsed/);
 let scripts=0;
 for(const part of html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)){
  if(part[1].trim()){new vm.Script(part[1],{filename:'wall-ui-refinement-rendered.js'});scripts++;}
 }
 assert.ok(scripts>=1);
 const a=source.indexOf('function renderAbV2PendingCountdown(){');
 const b=source.indexOf('async function refreshAbV2WallMode(){',a);
 assert.ok(a>0&&b>a);
 let now=1000000000000,refreshes=0;
 const elements=Object.fromEntries(['abV2WallStatus','abV2State','abV2Timer','abV2ApproveLink','abV2AValue'].map(k=>[k,{hidden:true,dataset:{},textContent:''}]));
 const ctx={abV2PendingAValue:'R01KAP-HX61N',document:{getElementById:k=>elements[k]},Date:{now:()=>now},abV2PendingCount:1,abV2PendingDeadline:now+300000,abV2PendingExpiredRefresh:false,refreshAbV2WallMode:()=>{refreshes++}};
 vm.runInNewContext(source.slice(a,b),ctx);
 const check=(left,phase)=>{
  ctx.abV2PendingDeadline=now+left;ctx.renderAbV2PendingCountdown();assert.equal(elements.abV2WallStatus.dataset.phase,phase);
  assert.equal(elements.abV2State.textContent,'· Pending approval');
  assert.equal(elements.abV2AValue.textContent,'R01KAP-HX61N');assert.equal(elements.abV2ApproveLink.hidden,false);
 };
 check(300000,'pending');check(115000,'pending');check(79000,'orange');check(59000,'red');check(29000,'red');
 ctx.abV2PendingDeadline=now;ctx.renderAbV2PendingCountdown();ctx.renderAbV2PendingCountdown();
 assert.equal(elements.abV2WallStatus.dataset.phase,'expired');
 assert.equal(refreshes,1,'expired state only triggers one immediate refresh');
 ctx.abV2PendingCount=0;ctx.renderAbV2PendingCountdown();
 assert.equal(elements.abV2WallStatus.dataset.phase,'standby');
 assert.equal(elements.abV2AValue.textContent,'standby');
 assert.equal(elements.abV2ApproveLink.hidden,true);
 assert.equal(elements.abV2Timer.hidden,true);
 assert.match(source,/short\.textContent=shortId/);
 assert.doesNotMatch(source,/code\.textContent=data\.pending/);
 console.log('GOLD_ABV2_WALL_SIDEBAR_STREAM_PENDING_BELL_LIVE_UI=PASS');
}finally{if(wall)await wall.close()}
