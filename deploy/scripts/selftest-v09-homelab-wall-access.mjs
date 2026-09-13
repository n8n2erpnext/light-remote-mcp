import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {writeLocalWallAuthConfig,loadLocalWallAuth} from '../../device-agent/local-wall-auth.mjs';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';

const isPrivate=ip=>{const p=String(ip).split('.').map(Number);return p.length===4&&(p[0]===10||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127));};
const addresses=Object.values(os.networkInterfaces()).flat().filter(x=>x?.family==='IPv4'&&!x.internal&&isPrivate(x.address)).map(x=>x.address);
const host=addresses.find(x=>x.startsWith('100.'))||addresses[0];if(!host)throw new Error('private_interface_required_for_homelab_test');
const root=new URL('../..',import.meta.url).pathname,dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-homelab-wall-'));
const authFile=path.join(dir,'wall-auth.json'),password='homelab-wall-password-123';writeLocalWallAuthConfig(authFile,{username:'operator',password});
const auth=loadLocalWallAuth(authFile,{required:true});
const listen=(server,bind=host)=>new Promise((resolve,reject)=>server.once('error',reject).listen(0,bind,()=>resolve(server.address().port)));
async function freePort(){const s=http.createServer();const p=await listen(s);await new Promise(r=>s.close(r));return p;}
function request(port,method,target,{headers={},body=null}={}){return new Promise((resolve,reject)=>{const data=body==null?null:Buffer.from(body),h={...headers};if(data)h['content-length']=data.length;const q=http.request({host,port,method,path:target,headers:h},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});q.on('error',reject);if(data)q.write(data);q.end();});}
const loginToken=html=>String(html).match(/name="csrf" value="([^"]+)"/)?.[1]||'';
const pageToken=html=>String(html).match(/const wallCsrf="([^"]+)"/)?.[1]||'';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const devicePort=await freePort();let pairCalls=0;
const deviceWall=startLocalWall({host,port:devicePort,brandSvgPath:path.join(root,'assets/branding/light-remote-mark.svg'),auth,
  getLocalStatus:async()=>({ok:true,enrolled:true,deviceId:'dev-homelab',deviceName:'HOMELAB',cloudDesiredConnected:true,cloudState:'connected'}),
  getRemoteStatus:async()=>({ok:true,device:{deviceId:'dev-homelab',displayName:'HOMELAB',state:'online'},connection:{state:'connected'},sessions:[],access:{pending:[]}}),
  getRemoteActivity:async()=>({events:[]}),pairingCode:async()=>{pairCalls++;return{code:'HOME-LAB1',expiresAt:Date.now()+60000};},
  connect:async()=>({state:'connected'}),disconnect:async()=>({state:'dormant'}),setGrace:async()=>({state:'connected'}),accessApprove:async()=>({}),accessDeny:async()=>({})
});
await sleep(80);
let r=await request(devicePort,'GET','/login');if(r.status!==200)throw new Error('homelab_device_login_page_failed');let csrf=loginToken(r.text);if(!csrf)throw new Error('homelab_device_login_csrf_missing');
let form=new URLSearchParams({username:'operator',password,next:'/',csrf}).toString();
r=await request(devicePort,'POST','/auth/login',{headers:{'content-type':'application/x-www-form-urlencoded'},body:form});if(r.status!==303)throw new Error(`homelab_device_login_failed:${r.status}`);
const deviceCookie=String(r.headers['set-cookie']?.[0]||'').split(';')[0];r=await request(devicePort,'GET','/',{headers:{cookie:deviceCookie}});if(r.status!==200||!r.text.includes('LIVE OPERATOR STREAM'))throw new Error('homelab_device_wall_failed');
const deviceCsrf=pageToken(r.text);if(!deviceCsrf)throw new Error('homelab_device_session_csrf_missing');
r=await request(devicePort,'POST','/api/pairing-code',{headers:{cookie:deviceCookie,'content-type':'application/json','x-light-remote-csrf':deviceCsrf},body:'{}'});if(r.status!==200||pairCalls!==1)throw new Error('homelab_device_mutation_failed');
await deviceWall.close();
console.log(`v09-homelab-device-wall-private-ip=PASS host=${host}`);

const stateFile=path.join(dir,'device.json'),identityFile=path.join(dir,'device-identity.json');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),deviceId='dev_homelab_fleet';
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64'),privateEncoded=privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
const publicKeySha256=crypto.createHash('sha256').update(Buffer.from(publicIdentityKey,'base64')).digest('hex');
fs.writeFileSync(stateFile,JSON.stringify({identity:{publicIdentityKey,publicKeySha256},enrollment:{deviceId,accountId:'self-hosted-local'}}));
fs.writeFileSync(identityFile,JSON.stringify({privateKey:privateEncoded,publicKey:publicIdentityKey}),{mode:0o600});let policyCalls=0,updateCalls=0;
const hub=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const body=JSON.parse(text||'{}'),action=String(req.url||'').split('/').pop();
  const expected=deviceChannelMessage({deviceId:body.deviceId,action,timestamp:body.timestamp,nonce:body.nonce,payload:body.payload});
  if(body.deviceId!==deviceId||!crypto.verify(null,Buffer.from(expected),publicKey,Buffer.from(String(body.signature||''),'base64url')))return reply(res,401,{error:'invalid_signature'});
  if(action==='fleet-authority')return reply(res,200,{ok:true,authority:{token:'fleet-homelab-token',lease:{leaseId:'fl_homelab',deviceId,expiresAt:Date.now()+60000}}});
  if(body.payload?.fleetToken!=='fleet-homelab-token')return reply(res,401,{ok:false,error:'fleet_authority_required'});
  const policy={policyRevision:1,policyProfile:'full',grantableCapabilities:['filesystem','git'],approvedCapabilities:['filesystem','git']};
  if(action==='fleet-devices')return reply(res,200,{ok:true,mainDeviceId:deviceId,devices:[{deviceId,nodeId:deviceId,displayName:'Homelab Main',state:'online',platform:'linux',architecture:'arm64',agentVersion:'0.9.0-rc.6',activeSessions:0,connection:{state:'connected',remainingMs:60000},policy}]});
  if(action==='fleet-sessions')return reply(res,200,{ok:true,mainDeviceId:deviceId,sessions:[]});
  if(action==='fleet-activity')return reply(res,200,{ok:true,mainDeviceId:deviceId,events:[]});
  if(action==='fleet-device-policy'){policyCalls++;return reply(res,200,{ok:true,policy:{...policy,policyRevision:2}});}
  if(action==='fleet-device-update'){updateCalls++;return reply(res,200,{ok:true,maintenance:{nodeId:deviceId,state:'queued'}});}
  return reply(res,404,{ok:false,error:'not_found'});
});
function reply(res,status,value){const data=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(data)});res.end(data);}
const hubPort=await new Promise((resolve,reject)=>hub.once('error',reject).listen(0,'127.0.0.1',()=>resolve(hub.address().port)));
const fleetPort=await freePort();
const child=spawn(process.execPath,[path.join(root,'device-agent/fleet-wall-runtime.mjs')],{cwd:root,env:{...process.env,OPERATOR_AGENT_STATE:stateFile,OPERATOR_AGENT_IDENTITY_FILE:identityFile,OPERATOR_AGENT_WALL_AUTH_FILE:authFile,OPERATOR_AGENT_HUB_URL:`http://127.0.0.1:${hubPort}`,OPERATOR_FLEET_WALL_HOST:host,OPERATOR_FLEET_WALL_PORT:String(fleetPort),OPERATOR_FLEET_AUTHORITY_CHECK_MS:'5000'},stdio:['ignore','pipe','pipe']});
let fleetErr='';child.stderr.on('data',d=>fleetErr+=d);
const until=Date.now()+5000;while(Date.now()<until){try{r=await request(fleetPort,'GET','/healthz');if(r.status===200)break;}catch{}await sleep(50);}if(r?.status!==200)throw new Error(`homelab_fleet_not_listening:${fleetErr}`);try{
  r=await request(fleetPort,'GET','/');if(r.status!==303)throw new Error(`homelab_fleet_auth_not_required:${r.status}`);
  r=await request(fleetPort,'GET','/login');if(r.status!==200)throw new Error('homelab_fleet_login_page_failed');csrf=loginToken(r.text);if(!csrf)throw new Error('homelab_fleet_login_csrf_missing');
  form=new URLSearchParams({username:'operator',password,next:'/',csrf}).toString();
  r=await request(fleetPort,'POST','/auth/login',{headers:{'content-type':'application/x-www-form-urlencoded'},body:form});if(r.status!==303)throw new Error(`homelab_fleet_login_failed:${r.status}:${r.text}`);
  const fleetCookie=String(r.headers['set-cookie']?.[0]||'').split(';')[0];
  r=await request(fleetPort,'GET','/',{headers:{cookie:fleetCookie}});if(r.status!==200||!r.text.includes('Fleet Wall · Main device'))throw new Error('homelab_fleet_wall_failed');
  r=await request(fleetPort,'GET',`/device-policy?id=${encodeURIComponent(deviceId)}`,{headers:{cookie:fleetCookie}});if(r.status!==200)throw new Error('homelab_fleet_policy_page_failed');const fleetCsrf=pageToken(r.text);if(!fleetCsrf)throw new Error('homelab_fleet_session_csrf_missing');
  const policyBody=JSON.stringify({policyProfile:'full',approvedCapabilities:['filesystem','git']});
  r=await request(fleetPort,'POST',`/api/devices/${deviceId}/policy`,{headers:{cookie:fleetCookie,'content-type':'application/json'},body:policyBody});if(r.status!==403||policyCalls!==0)throw new Error('homelab_fleet_missing_csrf_not_rejected');
  r=await request(fleetPort,'POST',`/api/devices/${deviceId}/policy`,{headers:{cookie:fleetCookie,'content-type':'application/json','x-light-remote-csrf':fleetCsrf},body:policyBody});if(r.status!==200||policyCalls!==1)throw new Error(`homelab_fleet_policy_mutation_failed:${r.status}`);
  r=await request(fleetPort,'POST',`/api/devices/${deviceId}/maintenance/update`,{headers:{cookie:fleetCookie,'x-light-remote-csrf':fleetCsrf},body:''});if(r.status!==200||updateCalls!==1)throw new Error(`homelab_fleet_update_mutation_failed:${r.status}`);
  console.log(`v09-homelab-fleet-wall-private-ip=PASS host=${host}`);
  console.log('v09-homelab-domain-not-required=PASS');
  console.log('v09-homelab-csrf-fail-closed=PASS');
} finally {
  child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3000)]);
  await new Promise(resolve=>hub.close(resolve));fs.rmSync(dir,{recursive:true,force:true});
}