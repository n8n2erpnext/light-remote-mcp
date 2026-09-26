import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { startLocalWall } from '../../device-agent/local-wall.mjs';
import { writeLocalWallAuthConfig, loadLocalWallAuth } from '../../device-agent/local-wall-auth.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-wall-auth-')),file=path.join(dir,'wall-auth.json');
const password='selftest-wall-password-123';
writeLocalWallAuthConfig(file,{username:'operator',password,sessionTtlSeconds:3600});
assert.equal(fs.statSync(file).mode & 0o777,0o600);
const stored=fs.readFileSync(file,'utf8');assert.ok(!stored.includes(password));assert.match(stored,/scrypt\$/);
assert.throws(()=>writeLocalWallAuthConfig(path.join(dir,'weak.json'),{username:'operator',password:'short'}),/local_wall_password_too_short/);
const auth=loadLocalWallAuth(file,{required:true});assert.equal(auth.enabled,true);assert.equal(auth.username,'operator');
assert.throws(()=>startLocalWall({host:'10.0.0.5',port:29999}),/local_wall_auth_required_for_non_loopback/);
const port=27000+(process.pid%5000),brand=new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname;
let pairingCalls=0,accountAuthCalls=0,desktopCalls=0;
const wall=startLocalWall({host:'127.0.0.1',port,brandSvgPath:brand,auth,
  accountAuthenticate:async({username,password})=>{accountAuthCalls++;if(username==='owner@example.test'&&password==='account-password-123')return{account:{accountId:'self-hosted-local',email:username,plan:'vip'}};throw new Error('invalid_account_credentials');},
  getLocalStatus:async()=>({ok:true,enrolled:true,deviceId:'dev-auth',deviceName:'AUTH-WALL',cloudDesiredConnected:true,cloudState:'connected'}),
  getRemoteStatus:async()=>({ok:true,device:{deviceId:'dev-auth',displayName:'AUTH-WALL',state:'online'},connection:{state:'connected'},sessions:[],access:{pending:[]}}),
  getRemoteActivity:async()=>({events:[]}),pairingCode:async()=>{pairingCalls++;return{code:'ABCD-EFGH',expiresAt:Date.now()+180000};},
  connect:async()=>({state:'connected'}),disconnect:async()=>({state:'dormant'}),setGrace:async()=>({state:'connected'}),accessApprove:async()=>({}),accessDeny:async()=>({}),
  desktopAction:async data=>{desktopCalls++;return {ok:true,operation:String(data.op||''),desktop:{screens:[],echo:data.op||''}};}
});function req(method,target,{body=null,headers={}}={}){return new Promise((resolve,reject)=>{
  const data=body==null?null:Buffer.from(body);const h={...headers};if(data){h['content-length']=data.length;if(!h['content-type'])h['content-type']='application/x-www-form-urlencoded';}
  const r=http.request({host:'127.0.0.1',port,method,path:target,headers:h},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});
  r.on('error',reject);if(data)r.write(data);r.end();
});}
const loginCsrf=html=>{const m=String(html).match(/name="csrf" value="([^"]+)"/);assert.ok(m?.[1],'login_csrf_missing');return m[1];};
const mutationCsrf=html=>{const m=String(html).match(/const wallCsrf="([^"]+)"/);assert.ok(m?.[1],'mutation_csrf_missing');return m[1];};
await new Promise(r=>setTimeout(r,80));
try{
  let r=await req('GET','/');assert.equal(r.status,303);assert.match(String(r.headers.location),/^\/login\?next=/);
  r=await req('GET','/api/status');assert.equal(r.status,401);assert.match(r.text,/wall_auth_required/);
  r=await req('GET','/desktop');assert.equal(r.status,303);assert.match(String(r.headers.location),/^\/login\?next=/);
  r=await req('POST','/api/desktop',{headers:{'content-type':'application/json'},body:'{\"op\":\"status\"}'});assert.equal(r.status,401);assert.equal(desktopCalls,0);
  r=await req('GET','/login',{headers:{host:'10.123.45.67:5491'}});assert.equal(r.status,200);assert.match(r.text,/Device Wall login/);let csrf=loginCsrf(r.text);
  r=await req('POST','/auth/login',{body:new URLSearchParams({username:'operator',password,next:'/'}).toString(),headers:{host:'10.123.45.67:5491'}});assert.equal(r.status,403);assert.ok(!r.headers['set-cookie']);
  r=await req('POST','/auth/login',{body:new URLSearchParams({username:'operator',password:'wrong',next:'/',csrf}).toString(),headers:{host:'10.123.45.67:5491'}});assert.equal(r.status,401);assert.ok(!r.headers['set-cookie']);
  r=await req('POST','/auth/login',{body:new URLSearchParams({username:'operator',password,next:'/',csrf}).toString(),headers:{host:'10.123.45.67:5491'}});assert.equal(r.status,303);
  const cookie=String(r.headers['set-cookie']?.[0]||'').split(';')[0];assert.match(cookie,/^lr_wall_session=/);assert.match(String(r.headers['set-cookie']),/HttpOnly/);assert.match(String(r.headers['set-cookie']),/SameSite=Strict/);assert.doesNotMatch(String(r.headers['set-cookie']),/; Secure/);
  r=await req('GET','/',{headers:{cookie,host:'10.123.45.67:5491'}});assert.equal(r.status,200);assert.match(r.text,/LIVE OPERATOR STREAM/);const mutation=mutationCsrf(r.text);
  r=await req('GET','/desktop',{headers:{cookie,host:'10.123.45.67:5491'}});assert.equal(r.status,404);
  r=await req('POST','/api/pairing-code',{headers:{cookie,host:'10.123.45.67:5491','x-light-remote-csrf':mutation,'content-type':'application/json'},body:'{}'});assert.equal(r.status,200);assert.equal(pairingCalls,1);assert.match(r.text,/ABCD-EFGH/);
  r=await req('POST','/api/pairing-code',{headers:{cookie,host:'192.168.1.50:5491','content-type':'application/json'},body:'{}'});assert.equal(r.status,403);assert.equal(pairingCalls,1);assert.match(r.text,/csrf_invalid/);
  r=await req('POST','/api/desktop',{headers:{cookie,host:'10.123.45.67:5491','content-type':'application/json'},body:'{\"op\":\"status\"}'});assert.equal(r.status,404);assert.equal(desktopCalls,0);
  r=await req('POST','/api/desktop',{headers:{cookie,host:'10.123.45.67:5491','content-type':'application/json','x-light-remote-csrf':mutation},body:'{\"op\":\"status\"}'});assert.equal(r.status,404);assert.equal(desktopCalls,0);
  r=await req('POST','/api/pairing-code',{headers:{cookie,'x-light-remote-csrf':csrf,'content-type':'application/json'},body:'{}'});assert.equal(r.status,403);assert.equal(pairingCalls,1);
  r=await req('POST','/api/pairing-code',{headers:{cookie,host:'wall.example.test','x-light-remote-csrf':mutation,'content-type':'application/json'},body:'{}'});assert.equal(r.status,200);assert.equal(pairingCalls,2);
  r=await req('POST','/api/pairing-code',{headers:{'content-type':'application/json','x-light-remote-csrf':mutation},body:'{}'});assert.equal(r.status,401);assert.equal(pairingCalls,2);
  r=await req('POST','/auth/logout',{headers:{cookie,host:'10.123.45.67:5491'},body:new URLSearchParams({csrf:mutation}).toString()});assert.equal(r.status,303);assert.match(String(r.headers['set-cookie']),/Max-Age=0/);
  r=await req('GET','/login',{headers:{host:'192.168.1.50:5491'}});csrf=loginCsrf(r.text);
  const accountForm=new URLSearchParams({username:'owner@example.test',password:'account-password-123',next:'/',csrf}).toString();
  r=await req('POST','/auth/login',{body:accountForm,headers:{host:'192.168.1.50:5491','x-forwarded-proto':'https'}});assert.equal(r.status,303);assert.equal(accountAuthCalls,1);
  const accountCookie=String(r.headers['set-cookie']?.[0]||'').split(';')[0];assert.match(accountCookie,/^lr_wall_session=/);assert.match(String(r.headers['set-cookie']),/Secure/);
  r=await req('GET','/',{headers:{cookie:accountCookie}});assert.equal(r.status,200);assert.match(r.text,/Logout/);
  r=await req('GET','/login');csrf=loginCsrf(r.text);
  const badAccountForm=new URLSearchParams({username:'owner@example.test',password:'wrong-account-password',next:'/',csrf}).toString();
  r=await req('POST','/auth/login',{body:badAccountForm});assert.equal(r.status,401);assert.equal(accountAuthCalls,2);
  console.log('v09-local-wall-auth-login=PASS');
  console.log('v09-local-wall-account-login=PASS');
  console.log('v09-local-wall-recovery-login=PASS');
  console.log('v09-local-wall-auth-private-bind-required=PASS');
  console.log('v09-local-wall-auth-raw-netbird-host=PASS');
  console.log('v09-local-wall-auth-rfc1918-host=PASS');
  console.log('v09-local-wall-auth-session-csrf=PASS');
  console.log('v09-local-wall-rm-viewer-route-denied=PASS');
  console.log('v09-local-wall-auth-secret-cookie=PASS');
} finally {await wall.close();fs.rmSync(dir,{recursive:true,force:true});}
