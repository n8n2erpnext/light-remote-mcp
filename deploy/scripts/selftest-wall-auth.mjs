import fs from 'node:fs';
import crypto from 'node:crypto';
import { createWallAuth, hashWallPassword } from '../../gateway/wall-auth.mjs';

const file=`/tmp/gpt-wall-auth-${process.pid}.json`;
const password='selftest-wall-password';
fs.writeFileSync(file, JSON.stringify({mode:'local',username:'operator',passwordHash:hashWallPassword(password),cookieSecret:crypto.randomBytes(32).toString('base64url'),sessionTtlSeconds:900}), {mode:0o600});
function req(body={},cookie=''){return {body,headers:{cookie},ip:'127.0.0.1',socket:{remoteAddress:'127.0.0.1'}};}
function response(){return {statusCode:200,headers:{},body:null,redirected:null,status(n){this.statusCode=n;return this;},set(k,v){this.headers[k.toLowerCase()]=v;return this;},type(){return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;},redirect(n,p){this.statusCode=n;this.redirected=p;return this;}};}
try {
  const auth=createWallAuth({configFile:file});
  let r=response(); auth.login(req({username:'operator',password:'wrong'}),r); if(r.statusCode!==401) throw new Error('bad password not rejected');
  const fresh=createWallAuth({configFile:file}); r=response(); fresh.login(req({username:'operator',password}),r); if(r.statusCode!==303||r.redirected!=='/') throw new Error('valid login failed');
  const setCookie=r.headers['set-cookie']; if(!/HttpOnly/.test(setCookie)||!/Secure/.test(setCookie)||!/SameSite=Strict/.test(setCookie)||!/Path=\//.test(setCookie)) throw new Error('cookie flags missing');
  const cookie=setCookie.split(';',1)[0];
  r=response(); let next=false; fresh.requireApi(req({},cookie),r,()=>{next=true;}); if(!next) throw new Error('authenticated api rejected');
  r=response(); next=false; fresh.requireApi(req({},cookie+'x'),r,()=>{next=true;}); if(next||r.statusCode!==401) throw new Error('tampered cookie accepted');
  const limited=createWallAuth({configFile:file}); for(let i=0;i<10;i++){r=response();limited.login(req({username:'operator',password:'bad'}),r);} r=response();limited.login(req({username:'operator',password:'bad'}),r); if(r.statusCode!==429||!r.headers['retry-after']) throw new Error('rate limit missing');
  r=response(); fresh.logout(req(),r); if(r.statusCode!==303||!/Max-Age=0/.test(r.headers['set-cookie'])) throw new Error('logout cookie clear failed');
  console.log('wall-auth-local=PASS');
  console.log('wall-auth-cookie-flags=PASS');
  console.log('wall-auth-tamper=PASS');
  console.log('wall-auth-rate-limit=PASS');
} finally { try{fs.unlinkSync(file);}catch{} }
