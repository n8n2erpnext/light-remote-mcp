import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { startLocalWall } from '../../device-agent/local-wall.mjs';
import { writeLocalWallAuthConfig, loadLocalWallAuth } from '../../device-agent/local-wall-auth.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-wall-auth-')),file=path.join(dir,'wall-auth.json');
const password='selftest-wall-password-123';
writeLocalWallAuthConfig(file,{username:'owner',password,sessionTtlSeconds:3600});
assert.equal(fs.statSync(file).mode & 0o777,0o600);
const stored=fs.readFileSync(file,'utf8');assert.ok(!stored.includes(password));assert.match(stored,/scrypt\$/);
assert.throws(()=>writeLocalWallAuthConfig(path.join(dir,'weak.json'),{username:'owner',password:'short'}),/local_wall_password_too_short/);
const auth=loadLocalWallAuth(file,{required:true});
assert.equal(auth.enabled,true);assert.equal(auth.username,'owner');
assert.throws(()=>startLocalWall({host:'10.0.0.5',port:29999}),/local_wall_auth_required_for_non_loopback/);
const port=27000+(process.pid%5000),brand=new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname;
let pairingCalls=0;
const wall=startLocalWall({host:'127.0.0.1',port,brandSvgPath:brand,auth,
  getLocalStatus:async()=>({ok:true,enrolled:true,deviceId:'dev-auth',deviceName:'AUTH-WALL',cloudDesiredConnected:true,cloudState:'connected'}),
  getRemoteStatus:async()=>({ok:true,device:{deviceId:'dev-auth',displayName:'AUTH-WALL',state:'online'},connection:{state:'connected'},sessions:[],access:{pending:[]}}),
  getRemoteActivity:async()=>({events:[]}),pairingCode:async()=>{pairingCalls++;return{code:'ABCD-EFGH',expiresAt:Date.now()+180000};},
  connect:async()=>({state:'connected'}),disconnect:async()=>({state:'dormant'}),setGrace:async()=>({state:'connected'}),accessApprove:async()=>({}),accessDeny:async()=>({})
});
function req(method,target,{body=null,headers={}}={}){return new Promise((resolve,reject)=>{
  const data=body==null?null:Buffer.from(body);const h={...headers};if(data){h['content-length']=data.length;if(!h['content-type'])h['content-type']='application/x-www-form-urlencoded';}
  const r=http.request({host:'127.0.0.1',port,method,path:target,headers:h},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});
  r.on('error',reject);if(data)r.write(data);r.end();
});}
await new Promise(r=>setTimeout(r,80));
try{
  let r=await req('GET','/');assert.equal(r.status,303);assert.match(String(r.headers.location),/^\/login\?next=/);
  r=await req('GET','/api/status');assert.equal(r.status,401);assert.match(r.text,/wall_auth_required/);
  r=await req('GET','/events');assert.equal(r.status,401);assert.match(r.text,/wall_auth_required/);
  r=await req('GET','/login');assert.equal(r.status,200);assert.match(r.text,/Device Wall owner login/);assert.ok(!r.text.includes(password));
  r=await req('POST','/auth/login',{body:'username=owner&password=wrong&next=%2F'});assert.equal(r.status,401);assert.ok(!r.headers['set-cookie']);
  const form=new URLSearchParams({username:'owner',password,next:'/'}).toString();
  r=await req('POST','/auth/login',{body:form,headers:{'x-forwarded-proto':'https'}});assert.equal(r.status,303);
  const cookie=String(r.headers['set-cookie']?.[0]||'').split(';')[0];assert.match(cookie,/^lr_wall_session=/);assert.match(String(r.headers['set-cookie']),/HttpOnly/);assert.match(String(r.headers['set-cookie']),/SameSite=Strict/);assert.match(String(r.headers['set-cookie']),/Secure/);
  r=await req('GET','/',{headers:{cookie}});assert.equal(r.status,200);assert.match(r.text,/LIVE OPERATOR STREAM/);
  r=await req('GET','/',{headers:{cookie:cookie.replace(/.$/,'x')}});assert.equal(r.status,303);
  r=await req('POST','/api/pairing-code',{headers:{cookie,'content-type':'application/json'},body:'{}'});assert.equal(r.status,200);assert.equal(pairingCalls,1);assert.match(r.text,/ABCD-EFGH/);
  r=await req('POST','/api/pairing-code',{headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,401);assert.equal(pairingCalls,1);
  r=await req('POST','/api/pairing-code',{headers:{cookie,origin:'https://evil.example','x-forwarded-host':'amdwall.example','content-type':'application/json'},body:'{}'});assert.equal(r.status,403);assert.equal(pairingCalls,1);
  r=await req('POST','/auth/logout',{headers:{cookie,origin:'https://amdwall.example','x-forwarded-host':'amdwall.example','x-forwarded-proto':'https'},body:''});assert.equal(r.status,303);assert.match(String(r.headers['set-cookie']),/Max-Age=0/);
  console.log('v09-local-wall-auth-login=PASS');
  console.log('v09-local-wall-auth-private-bind-required=PASS');
  console.log('v09-local-wall-auth-csrf=PASS');
  console.log('v09-local-wall-auth-secret-cookie=PASS');
} finally {await wall.close();fs.rmSync(dir,{recursive:true,force:true});}
