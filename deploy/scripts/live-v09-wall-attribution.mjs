import fs from 'node:fs';
const base=String(process.env.WALL_PROOF_BASE||'https://wall.dashboard.thaiduy.store').replace(/\/$/,'');
const cfg=JSON.parse(fs.readFileSync(process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json','utf8'));
const password=fs.readFileSync(process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password','utf8').trim();
const nodeId=String(process.env.V09_WINDOWS_NODE||'');
if(!nodeId)throw new Error('V09_WINDOWS_NODE_required');
const form=new URLSearchParams({username:cfg.username,password}).toString();
const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form,redirect:'manual'});
const cookie=(login.headers.get('set-cookie')||'').split(';',1)[0];
if(login.status!==303||!cookie)throw new Error(`wall_login_failed:${login.status}`);
async function get(path){const r=await fetch(base+path,{headers:{cookie}});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}}if(r.status!==200)throw new Error(`wall_get_failed:${path}:${r.status}`);return j;}
const devices=await get('/api/devices');const activity=await get('/api/activity?limit=500');
const rows=devices.devices||devices.upstream?.devices||[];const events=activity.events||activity.upstream?.events||[];
const win=rows.find(d=>d.nodeId===nodeId);if(!win||win.state!=='online')throw new Error(`wall_windows_missing:${win?.state}`);
const winEvents=events.filter(e=>String(e.operationId||'').startsWith('op-v09-win-'));
const finished=winEvents.filter(e=>e.type==='job_finished'&&e.nodeId===nodeId&&e.deviceId===nodeId&&e.status==='ok');
if(finished.length<7)throw new Error(`wall_windows_attribution_incomplete:${finished.length}`);
console.log(JSON.stringify({windows:{nodeId:win.nodeId,state:win.state,activeSessions:win.activeSessions,capabilities:win.capabilities},events:winEvents.length,finishedOk:finished.length,types:[...new Set(winEvents.map(e=>e.type))].sort()},null,2));
console.log('LIVE_V09_WALL_ATTRIBUTION=PASS');
