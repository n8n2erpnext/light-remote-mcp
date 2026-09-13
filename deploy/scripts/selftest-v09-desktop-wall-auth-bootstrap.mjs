import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-desktop-wall-auth-'));
const stateFile=path.join(dir,'device.json'),authFile=path.join(dir,'wall-auth.json');
const agent=fileURLToPath(new URL('../../device-agent/operator-agent.mjs',import.meta.url));
fs.writeFileSync(stateFile,JSON.stringify({enrollment:{deviceId:'dev-desktop-auth',nodeId:'dev-desktop-auth',accountId:'acct-test',approvedCapabilities:[]},policy:{deniedCapabilities:[]},cloud:{desiredConnected:false,state:'dormant'}},null,2));
const freePort=()=>new Promise((resolve,reject)=>{const s=http.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const port=await freePort();
const child=spawn(process.execPath,[agent,'daemon'],{env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_WALL_AUTH_FILE:authFile,OPERATOR_AGENT_WALL_HOST:'127.0.0.1',OPERATOR_AGENT_WALL_PORT:String(port),OPERATOR_AGENT_BASE_URL:'http://127.0.0.1:1',OPERATOR_AGENT_HUB_URL:'http://127.0.0.1:1',OPERATOR_FLEET_RECONCILE_MS:'300000'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
function request(target){return new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port,path:target,method:'GET'},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});r.on('error',reject);r.end();});}
async function waitForWall(){const until=Date.now()+5000;let last;while(Date.now()<until){try{return await request('/');}catch(e){last=e;await new Promise(r=>setTimeout(r,80));}}throw last||new Error('desktop_wall_start_timeout');}
try{
  const root=await waitForWall();assert.equal(root.status,303);assert.match(String(root.headers.location),/^\/login\?next=/);
  const stored=JSON.parse(fs.readFileSync(authFile,'utf8'));assert.equal(stored.mode,'account-only');assert.equal(stored.username,'account');
  const login=await request('/login');assert.equal(login.status,200);assert.match(login.text,/Device Wall login/);
  console.log('v09-desktop-wall-auth-bootstrap=PASS');
  console.log('v09-desktop-wall-login-gate=PASS');
} finally {
  child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,1500))]);
  if(child.exitCode==null)child.kill('SIGKILL');fs.rmSync(dir,{recursive:true,force:true});
}
