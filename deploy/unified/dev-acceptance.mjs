import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {apiPath,API_CONTRACT_VERSION} from '../../lib/api-contract.mjs';
import {DESKTOP_OWNER_CLIENT_ID,DESKTOP_OWNER_RESOURCE,DESKTOP_OWNER_SCOPE} from '../../plugin-server/desktop-auth-v4-contract.mjs';

const env=JSON.parse(fs.readFileSync('/state/runtime-env.json','utf8'));
if(env.LR_UNIFIED_DISPOSABLE_DEV!=='1')throw Error('disposable_dev_required');
const origin=env.LIGHT_REMOTE_PLUGIN_ORIGIN;
const ca=fs.readFileSync('/state/pki/public-ca.crt');
const credentials=JSON.parse(fs.readFileSync('/state/fixture-credentials.json','utf8'));
const report={sourceCommit:env.LR_UNIFIED_SOURCE_COMMIT,apiContractVersion:API_CONTRACT_VERSION,layer:'real-private-dev-integration',physicalAcceptance:false,checks:[],notVerified:['Windows native IPC/vault/tray on new artifact','Live signed B approval and remote command on new candidate','Positive device-signed Wall SSO redemption/browser relay','Reboot/rollback on Windows','macOS/Linux full installer']};
function record(name,actual){report.checks.push({name,status:'PASS',...actual})}
function request(path,{method='GET',body,headers={}}={}){
 return new Promise((resolve,reject)=>{
  const payload=body===undefined?null:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
  const req=https.request(new URL(path,origin),{method,ca,rejectUnauthorized:true,minVersion:'TLSv1.3',headers:{...(payload?{'content-type':'application/json','content-length':payload.length}:{}),...headers}},res=>{
   const parts=[];let size=0;
   res.on('data',x=>{size+=x.length;if(size>4*1024*1024)req.destroy(Error('response_limit'));else parts.push(x)});
   res.on('end',()=>{const text=Buffer.concat(parts).toString();let json;try{json=JSON.parse(text)}catch{}resolve({status:res.statusCode,headers:res.headers,text,json})});
  });
  req.setTimeout(10000,()=>req.destroy(Error('candidate_request_timeout')));req.on('error',reject);if(payload)req.write(payload);req.end();
 });
}
async function login(actor){
 const out=await request('/account/api?action=login',{method:'POST',body:credentials[actor],headers:{origin}});
 assert.equal(out.status,200,'real Portal password login');
 const cookie=out.headers['set-cookie']?.find(x=>x.startsWith('__Host-light_remote_account='));
 assert.ok(cookie?.includes('HttpOnly')&&cookie.includes('Secure'),'secure account cookie required');
 return cookie.split(';')[0];
}
const native=token=>({authorization:'Bearer '+token});
function agent(command,args=[]){
 const out=spawnSync(process.execPath,['device-agent/operator-agent.mjs',command,...args],{env:process.env,encoding:'utf8',timeout:25000});
 fs.writeFileSync('/state/agent-cli-'+command+'.private.log',(out.stdout||'')+(out.stderr||''),{mode:0o600});
 assert.equal(out.status,0,'actual Agent CLI '+command+'; see private log');
 return JSON.parse(fs.readFileSync('/state/home/.config/gpt-operator-agent-goldabv2/device.json','utf8'));
}
async function enrollAgent(cookie){
 let state=agent('login',['--no-wait']);assert.ok(state.pendingEnrollment?.enrollmentId);
 const approval=await request('/account/api?action=enrollment-approve',{method:'POST',headers:{origin,cookie},body:{code:state.pendingEnrollment.deviceCode,enrollmentId:state.pendingEnrollment.enrollmentId}});
 assert.equal(approval.status,200,'actual Owner enrollment approval');
 state=agent('poll');assert.equal(state.enrollment.accountId,'unified-dev-owner');assert.ok(state.enrollment.deviceId);
 agent('heartbeat');agent('connect');
 record('real Agent identity -> Owner approval -> signed enrollment/heartbeat/connect',{statusCode:200});
 let wall=false;
 for(let i=0;i<40;i++){
  try{
   const status=await new Promise((resolve,reject)=>{const req=http.get('http://127.0.0.1:5491/api/status',res=>{res.resume();resolve(res.statusCode)});req.setTimeout(1000,()=>req.destroy(Error('wall_wait')));req.on('error',reject)});
   if([200,401,303].includes(status)){wall=true;record('actual Agent daemon and Local Wall listening in private candidate',{statusCode:status});break}
  }catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(wall,'real candidate Local Wall');
 return state.enrollment.deviceId;
}
async function authorize(cookie){
 const verifier=crypto.randomBytes(32).toString('base64url'),state=crypto.randomBytes(32).toString('base64url'),nonce=crypto.randomBytes(32).toString('base64url');
 const redirect='http://127.0.0.1:45123/desktop/v4/callback';
 const query=new URLSearchParams({client_id:DESKTOP_OWNER_CLIENT_ID,resource:DESKTOP_OWNER_RESOURCE,scope:DESKTOP_OWNER_SCOPE,response_type:'code',code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),redirect_uri:redirect,state,install_nonce:nonce});
 const consent=await request(apiPath('ownerAuthorize')+'?'+query,{headers:{cookie}});
 assert.equal(consent.status,200,'Owner consent page must come from real backend');
 const csrf=/name="csrf" value="([A-Za-z0-9_-]{43})"/.exec(consent.text)?.[1];assert.ok(csrf,'consent CSRF');
 const approve=await request(apiPath('ownerAuthorize'),{method:'POST',body:new URLSearchParams({csrf,decision:'approve'}).toString(),headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'}});
 assert.equal(approve.status,303,'explicit browser Owner consent');
 const callback=new URL(approve.headers.location);assert.equal(callback.origin,new URL(redirect).origin);assert.equal(callback.searchParams.get('state'),state);
 const exchange={code:callback.searchParams.get('code'),code_verifier:verifier,redirect_uri:redirect,install_nonce:nonce,state};
 const token=await request(apiPath('ownerToken'),{method:'POST',body:exchange});assert.equal(token.status,200,'PKCE exchange');assert.equal(token.json.scope,DESKTOP_OWNER_SCOPE);
 assert.match(token.json.access_token,/^[A-Za-z0-9_-]{43}$/);
 const replay=await request(apiPath('ownerToken'),{method:'POST',body:exchange});assert.equal(replay.status,401,'one-time authorization code replay');
 record('Portal Owner consent -> PKCE native token; code replay rejected',{statusCode:200,replayStatus:replay.status});
 return token.json;
}
try{
 let healthy=false;
 for(let i=0;i<60;i++){
  try{const out=await request('/healthz');if(out.status===200&&out.json?.ok){assert.equal(out.headers['x-light-remote-api-version'],API_CONTRACT_VERSION);healthy=true;break}}catch{}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(healthy,'Plugin and Operator startup with real PG/Redis');record('real Plugin health/version header',{statusCode:200});
 const cross=await request('/account/api?action=login',{method:'POST',body:credentials.owner,headers:{origin:'https://foreign.invalid'}});assert.equal(cross.status,403);record('cross-origin Portal mutation denied',{statusCode:cross.status});
 const unauth=await request(apiPath('ownerSnapshot'),{method:'POST',body:{}});assert.equal(unauth.status,401);record('snapshot route enabled and unauthenticated caller denied',{statusCode:unauth.status});
 const cookie=await login('owner');const foreign=await login('foreign');
 const deviceId=await enrollAgent(cookie);
 const tokens=await authorize(cookie);record('two real Portal accounts use durable PG credentials',{accounts:2});
 const session=await request(apiPath('ownerSession'),{headers:native(tokens.access_token)});assert.equal(session.status,200);assert.equal(session.json.accountId,'unified-dev-owner');record('native Owner live family/session verified',{statusCode:session.status});
 const browser=await request(apiPath('ownerSession'),{headers:{...native(tokens.access_token),origin,cookie}});assert.equal(browser.status,403);record('native session refuses browser cookie/origin',{statusCode:browser.status});
 const snapshot=await request(apiPath('ownerSnapshot'),{method:'POST',body:{},headers:native(tokens.access_token)});assert.equal(snapshot.status,200,'real Operator snapshot');assert.equal(snapshot.json.ok,true);record('Desktop snapshot -> real private Operator -> PG/Redis',{statusCode:200});
 for(const kind of ['devices','grants','usage','jobs','sessions']){
  const page=await request(apiPath('ownerSnapshot'),{method:'POST',body:{page:{kind,limit:10}},headers:native(tokens.access_token)});
  assert.equal(page.status,200,'typed page '+kind);assert.equal(page.json.ok,true);if(kind==='devices')assert.ok(JSON.stringify(page.json).includes(deviceId),'new enrolled device visible through actual Desktop API');record('Owner-scoped typed '+kind+' page',{statusCode:page.status});
 }
 const invalid=await request(apiPath('ownerSnapshot'),{method:'POST',body:{accountId:'foreign',page:{kind:'devices',limit:10}},headers:native(tokens.access_token)});assert.equal(invalid.status,403);record('caller cannot inject a foreign account into snapshot',{statusCode:invalid.status});
 // An ordinary registered account cannot mint an Owner native token.
 const q=new URLSearchParams({client_id:DESKTOP_OWNER_CLIENT_ID,resource:DESKTOP_OWNER_RESOURCE,scope:DESKTOP_OWNER_SCOPE,response_type:'code',code_challenge_method:'S256',code_challenge:crypto.randomBytes(32).toString('base64url'),redirect_uri:'http://127.0.0.1:45123/desktop/v4/callback',state:crypto.randomBytes(32).toString('base64url'),install_nonce:crypto.randomBytes(32).toString('base64url')});
 const other=await request(apiPath('ownerAuthorize')+'?'+q,{headers:{cookie:foreign}});assert.equal(other.status,303);assert.ok(other.headers.location?.startsWith('/account/login?next='));assert.ok(!new URL(other.headers.location,origin).searchParams.has('code'));record('foreign non-Owner redirected to login without Owner code',{statusCode:other.status});
 const sso=await request(apiPath('ownerWallTicket'),{method:'POST',body:{device_id:'unified-nonexistent'},headers:native(tokens.access_token)});assert.equal(sso.status,403,'SSO enabled but unknown target denied');assert.equal(sso.json.error,'desktop_wall_sso_issue_denied');record('real mTLS SSO route denies unknown target',{statusCode:sso.status});
 const ticket=await request(apiPath('ownerWallTicket'),{method:'POST',body:{device_id:deviceId},headers:native(tokens.access_token)});assert.equal(ticket.status,200,'real enrolled device SSO ticket');assert.match(ticket.json.ticket,/^[A-Za-z0-9_-]{43}$/);record('real mTLS SSO issuer accepts current Owner and enrolled device',{statusCode:200});
 const fresh=await request(apiPath('ownerRefresh'),{method:'POST',body:{refresh_token:tokens.refresh_token}});assert.equal(fresh.status,200);assert.notEqual(fresh.json.refresh_token,tokens.refresh_token);record('native refresh token rotates atomically',{statusCode:200});
 const logout=await request(apiPath('ownerLogout'),{method:'POST',body:{},headers:native(fresh.json.access_token)});assert.equal(logout.status,200);
 const revoked=await request(apiPath('ownerSession'),{headers:native(fresh.json.access_token)});assert.equal(revoked.status,401);
 const revokedRefresh=await request(apiPath('ownerRefresh'),{method:'POST',body:{refresh_token:fresh.json.refresh_token}});assert.equal(revokedRefresh.status,401);record('logout revokes access and refresh family',{accessStatus:401,refreshStatus:401});
 report.result='PASS';
}catch(error){report.result='FAIL';report.failure={name:error.name,message:String(error.message).slice(0,250)};process.exitCode=1}
finally{
 fs.writeFileSync('/state/integration-report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report,null,2));
}
