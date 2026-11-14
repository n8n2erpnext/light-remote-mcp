import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {startLocalWall} from './local-wall.mjs';
import {loadCanonicalEndpoints} from '../lib/canonical-endpoints.mjs';
const catalog=loadCanonicalEndpoints(new URL('../config/endpoints.json',import.meta.url)).routeCatalog;
test('all video page/media/script routes require authenticated Owner even on no-login loopback Wall',async()=>{
 for(const enabled of [false,true]){
  let reads=0;const wall=startLocalWall({host:'127.0.0.1',port:0,auth:{enabled,identity:()=>null},getLocalStatus:async()=>({}),getLocalVideo:async()=>{reads++;return [];}});
  try{await once(wall.server,'listening');const base='http://127.0.0.1:'+wall.server.address().port;
   for(const key of ['wallVideoPage','wallVideoScript','wallVideoLatest']){
    const response=await fetch(base+catalog[key].path,{redirect:'manual'});
    assert.ok([302,303,401,403].includes(response.status),key+' status='+response.status+' enabled='+enabled);
    if(response.status===302||response.status===303)assert.match(response.headers.get('location'),/^\/login(?:\?|$)/);
   }
   assert.equal(reads,0);
  }finally{wall.close();}
 }
});
test('Owner video observer serves shared decoder and no-store recent frames without capture commands',async()=>{
 let reads=0;const wall=startLocalWall({host:'127.0.0.1',port:0,auth:{enabled:true,identity:()=>({accountId:'owner'})},getLocalStatus:async()=>({}),getLocalVideo:async options=>{reads++;assert.equal(options.afterSeq,9);return [];}});
 try{
  await once(wall.server,'listening');const base='http://127.0.0.1:'+wall.server.address().port;
  const page=await fetch(base+catalog.wallVideoPage.path);assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');assert.match(await page.text(),/Opening this page does not start control/);
  const js=await fetch(base+catalog.wallVideoScript.path);assert.equal(js.status,200);assert.match(await js.text(),/VideoDecoder/);
  const response=await fetch(base+catalog.wallVideoLatest.path+'?afterSeq=9');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).observerOnly,true);assert.equal(reads,1);
 }finally{wall.close();}
});
