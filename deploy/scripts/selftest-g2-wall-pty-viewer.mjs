import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {writeLocalWallAuthConfig,loadLocalWallAuth} from '../../device-agent/local-wall-auth.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-g2-pty-wall-'));
const file=path.join(dir,'auth.json'),port=31000+process.pid%15000;
writeLocalWallAuthConfig(file,{username:'operator',password:'g2-fixture-password-123',sessionTtlSeconds:3600});
const auth=loadLocalWallAuth(file,{required:true});
const id='ltm_ABCDEFGHIJKLMNOPQRSTUVWX';
let listCalls=0,readCalls=0;
const server=startLocalWall({host:'127.0.0.1',port,auth,
  brandSvgPath:new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname,
  getLocalStatus:async()=>({deviceName:'G2 fixture',cloudState:'disconnected'}),
  getRemoteStatus:async()=>({sessions:[]}),
  getRemoteActivity:async()=>({events:[]}),
  getLocalTerminals:async()=>{listCalls++;return [{terminalId:id,sessionId:'s_fixture',shell:'bash',state:'running',outputBytes:22}]},
  readLocalTerminal:async(terminalId,{offset,limit})=>{readCalls++;assert.equal(terminalId,id);assert.equal(limit,32768);if(offset>22)throw Error('terminal_not_found');return{terminalId,sessionId:'s_fixture',state:'running',output:{text:'pty fixture output',nextOffset:18,totalBytes:22,baseOffset:0,truncatedBefore:false}};},
});
function req(method,url,headers={},payload=''){
  return new Promise((resolve,reject)=>{
    const request=http.request({host:'127.0.0.1',port,path:url,method,headers:{...headers,...(payload?{'content-type':'application/x-www-form-urlencoded','content-length':Buffer.byteLength(payload)}:{})}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString(),headers:res.headers}));
    });request.on('error',reject);request.end(payload);
  });
}
await new Promise(resolve=>setTimeout(resolve,80));
try{
  let r=await req('GET','/api/pty/sessions');
  assert.equal(r.status,401);assert.match(r.text,/wall_auth_required/);assert.equal(listCalls,0);
  r=await req('GET','/api/pty/output?terminalId='+id);
  assert.equal(r.status,401);assert.equal(readCalls,0);
  r=await req('GET','/login');
  const csrf=r.text.match(/name="csrf" value="([^"]+)"/)?.[1];assert.ok(csrf);
  r=await req('POST','/auth/login',{},new URLSearchParams({username:'operator',password:'g2-fixture-password-123',csrf,next:'/'}).toString());
  assert.equal(r.status,303);
  const cookie=String(r.headers['set-cookie']?.[0]||'').split(';')[0];
  r=await req('GET','/',{cookie});assert.equal(r.status,200);
  assert.match(r.text,/id="ptyOverlay"/);assert.match(r.text,/id="ptyOpen"/);
  assert.doesNotMatch(r.text,/pty fixture output/,'output never embedded into wall HTML');
  const inline=r.text.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.ok(inline);
  new Function(inline); // compile-only, no DOM or request invocation
  r=await req('GET','/api/pty/sessions',{cookie});
  assert.equal(r.status,200);let j=JSON.parse(r.text);assert.equal(j.scope,'device_agent_local');
  assert.equal(j.terminals[0].terminalId,id);assert.equal(listCalls,1);
  r=await req('GET','/api/pty/output?terminalId=bad',{cookie});
  assert.equal(r.status,400);assert.equal(readCalls,0);
  r=await req('GET','/api/pty/output?terminalId='+id+'&offset=-1',{cookie});
  assert.equal(r.status,400);assert.equal(readCalls,0);
  r=await req('GET','/api/pty/output?terminalId='+id+'&offset=0',{cookie});
  assert.equal(r.status,200);j=JSON.parse(r.text);
  assert.equal(j.terminal.output.text,'pty fixture output');assert.equal(readCalls,1);
  assert.equal(r.headers['cache-control'],'no-store');
  r=await req('GET','/api/pty/output?terminalId='+id+'&offset=12345',{cookie});
  assert.equal(r.status,404);assert.equal(readCalls,2);
  console.log('G2_WALL_PTY_AUTH_AND_LAZY_OUTPUT=PASS');
  console.log('G2_WALL_PTY_BOUNDED_CURSOR_AND_NO_HTML_LEAK=PASS');
}finally{await server.close();fs.rmSync(dir,{recursive:true,force:true});}
