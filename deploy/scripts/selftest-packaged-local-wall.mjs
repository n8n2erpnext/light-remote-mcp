import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=process.argv[2]&&path.resolve(process.argv[2]);
assert.ok(root&&fs.existsSync(path.join(root,'client-core.json')),'packaged_client_core_required');
// The stage manifest is an allowlist: missing SVGs are invisible to --verify.
// Assert full Material asset parity so future Wall UI icons cannot silently break
// only in installed client packages.
const srcIcons=new URL('../../assets/icons/material/',import.meta.url);
const icons=fs.readdirSync(srcIcons).filter(file=>file.endsWith('.svg'));
for(const filename of icons){
  assert.ok(fs.existsSync(path.join(root,'assets/icons/material',filename)),`packaged_material_asset_missing:${filename}`);
}
console.log('PACKAGED_WALL_ASSET_PARITY=PASS count='+icons.length);
const {materialIcon}=await import(pathToFileURL(path.join(root,'lib/material-icon.mjs')).href);
const {startLocalWall}=await import(pathToFileURL(path.join(root,'device-agent/local-wall.mjs')).href);
const essential=['visibility','visibilityOff','copy','refresh','link','power','device','security','approve','settings','logout','pause','terminal','dragIndicator','minimize','maximize','close','arrowBack'];
for(const name of essential){
  const svg=materialIcon(name);
  assert.ok(svg.includes('<svg'),`packaged_wall_icon_missing:${name}`);
}
console.log('PACKAGED_WALL_ALL_REQUIRED_ICONS=PASS count='+essential.length);
const wall=startLocalWall({host:'127.0.0.1',port:0,getLocalStatus:async()=>({deviceName:'packaged-test',cloudState:'disconnected'})});
try{
  await new Promise((resolve,reject)=>wall.server.listening?resolve():wall.server.once('listening',resolve).once('error',reject));
  const base='http://127.0.0.1:'+wall.server.address().port;
  for(const route of ['/','/permissions','/approve','/settings']){
    const response=await fetch(base+route,{redirect:'manual'});
    const html=await response.text();
    assert.equal(response.status,200,`packaged_wall_http_error:${route}:${html.slice(0,160)}`);
    assert.match(html,/<html/,route);
    console.log('PACKAGED_WALL_HTTP_OK='+route);
  }
  const response=await fetch(base+'/api/status');
  assert.equal(response.status,200);
  assert.equal((await response.json()).ok,true);
  console.log('PACKAGED_WALL_RENDER_AND_API=PASS');
}finally{await wall.close();}
