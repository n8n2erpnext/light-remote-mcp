import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root=fileURLToPath(new URL('../..',import.meta.url)),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-unenrolled-wall-'));
const state=path.join(dir,'device.json'),auth=path.join(dir,'wall-auth.json'),port=26000+(process.pid%8000),agent=`${root}/device-agent/operator-agent.mjs`;
const child=spawn(process.execPath,[agent,'daemon'],{cwd:root,env:{...process.env,OPERATOR_AGENT_STATE:state,OPERATOR_AGENT_WALL_AUTH_FILE:auth,OPERATOR_AGENT_WALL_PORT:String(port),OPERATOR_AGENT_DORMANT_CHECK_MS:'200'},stdio:['ignore','pipe','pipe']});
let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function get(target){return new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port,path:target},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text,json:target.startsWith('/api/')?JSON.parse(text):null}));});req.on('error',reject);});}
let ready=false;for(let i=0;i<60&&!ready;i++){try{const r=await get('/login');ready=r.status===200;}catch{}if(!ready)await sleep(50);}
if(!ready)throw new Error(`unenrolled_local_wall_not_ready:${err}`);
try{
  const status=await get('/api/status');
  if(status.status!==401||!String(status.text).includes('wall_auth_required'))throw new Error('unenrolled_wall_status_not_gated');
  const html=await get('/');
  if(html.status!==303)throw new Error('unenrolled_wall_root_not_login_gated');
  const login=await get('/login');
  if(login.status!==200||!login.text.includes('Light Remote')||!login.text.includes('Device Wall login'))throw new Error('unenrolled_wall_login_html_wrong');
  const stored=JSON.parse(fs.readFileSync(auth,'utf8'));
  if(stored.mode!=='account-only'||stored.username!=='account')throw new Error('unenrolled_wall_account_gate_missing');
  await sleep(350);
  if(child.exitCode!==null)throw new Error(`unenrolled_service_exited:${child.exitCode}:${err}`);
  console.log(JSON.stringify({ok:true,serviceAlive:true,wallAvailable:true,loginGate:true,enrolled:false,cloudDesiredConnected:false},null,2));
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve=>child.once('exit',resolve));
  fs.rmSync(dir,{recursive:true,force:true});
}
