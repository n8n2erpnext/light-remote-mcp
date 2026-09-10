import fs from 'node:fs';
import http from 'node:http';

const wallBase=String(process.env.V09_MAINT_WALL_BASE||'http://100.94.184.141:5489').replace(/\/$/,'');
const nodeId=String(process.env.V09_MAINT_NODE||'dev_700ad1e57b626a18ffad9339');
const socketPath=String(process.env.OPERATOR_SOCKET||'/home/ubuntu/.local/run/gpt-vps-operator/operator.sock');
const cfg=JSON.parse(fs.readFileSync(process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json','utf8'));
const password=fs.readFileSync(process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password','utf8').trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let cookie='';

async function wall(path,options={}){
  const headers={...(options.headers||{})};
  if(cookie)headers.cookie=cookie;
  const r=await fetch(wallBase+path,{...options,headers,redirect:'manual'}),text=await r.text();
  let json;try{json=JSON.parse(text)}catch{json={raw:text}}
  return {status:r.status,json,headers:r.headers};
}
function socketGet(path){
  return new Promise((resolve,reject)=>{const req=http.request({socketPath,method:'GET',path},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json={raw:text}}resolve({status:res.statusCode,json});});});req.on('error',reject);req.end();});
}
function expect(ok,message){if(!ok)throw new Error(message);}
const loginBody=new URLSearchParams({username:String(cfg.username||''),password}).toString();
const login=await wall('/auth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:loginBody});
expect(login.status===303,`wall_login_failed:${login.status}:${login.json?.error||''}`);
const setCookies=login.headers.getSetCookie?.()||[login.headers.get('set-cookie')];
const rawCookie=setCookies.find(Boolean)||'';
cookie=String(rawCookie).split(';')[0];
expect(cookie.startsWith('__Host-gpt_operator_wall='),'wall_session_cookie_missing');

const device=await wall(`/api/devices/${encodeURIComponent(nodeId)}`);
expect(device.status===200,`device_read_failed:${device.status}:${device.json?.error||''}`);
const approved=device.json?.device?.policy?.approvedCapabilities||device.json?.device?.capabilities||device.json?.approvedCapabilities||[];
expect((device.json?.device?.platform||device.json?.platform)==='linux','maintenance_target_not_linux');
for(const cap of ['sudo-on-demand','systemctl'])expect(approved.includes(cap),`maintenance_capability_missing:${cap}`);

const queued=await wall(`/api/devices/${encodeURIComponent(nodeId)}/maintenance/update`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
expect(queued.status===200,`maintenance_queue_failed:${queued.status}:${queued.json?.error||''}`);
const maintenance=queued.json?.maintenance;
expect(maintenance?.accepted===true,'maintenance_not_accepted');
const jobId=maintenance?.job?.jobId;
const agentId=maintenance?.agentId||maintenance?.job?.agentId;
const sessionId=maintenance?.sessionId||maintenance?.job?.sessionId;
expect(jobId&&agentId&&sessionId,'maintenance_identity_missing');
let session=null;
const deadline=Date.now()+Number(process.env.V09_MAINT_TIMEOUT_MS||45000);
while(Date.now()<deadline){
  const current=await socketGet(`/v1/sessions/${encodeURIComponent(sessionId)}?agentId=${encodeURIComponent(agentId)}`);
  if(current.status===200){
    session=current.json?.session;
    if(session?.state==='closed')break;
  }
  await sleep(250);
}
expect(session?.state==='closed',`maintenance_session_not_closed:${session?.state||'unknown'}`);
expect((session.stats?.jobsFinished||0)>=1,`maintenance_job_not_finished:${JSON.stringify(session.stats||{})}`);
const activity=await socketGet('/v1/activity?limit=200');
expect(activity.status===200,'maintenance_activity_read_failed');
const finished=(activity.json?.events||[]).findLast?.(event=>event.type==='job_finished'&&event.jobId===jobId)
  ||[...(activity.json?.events||[])].reverse().find(event=>event.type==='job_finished'&&event.jobId===jobId);
expect(finished,`maintenance_job_finish_event_missing:${jobId}`);
expect(finished.status==='ok'&&finished.exitCode===0,`maintenance_job_failed:${finished.status}:${finished.exitCode}`);

const after=await wall(`/api/devices/${encodeURIComponent(nodeId)}`);
expect(after.status===200,`device_refresh_failed:${after.status}`);
console.log(JSON.stringify({
  ok:true,nodeId,jobId,sessionId,agentId,
  sessionState:session.state,sessionStats:session.stats,jobStatus:finished.status,jobExitCode:finished.exitCode,
  deviceState:after.json?.device?.state||after.json?.state||null,
  agentVersion:after.json?.device?.agentVersion||after.json?.agentVersion||null
},null,2));
console.log('v09-live-maintenance-update-trigger=PASS');
