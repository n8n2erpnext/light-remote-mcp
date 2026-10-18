import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PUBLIC_ORIGIN } from './config.mjs';

const googleState={config:{}};
export function mountGoldGoogleAuth(registries){registries.mount('google_oauth',googleState)}
let googleRedis=null,googleRedisPrefix='';
export function initializeGoogleRedis(client,prefix){
 if(!client||typeof client.getDel!=='function'||typeof client.set!=='function'||!/^lr:gold:[a-z0-9_-]+:$/.test(prefix||''))
  throw Error('gold_google_redis_required');
 googleRedis=client;googleRedisPrefix=prefix+'google:flow:';
}
function flowKey(state){
 if(!googleRedis)throw Error('gold_google_redis_not_initialized');
 return googleRedisPrefix+crypto.createHash('sha256').update(String(state||'')).digest('hex');
}
const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

function config(){
  const row=googleState.config||{};
  const clientId=String(row.clientId||'').trim(),clientSecret=String(row.clientSecret||'').trim();
  if(!clientId||!clientSecret)return null;
  return {clientId,clientSecret,redirectUri:String(row.redirectUri||`${PUBLIC_ORIGIN}/account/google/callback`)};
}
export function googleAuthStatus(){return {configured:Boolean(config()),origin:PUBLIC_ORIGIN,redirectUri:`${PUBLIC_ORIGIN}/account/google/callback`};}
export function saveGoogleAuthConfig({clientId,clientSecret}={}){
  const id=String(clientId||'').trim(),secret=String(clientSecret||'').trim();
  if(!/^[A-Za-z0-9._-]{20,220}\.apps\.googleusercontent\.com$/.test(id))throw Object.assign(new Error('invalid_google_client_id'),{status:400});
  if(secret.length<16||secret.length>512||/\s/.test(secret))throw Object.assign(new Error('invalid_google_client_secret'),{status:400});
  const payload={schemaVersion:1,clientId:id,clientSecret:secret,redirectUri:`${PUBLIC_ORIGIN}/account/google/callback`};
  if(typeof googleState._persist!=='function')throw Error('gold_google_pg_not_initialized');
  googleState.config=payload;
  googleState._persist();
  return googleAuthStatus();
}
export async function beginGoogleAuth({returnTo='/account'}={}){
  const c=config();if(!c)throw Object.assign(new Error('google_oauth_not_configured'),{status:503});
  const state=crypto.randomBytes(24).toString('base64url'),nonce=crypto.randomBytes(24).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const flow={state,nonce,verifier,expiresAt:Date.now()+10*60_000,redirectUri:c.redirectUri,clientId:c.clientId,returnTo:String(returnTo||'/account')};
  if(await googleRedis.set(flowKey(state),JSON.stringify(flow),{EX:600,NX:true})!=='OK')throw Error('google_oauth_state_not_saved');
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
  return {url:url.toString()};
}
export async function finishGoogleAuth({state,code}={}){
  const c=config();if(!c)throw Object.assign(new Error('google_oauth_not_configured'),{status:503});
  const json=await googleRedis.getDel(flowKey(state));
  const flow=json?JSON.parse(json):null;
  if(!flow||flow.expiresAt<=Date.now()||!code)throw Object.assign(new Error('google_oauth_state_invalid'),{status:401});
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,code:String(code),grant_type:'authorization_code',redirect_uri:flow.redirectUri,code_verifier:flow.verifier}),signal:AbortSignal.timeout(15_000)});
  const tokens=await response.json().catch(()=>({}));if(!response.ok||!tokens.id_token)throw Object.assign(new Error('google_oauth_token_exchange_failed'),{status:401});
  const {payload}=await jwtVerify(tokens.id_token,jwks,{issuer:['https://accounts.google.com','accounts.google.com'],audience:c.clientId});
  if(payload.nonce!==flow.nonce||payload.email_verified!==true||!payload.sub||!payload.email)throw Object.assign(new Error('google_identity_invalid'),{status:401});
  return {sub:String(payload.sub),email:String(payload.email).toLowerCase(),emailVerified:true,returnTo:String(flow.returnTo||'/account')};
}
