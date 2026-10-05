import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PUBLIC_ORIGIN } from './config.mjs';

const CONFIG_FILE=String(process.env.LIGHT_REMOTE_GOOGLE_OAUTH_FILE||'/var/lib/light-remote-direct/plugin-state/google-oauth.json');
const flows=new Map();
const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

function config(){
  try{
    const row=JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8'));
    const clientId=String(row.clientId||'').trim(),clientSecret=String(row.clientSecret||'').trim();
    if(!clientId||!clientSecret)return null;
    return {clientId,clientSecret,redirectUri:String(row.redirectUri||`${PUBLIC_ORIGIN}/account/google/callback`)};
  }catch{return null;}
}
function prune(){const now=Date.now();for(const [k,v] of flows)if(v.expiresAt<=now)flows.delete(k);}
export function googleAuthStatus(){return {configured:Boolean(config()),origin:PUBLIC_ORIGIN,redirectUri:`${PUBLIC_ORIGIN}/account/google/callback`};}
export function saveGoogleAuthConfig({clientId,clientSecret}={}){
  const id=String(clientId||'').trim(),secret=String(clientSecret||'').trim();
  if(!/^[A-Za-z0-9._-]{20,220}\.apps\.googleusercontent\.com$/.test(id))throw Object.assign(new Error('invalid_google_client_id'),{status:400});
  if(secret.length<16||secret.length>512||/\s/.test(secret))throw Object.assign(new Error('invalid_google_client_secret'),{status:400});
  const dir=new URL('.',`file://${CONFIG_FILE}`).pathname;fs.mkdirSync(dir,{recursive:true,mode:0o750});
  const payload={schemaVersion:1,clientId:id,clientSecret:secret,redirectUri:`${PUBLIC_ORIGIN}/account/google/callback`},tmp=`${CONFIG_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp,`${JSON.stringify(payload,null,2)}\n`,{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,CONFIG_FILE);
  return googleAuthStatus();
}
export function beginGoogleAuth({returnTo='/account'}={}){
  const c=config();if(!c)throw Object.assign(new Error('google_oauth_not_configured'),{status:503});
  prune();
  const state=crypto.randomBytes(24).toString('base64url'),nonce=crypto.randomBytes(24).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  flows.set(state,{state,nonce,verifier,expiresAt:Date.now()+10*60_000,redirectUri:c.redirectUri,clientId:c.clientId,returnTo:String(returnTo||'/account')});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
  return {url:url.toString()};
}
export async function finishGoogleAuth({state,code}={}){
  const c=config();if(!c)throw Object.assign(new Error('google_oauth_not_configured'),{status:503});
  prune();const flow=flows.get(String(state||''));flows.delete(String(state||''));
  if(!flow||flow.expiresAt<=Date.now()||!code)throw Object.assign(new Error('google_oauth_state_invalid'),{status:401});
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,code:String(code),grant_type:'authorization_code',redirect_uri:flow.redirectUri,code_verifier:flow.verifier}),signal:AbortSignal.timeout(15_000)});
  const tokens=await response.json().catch(()=>({}));if(!response.ok||!tokens.id_token)throw Object.assign(new Error('google_oauth_token_exchange_failed'),{status:401});
  const {payload}=await jwtVerify(tokens.id_token,jwks,{issuer:['https://accounts.google.com','accounts.google.com'],audience:c.clientId});
  if(payload.nonce!==flow.nonce||payload.email_verified!==true||!payload.sub||!payload.email)throw Object.assign(new Error('google_identity_invalid'),{status:401});
  return {sub:String(payload.sub),email:String(payload.email).toLowerCase(),emailVerified:true,returnTo:String(flow.returnTo||'/account')};
}
