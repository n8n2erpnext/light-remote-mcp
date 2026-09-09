import fs from 'node:fs';

const base=String(process.env.WALL_PROOF_BASE||'https://wall.dashboard.thaiduy.store').replace(/\/$/,'');
const authFile=process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json';
const passwordFile=process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password';
const config=JSON.parse(fs.readFileSync(authFile,'utf8'));
const password=fs.readFileSync(passwordFile,'utf8').trim();
const AMD_NODE=String(process.env.V08_AMD_NODE||'dev_700ad1e57b626a18ffad9339');
const form=new URLSearchParams({username:config.username,password}).toString();
const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form,redirect:'manual'});
const cookie=(login.headers.get('set-cookie')||'').split(';',1)[0];
if(login.status!==303||!cookie) throw new Error(`wall_login_failed:${login.status}`);
async function get(path){
  const r=await fetch(base+path,{headers:{cookie}}); const text=await r.text();
  let json; try{json=JSON.parse(text);}catch{json={raw:text};}
  if(r.status!==200) throw new Error(`wall_get_failed:${path}:${r.status}`);
  return json;
}
const devices=await get('/api/devices');
const activity=await get('/api/activity?limit=300');
const rows=devices.devices||devices.upstream?.devices||[];
const events=activity.events||activity.upstream?.events||[];
const arm=rows.find(d=>d.nodeId==='arm');
const amd=rows.find(d=>d.nodeId===AMD_NODE);
if(!arm||arm.state!=='online') throw new Error('wall_arm_device_missing');
if(!amd||amd.state!=='online') throw new Error('wall_amd_device_missing');
const armEvents=events.filter(e=>String(e.operationId||'').startsWith('op-v08-arm-'));
const amdEvents=events.filter(e=>String(e.operationId||'').startsWith('op-v08-amd-'));
if(!armEvents.some(e=>e.type==='job_finished'&&e.nodeId==='arm'&&e.status==='ok')) throw new Error('wall_arm_attribution_missing');
if(!amdEvents.some(e=>e.type==='job_finished'&&e.nodeId===AMD_NODE&&e.deviceId===AMD_NODE&&e.status==='ok')) throw new Error('wall_amd_attribution_missing');
console.log(JSON.stringify({arm:{nodeId:arm.nodeId,state:arm.state,events:armEvents.length},amd:{nodeId:amd.nodeId,state:amd.state,events:amdEvents.length,activeSessions:amd.activeSessions},activityVersion:activity.version||null},null,2));
console.log('LIVE_V08_WALL_ATTRIBUTION=PASS');
