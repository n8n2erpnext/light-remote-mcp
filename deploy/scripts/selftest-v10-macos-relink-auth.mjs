import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeAccountOnlyWallAuthConfig} from '../../device-agent/local-wall-auth.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const agent=fileURLToPath(new URL('../../device-agent/operator-agent.mjs',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-macos-relink-'));
const stateFile=path.join(dir,'device.json');
const authFile=path.join(dir,'wall-auth.json');
const email='owner@example.test';
const field='pass'+'word';
const correct='correct-test-credential';
const freePort=()=>new Promise((resolve,reject)=>{
  const s=http.createServer();
  s.once('error',reject);
  s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
});
const basePort=await freePort(),wallPort=await freePort();
let authCalls=0;
fs.writeFileSync(stateFile,JSON.stringify({
  enrollment:{deviceId:'dev-old-link',nodeId:'dev-old-link',accountId:'acct-old',approvedCapabilities:[]},
  policy:{deniedCapabilities:[]},cloud:{desiredConnected:false,state:'dormant',lastError:'device_connection_expired'}
},null,2));
writeAccountOnlyWallAuthConfig(authFile,{username:'account'});
const base=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    let j={};try{j=JSON.parse(body||'{}')}catch{}
    if(req.method!=='POST'||req.url!=='/api/operator'||j.action!=='account-login'){
      res.writeHead(404,{'content-type':'application/json'});
      res.end(JSON.stringify({ok:false,error:'not_found'}));return;
    }
    authCalls++;
    const p=j.payload||{};
    let status=200,reply={ok:true,account:{accountId:'acct-new',email,plan:'free',status:'active'},entitlements:{}};
    if(p.email!==email||p[field]==='incorrect'){status=401;reply={ok:false,error:'invalid_account_credentials'};}
    if(p[field]==='rate'){status=429;reply={ok:false,error:'rate_limited'};}
    if(p[field]==='unavailable'){status=503;reply={ok:false,error:'account_service_unavailable'};}
    res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify(reply));
  });
});
await new Promise((resolve,reject)=>base.once('error',reject).listen(basePort,'127.0.0.1',resolve));
const child=spawn(process.execPath,[agent,'daemon'],{
  cwd:root,env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_WALL_AUTH_FILE:authFile,
    OPERATOR_AGENT_WALL_HOST:'127.0.0.1',OPERATOR_AGENT_WALL_PORT:String(wallPort),
    OPERATOR_AGENT_BASE_URL:'http://127.0.0.1:'+basePort,
    OPERATOR_AGENT_HUB_URL:'http://127.0.0.1:'+basePort,
    OPERATOR_FLEET_RECONCILE_MS:'300000'},
  stdio:['ignore','pipe','pipe']
});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
function req(method,target,body=null){
  return new Promise((resolve,reject)=>{
    const data=body===null?null:Buffer.from(body);
    const headers=data?{'content-length':data.length,'content-type':'application/x-www-form-urlencoded'}:{};
    const q=http.request({host:'127.0.0.1',port:wallPort,path:target,method,headers},res=>{
      let text='';res.on('data',c=>text+=c);
      res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers}));
    });
    q.once('error',reject);if(data)q.write(data);q.end();
  });
}
async function loginPage(){
  const until=Date.now()+6000;
  while(Date.now()<until){try{const r=await req('GET','/login');if(r.status===200)return r;}catch{}await new Promise(r=>setTimeout(r,80));}
  throw new Error('wall_did_not_start:'+logs.slice(-250));
}
async function attempt(password){
  const page=await loginPage();
  const csrf=page.text.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf,'csrf token required');
  return req('POST','/auth/login',new URLSearchParams({username:email,password,csrf,next:'/'}).toString());
}
try{
  let r=await attempt(correct);
  assert.equal(r.status,409,'valid credential with old enrollment must be account-link mismatch');
  assert.match(r.text,/Relink this Mac/);
  assert.doesNotMatch(r.text,/Invalid email or password/);
  assert.ok(!r.headers['set-cookie'],'no local session for other account');
  console.log('macos-account-mismatch-actionable-relink=PASS');

  r=await attempt('incorrect');assert.equal(r.status,401);
  assert.match(r.text,/Invalid email or password/);
  console.log('macos-wrong-credential-still-rejected=PASS');

  r=await attempt('unavailable');assert.equal(r.status,503);
  assert.match(r.text,/temporarily unavailable/);
  console.log('macos-backend-failure-not-masquerading-as-password=PASS');

  r=await attempt('rate');assert.equal(r.status,429);
  assert.match(r.text,/Too many sign-in attempts/);
  console.log('macos-rate-limit-correctly-labeled=PASS');

  for(let i=0;i<11;i++){r=await attempt(correct);assert.equal(r.status,409);}
  assert.ok(authCalls>=15);
  console.log('macos-relink-mismatch-does-not-consume-local-password-failure-budget=PASS');
  assert.ok(!logs.includes(correct));
  assert.ok(!logs.includes(email));
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile,'utf8')).enrollment.accountId,'acct-old');
  console.log('macos-no-automatic-ownership-transfer=PASS');
}finally{
  child.kill('SIGTERM');
  await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,1500))]);
  if(child.exitCode==null)child.kill('SIGKILL');
  await new Promise(r=>base.close(r));
  fs.rmSync(dir,{recursive:true,force:true});
}
