import fs from 'node:fs';
import crypto from 'node:crypto';

const base=String(process.env.BRIDGE_PROOF_BASE||'https://light-remote-mcp.vercel.app').replace(/\/$/,'');
const configFile=process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json';
const passwordFile=process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password';
const cfg=JSON.parse(fs.readFileSync(configFile,'utf8'));
const password=fs.readFileSync(passwordFile,'utf8').trim();
async function request(path,options={}){
  const response=await fetch(base+path,options);
  const text=await response.text();
  let json; try{json=JSON.parse(text);}catch{json={raw:text};}
  return {status:response.status,json};
}
const anonymous=await request('/api/operator?action=capabilities');
if(anonymous.status!==401||anonymous.json?.upstream?.error!=='bridge_session_required') throw new Error(`anonymous_guard_failed:${anonymous.status}`);
const login=await request('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:cfg.username,password})});
if(login.status!==200||!login.json?.session?.token) throw new Error(`auth_failed:${login.status}:${login.json?.error}`);
const token=login.json.session.token;
const headers={'x-bridge-session':token};
const caps=await request('/api/operator?action=capabilities',{headers});
if(caps.status!==200||caps.json?.upstream?.version!=='0.6.0-dev') throw new Error(`caps_failed:${caps.status}`);
const devices=await request('/api/operator?action=devices',{headers});
if(devices.status!==200||!Array.isArray(devices.json?.upstream?.devices)) throw new Error(`devices_failed:${devices.status}`);
const agentId='agent-prod-v06-'+crypto.randomBytes(12).toString('hex');
const openId='open-prod-v06-'+crypto.randomBytes(8).toString('hex');
const postHeaders={...headers,'content-type':'application/json'};
const opened=await request('/api/operator',{method:'POST',headers:postHeaders,body:JSON.stringify({action:'session-open',payload:{agentId,openId,label:'v0.6 production acceptance',workspace:'/home/ubuntu',leasePreset:'1h'}})});
if(opened.status!==200||opened.json?.upstream?.session?.leaseMs!==3600000) throw new Error(`open_failed:${opened.status}:${opened.json?.error}`);
const sessionId=opened.json.upstream.session.sessionId;
const closed=await request('/api/operator',{method:'POST',headers:postHeaders,body:JSON.stringify({action:'session-close',sid:sessionId,aid:agentId})});
if(closed.status!==200||closed.json?.upstream?.session?.state!=='closed') throw new Error(`close_failed:${closed.status}`);
console.log(JSON.stringify({
  anonymous:anonymous.status,auth:login.status,bridgeTtlSeconds:login.json.session.expiresInSeconds,
  capabilities:caps.status,devices:devices.json.upstream.devices.map(d=>({id:d.deviceId||d.id,nodeId:d.nodeId,state:d.state})),
  leaseMs:opened.json.upstream.session.leaseMs,closed:closed.json.upstream.session.state
},null,2));
console.log('LIVE_V06_PRODUCTION_PROOF=PASS');
