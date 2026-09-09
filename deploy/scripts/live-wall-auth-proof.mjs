import fs from 'node:fs';

const base=String(process.env.WALL_PROOF_BASE||'').replace(/\/$/,'');
if(!/^https?:\/\//.test(base)) throw new Error('WALL_PROOF_BASE_required');
const authFile=process.env.WALL_AUTH_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-auth.json';
const passwordFile=process.env.WALL_BOOTSTRAP_PASSWORD_FILE||'/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password';
const config=JSON.parse(fs.readFileSync(authFile,'utf8'));
const password=fs.readFileSync(passwordFile,'utf8').trim();
if(!config.username||!password) throw new Error('wall_proof_credentials_unavailable');
const form=(username,pw)=>new URLSearchParams({username,password:pw}).toString();

let r=await fetch(base+'/',{redirect:'manual'});
if(r.status!==303||r.headers.get('location')!=='/login') throw new Error('root_unauth_failed');
console.log('wall-root-unauth=303');
r=await fetch(base+'/api/sessions');
if(r.status!==401) throw new Error('api_unauth_failed');
console.log('wall-api-unauth=401');
r=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form(config.username,'definitely-wrong'),redirect:'manual'});
if(r.status!==401) throw new Error('bad_login_failed');
console.log('wall-bad-login=401');
r=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form(config.username,password),redirect:'manual'});
const setCookie=r.headers.get('set-cookie')||'';
const cookie=setCookie.split(';',1)[0];
if(r.status!==303||!cookie) throw new Error('valid_login_failed');
console.log('wall-valid-login=303 cookie=issued');
const authHeaders={cookie};
for(const path of ['/','/api/devices','/api/sessions','/api/activity?limit=1']){
  r=await fetch(base+path,{headers:authHeaders,redirect:'manual'});
  if(r.status!==200) throw new Error(`auth_path_failed:${path}:${r.status}`);
  console.log(`wall-auth-path=${path}:200`);
}
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),1500);
try{
  r=await fetch(base+'/events',{headers:authHeaders,signal:controller.signal});
  if(r.status!==200) throw new Error(`sse_auth_failed:${r.status}`);
  console.log('wall-sse-auth=200');
}catch(error){
  if(error?.name!=='AbortError') throw error;
  console.log('wall-sse-auth=stream-open');
}finally{ clearTimeout(timer); }
r=await fetch(base+'/auth/logout',{method:'POST',headers:authHeaders,redirect:'manual'});
const clear=r.headers.get('set-cookie')||'';
if(r.status!==303||!/Max-Age=0/.test(clear)) throw new Error('logout_failed');
console.log('wall-logout=303 clear-cookie=PASS');
console.log('LIVE_WALL_AUTH_PROOF=PASS');
