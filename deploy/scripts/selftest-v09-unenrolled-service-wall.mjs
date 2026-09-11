import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root=new URL('../..',import.meta.url).pathname,dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-unenrolled-wall-'));
const state=path.join(dir,'device.json'),port=26000+(process.pid%8000),agent=`${root}/device-agent/operator-agent.mjs`;
const child=spawn(process.execPath,[agent,'daemon'],{cwd:root,env:{...process.env,OPERATOR_AGENT_STATE:state,OPERATOR_AGENT_WALL_PORT:String(port),OPERATOR_AGENT_DORMANT_CHECK_MS:'200'},stdio:['ignore','pipe','pipe']});
let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function get(target){return new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port,path:target},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text,json:target.startsWith('/api/')?JSON.parse(text):null}));});req.on('error',reject);});}
let ready=false;for(let i=0;i<60&&!ready;i++){try{const r=await get('/api/status');ready=r.status===200;}catch{}if(!ready)await sleep(50);}
if(!ready)throw new Error(`unenrolled_local_wall_not_ready:${err}`);
try{
  const status=await get('/api/status');
  if(status.json?.local?.enrolled!==false||status.json?.local?.cloudDesiredConnected!==false||status.json?.remote!==null)throw new Error('unenrolled_wall_state_wrong');
  const html=await get('/');
  if(html.status!==200||!html.text.includes('Light Remote')||!html.text.includes('Local Wall'))throw new Error('unenrolled_wall_html_wrong');
  await sleep(350);
  if(child.exitCode!==null)throw new Error(`unenrolled_service_exited:${child.exitCode}:${err}`);
  console.log(JSON.stringify({ok:true,serviceAlive:true,wallAvailable:true,enrolled:false,cloudDesiredConnected:false},null,2));
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve=>child.once('exit',resolve));
  fs.rmSync(dir,{recursive:true,force:true});
}
