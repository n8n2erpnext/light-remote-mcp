import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_TTL_SECONDS=12*60*60;
export const LOCAL_WALL_COOKIE='lr_wall_session';
function b64(v){return Buffer.from(v).toString('base64url');}
function fromB64(v){return Buffer.from(String(v),'base64url').toString('utf8');}
function safeEqual(a,b){const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
export function hashLocalWallPassword(password,salt=crypto.randomBytes(16)){
  const value=crypto.scryptSync(String(password),salt,32);
  return `scrypt$${Buffer.from(salt).toString('base64url')}$${value.toString('base64url')}`;
}
function verifyPassword(password,encoded){
  const [kind,saltB64,hashB64]=String(encoded||'').split('$');
  if(kind!=='scrypt'||!saltB64||!hashB64)return false;
  const expected=Buffer.from(hashB64,'base64url');if(expected.length!==32)return false;
  const actual=crypto.scryptSync(String(password||''),Buffer.from(saltB64,'base64url'),expected.length);
  return crypto.timingSafeEqual(expected,actual);
}
function signSession(secret,username,expiresAt){
  const nonce=crypto.randomBytes(16).toString('base64url');
  const body=`v1.${b64(username)}.${expiresAt}.${nonce}`;
  const sig=crypto.createHmac('sha256',Buffer.from(secret,'base64url')).update(`local-wall:${body}`).digest('base64url');
  return `${body}.${sig}`;
}
function verifySession(secret,token){
  const parts=String(token||'').split('.');if(parts.length!==5||parts[0]!=='v1')return null;
  const body=parts.slice(0,4).join('.'),expected=crypto.createHmac('sha256',Buffer.from(secret,'base64url')).update(`local-wall:${body}`).digest('base64url');
  if(!safeEqual(expected,parts[4]))return null;
  const expiresAt=Number(parts[2]);if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now())return null;
  let username;try{username=fromB64(parts[1]);}catch{return null;}return{username,expiresAt};
}
export function parseLocalWallCookies(header=''){
  const out={};for(const part of String(header).split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=part.slice(i+1).trim();}return out;
}
export function loadLocalWallAuth(file,{required=false}={}){
  if(!file||!fs.existsSync(file)){if(required)throw new Error('local_wall_auth_required_for_non_loopback');return{enabled:false};}
  const row=JSON.parse(fs.readFileSync(file,'utf8'));
  if(row.mode!=='local'||!row.username||!row.passwordHash||!row.cookieSecret)throw new Error('invalid_local_wall_auth_config');
  const ttlSeconds=Math.max(300,Math.min(Number(row.sessionTtlSeconds)||DEFAULT_TTL_SECONDS,7*24*60*60));
  const identity=req=>{const token=parseLocalWallCookies(req.headers.cookie)[LOCAL_WALL_COOKIE],value=verifySession(row.cookieSecret,token);return value&&safeEqual(value.username,row.username)?value:null;};
  const verifyCredentials=(username,password)=>safeEqual(username,row.username)&&verifyPassword(password,row.passwordHash);
  const issue=()=>{const expiresAt=Date.now()+ttlSeconds*1000;return{token:signSession(row.cookieSecret,row.username,expiresAt),expiresAt,ttlSeconds};};
  return{enabled:true,username:row.username,ttlSeconds,identity,verifyCredentials,issue};
}
export function writeLocalWallAuthConfig(file,{username='owner',password,cookieSecret=crypto.randomBytes(32).toString('base64url'),sessionTtlSeconds=DEFAULT_TTL_SECONDS,passwordHash=null}={}){
  const user=String(username||'owner').trim();if(!/^[A-Za-z0-9._@+-]{1,120}$/.test(user))throw new Error('invalid_local_wall_username');
  if(passwordHash==null&&String(password||'').length<12)throw new Error('local_wall_password_too_short');
  const encoded=passwordHash||hashLocalWallPassword(password);if(!/^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(String(encoded)))throw new Error('invalid_local_wall_password_hash');
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(String(cookieSecret)))throw new Error('invalid_local_wall_cookie_secret');
  const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});const tmp=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp,`${JSON.stringify({mode:'local',username:user,passwordHash:encoded,cookieSecret,sessionTtlSeconds},null,2)}\n`,{mode:0o600});
  fs.chmodSync(tmp,0o600);fs.renameSync(tmp,file);return{file,username:user,sessionTtlSeconds};
}
