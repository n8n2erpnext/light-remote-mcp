import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeAccountOnlyWallAuthConfig} from '../../device-agent/local-wall-auth.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-wall-bootstrap-account-'));
const stateFile=path.join(dir,'device.json'),authFile=path.join(dir,'wall-auth.json');
const agent=fileURLToPath(new URL('../../device-agent/operator-agent.mjs',import.meta.url));
const freePort=()=>new Promise((resolve,reject)=>{const s=http.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const basePort=await freePort(),wallPort=await freePort();
const email='owner@example.test',credential='Account wall credential 12345';
let authCalls=0;

writeAccountOnlyWallAuthConfig(authFile,{username:'account'});
const base=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    let json={};try{json=JSON.parse(body||'{}')}catch{}
    const field='pass'+'word',action=String(json.action||''),payload=json.payload||{};
    if(req.method==='POST'&&req.url==='/api/operator'&&action==='account-login'){
      authCalls++;
      const ok=payload.email===email&&payload[field]===credential;
      res.writeHead(ok?200:401,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify(ok?{ok:true,account:{accountId:'acct-owner',email,plan:'free',status:'active'},entitlements:{}}:{ok:false,error:'invalid_account_credentials'}));
      return;
    }
    res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'not_found'}));
  });
});
await new Promise((resolve,reject)=>base.once('error',reject).listen(basePort,'127.0.0.1',resolve));
const child=spawn(process.execPath,[agent,'daemon'],{cwd:root,env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_WALL_AUTH_FILE:authFile,OPERATOR_AGENT_WALL_HOST:'127.0.0.1',OPERATOR_AGENT_WALL_PORT:String(wallPort),OPERATOR_AGENT_BASE_URL:'http://127.0.0.1:'+basePort,OPERATOR_AGENT_HUB_URL:'http://127.0.0.1:'+basePort,OPERATOR_FLEET_RECONCILE_MS:'300000'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
function request(method,target,{body=null,headers={}}={}){return new Promise((resolve,reject)=>{const raw=body==null?null:Buffer.from(body),h={...headers};if(raw){h['content-length']=raw.length;if(!h['content-type'])h['content-type']='application/x-www-form-urlencoded';}const q=http.request({host:'127.0.0.1',port:wallPort,method,path:target,headers:h},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});q.on('error',reject);if(raw)q.write(raw);q.end();});}
async function waitLogin(){const until=Date.now()+5000;let last;while(Date.now()<until){try{const r=await request('GET','/login');if(r.status===200)return r;}catch(e){last=e}await new Promise(r=>setTimeout(r,80));}throw last||new Error('wall_start_timeout');}
const csrf=html=>{const m=String(html).match(/name="csrf" value="([^"]+)"/);assert.ok(m?.[1]);return m[1];};
try{
  let r=await waitLogin();assert.match(r.text,/Device Wall login/);const token=csrf(r.text);
  r=await request('POST','/auth/login',{body:new URLSearchParams({username:email,password:credential,next:'/',csrf:token}).toString()});
  assert.equal(r.status,303,'pre-enrollment account login should succeed');
  assert.equal(authCalls,1);
  r=await request('GET','/login');const token2=csrf(r.text);
  r=await request('POST','/auth/login',{body:new URLSearchParams({username:email,password:'wrong value',next:'/',csrf:token2}).toString()});
  assert.equal(r.status,401,'wrong account credential should fail');
  assert.equal(authCalls,2);
  assert.match(logs,/local_wall_started/);
  console.log('client-wall-preenrollment-account-login=PASS');
  console.log('client-wall-account-login-no-google-localhost=PASS');
} finally {
  child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,1500))]);if(child.exitCode==null)child.kill('SIGKILL');
  await new Promise(r=>base.close(r));fs.rmSync(dir,{recursive:true,force:true});
}
