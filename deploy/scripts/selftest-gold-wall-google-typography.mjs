import assert from 'node:assert/strict';
import fs from 'node:fs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {localProcessPage} from '../../device-agent/local-process-page.mjs';
import {fleetJobPage} from '../../device-agent/fleet-job-page.mjs';
import {wallAbV2PreviewFragment} from '../../device-agent/wall-ab-v2-preview.mjs';
import {WALL_UI_FONT,WALL_CODE_FONT,WALL_FONT_FACE_CSS,WALL_TYPOGRAPHY_CSS} from '../../lib/web-typography.mjs';

assert.match(WALL_UI_FONT,/Google Sans/);
assert.match(WALL_CODE_FONT,/Google Sans Code/);
assert.match(WALL_FONT_FACE_CSS,/GoogleSansCode-Variable\.ttf/);
for(const [name,size] of Object.entries({
 '--lr-font-page':'22px','--lr-font-section':'18px',
 '--lr-font-heading':'16px','--lr-font-body':'14px',
 '--lr-font-secondary':'13px','--lr-font-metadata':'12px',
 '--lr-font-code':'13px'
}))assert.ok(WALL_TYPOGRAPHY_CSS.includes(name+':'+size),name);
assert.ok(fs.statSync(new URL('../../assets/fonts/web/GoogleSansCode-Variable.ttf',import.meta.url)).size>100_000);
assert.ok(fs.statSync(new URL('../../assets/fonts/web/GoogleSans-OFL-1.1.txt',import.meta.url)).size>1_000);
assert.ok(fs.statSync(new URL('../../assets/fonts/web/GoogleSansCode-OFL-1.1.txt',import.meta.url)).size>1_000);
assert.match(wallAbV2PreviewFragment,/Google Sans Code/);

let wall;
try {
 wall=startLocalWall({
  host:'127.0.0.1',port:0,modules:null,auth:{enabled:false},
  getLocalStatus:async()=>({deviceName:'typography-fixture',deviceId:'fixture',cloudDesiredConnected:false,cloudState:'dormant'}),
  getRemoteStatus:async()=>({ok:false,error:'offline'})
 });
 if(!wall.server.listening)await new Promise((resolve,reject)=>wall.server.once('listening',resolve).once('error',reject));
 const root='http://127.0.0.1:'+wall.server.address().port;
 for(const path of ['/','/long-memory','/codex-cli','/settings','/permissions','/approve']){
  const r=await fetch(root+path);
  assert.equal(r.status,200,path);
  const html=await r.text();
  assert.match(html,/font-family:'Google Sans'/,path);
  assert.match(html,/GoogleSansCode-Variable\.ttf/,path);
  if(path!=='/approve')assert.match(html,/--lr-font-body:14px/,path);
  if(path==='/')assert.match(html,/\.cmdtext\{font-family:'Google Sans Code'/);
  if(path==='/long-memory'||path==='/codex-cli')
   assert.match(html,/body\.wall-view-memory \.sessionbox,body\.wall-view-codex \.sessionbox/);
  if(path==='/settings')assert.match(html,/h1\{font-size:var\(--lr-font-page\)/);
 }
 for(const file of ['GoogleSans-Variable.ttf','GoogleSansCode-Variable.ttf']){
  const r=await fetch(root+'/assets/fonts/'+file);
  assert.equal(r.status,200,file);
  assert.equal(r.headers.get('content-type'),'font/ttf');
  const data=new Uint8Array(await r.arrayBuffer());
  assert.ok(data.byteLength>100_000,file);
  assert.equal(data[0],0);
  assert.equal(data[1],1);
 }
 for(const [name,rendered] of [['local process',localProcessPage('fixture')],['fleet jobs',fleetJobPage({csrfToken:'fixture'})]]){
  assert.match(rendered,/font-family:'Google Sans'/,name);
  assert.match(rendered,/--lr-font-body:14px/,name);
  assert.doesNotMatch(rendered,/\$\{WALL_/,name);
 }
 console.log('GOLD_WALL_GOOGLE_SANS_CODE_FONT_ENDPOINTS_AND_TYPOGRAPHY_ALL_PAGES=PASS');
}finally{
 if(wall)await wall.close();
}
