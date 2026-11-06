import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {WALL_UI_REFINEMENT_CSS} from '../../device-agent/wall-ui-refinement.mjs';

const source=readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
const start=source.indexOf("let streamConnectionState='connecting',statusFetchFailed=false;");
const end=source.indexOf('function openEvents()',start);
assert.ok(start>0 && end>start);
const ctx=vm.createContext({conn:{className:'',textContent:'',dataset:{},title:''},localState:null});
vm.runInContext(source.slice(start,end),ctx);
const phase=(state,desired,stream='open',failed=false)=>{
 ctx.localState={cloudState:state,cloudDesiredConnected:desired};
 vm.runInContext("streamConnectionState="+JSON.stringify(stream)+";statusFetchFailed="+String(failed)+";renderLiveIndicator()",ctx);
 return {className:ctx.conn.className,text:ctx.conn.textContent,phase:ctx.conn.dataset.cloudPhase};
};
assert.deepEqual(phase('connected',true),{className:'pill ok',text:'live',phase:'connected'});
assert.deepEqual(phase('dormant',false),{className:'pill running',text:'live',phase:'dormant'});
assert.deepEqual(phase('standby',false),{className:'pill running',text:'live',phase:'dormant'});
assert.deepEqual(phase('disconnected',false),{className:'pill error',text:'disconnected',phase:'disconnected'});
assert.deepEqual(phase('error',true),{className:'pill error',text:'disconnected',phase:'disconnected'});
assert.deepEqual(phase('connected',true,'error'),{className:'pill error',text:'disconnected',phase:'disconnected'});
assert.deepEqual(phase('connected',true,'open',true),{className:'pill error',text:'disconnected',phase:'disconnected'});
assert.match(source, /statusFetchFailed=false;renderLiveIndicator\(\)/);
assert.match(source, /es\.onopen=\(\)=>\{streamConnectionState='open';renderLiveIndicator\(\)/);
assert.match(source, /es\.onerror=\(\)=>\{streamConnectionState='error';renderLiveIndicator\(\)/);

assert.match(WALL_UI_REFINEMENT_CSS,/\.term \.head\{font-size:12px/,'header title stays unchanged');
assert.match(WALL_UI_REFINEMENT_CSS,/\.term \.cmdtext\{font-size:14px/,'commands are +1.5px');
assert.match(WALL_UI_REFINEMENT_CSS,/\.term pre\{font:14px\/1\.5/,'output text +1.5px');
assert.match(WALL_UI_REFINEMENT_CSS,/\.term \.meta\{font-size:13px/,'metadata +1.5px');
assert.match(WALL_UI_REFINEMENT_CSS,/\.term \.actions \.btn\{font:500 12px/,'action label +1px');
assert.match(WALL_UI_REFINEMENT_CSS,/hover\{border-color:#67b9e4!important;text-decoration:none!important/);
assert.match(WALL_UI_REFINEMENT_CSS,/text-decoration:none!important/);
assert.match(WALL_UI_REFINEMENT_CSS,/#conn\.running\{color:#f2c161\}/);
assert.match(WALL_UI_REFINEMENT_CSS,/#conn\.error\{color:#ff858b\}/);
assert.match(WALL_UI_REFINEMENT_CSS,/#conn\.ok::before\{background:#4cde91;animation:/,'green ping preserved');
assert.match(WALL_UI_REFINEMENT_CSS,/prefers-reduced-motion:reduce/);

let wall;
try{
 wall=startLocalWall({host:'127.0.0.1',port:0,modules:null,
  auth:{enabled:true,identity:()=>({username:'owner@example.invalid'}),csrfForRequest:()=> 'test-csrf'},
  getLocalStatus:async()=>({deviceName:'fixture',cloudDesiredConnected:false,cloudState:'dormant'}),
  getRemoteStatus:async()=>({ok:false,error:'offline'})});
 if(!wall.server.listening)await new Promise((resolve,reject)=>wall.server.once('listening',resolve).once('error',reject));
 const base='http://127.0.0.1:'+wall.server.address().port;
 for(const path of ['/','/approve','/permissions','/settings','/long-memory','/codex-cli']){
  const response=await fetch(base+path);
  assert.equal(response.status,200,path);
  const html=await response.text();
  assert.match(html,/border-color:#67b9e4!important/,path+' hover style');
  assert.match(html,/text-decoration:none!important/,path+' no link underlines');
  assert.match(html,/#conn\.running\{color:#f2c161\}/,path+' status theme');
  if(path==='/'){
   assert.match(html,/\.term \.head\{font-size:12px/);
   assert.match(html,/\.term \.cmdtext\{font-size:14px/);
   assert.match(html,/renderLiveIndicator\(\)/);
  }
 }
 console.log('GOLD_ABV2_R5_BUTTON_HOVER_STREAM_FONT_AND_CLOUD_LIVE_INDICATOR_PASS');
}finally{if(wall)await wall.close();}
