import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PUBLIC_ORIGIN } from './config.mjs';

const googleState={config:{}};
let goldGooglePool=null;
export async function initializeGoldGoogleAuth(pool){
 if(!pool||typeof pool.query!=='function')throw Error('gold_google_postgres_required');
 goldGooglePool=pool;
 const {rows}=await pool.query('SELECT client_id,client_secret,redirect_uri FROM lr_gold_google_oauth_config WHERE singleton_id=1');
 const row=rows?.[0];
 googleState.config=row?{clientId:row.client_id,clientSecret:row.client_secret,redirectUri:row.redirect_uri}:{};
}
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
const PROFILE_REDIRECT_URI=`${PUBLIC_ORIGIN}/account/google/callback`;
const CLIENT_ID=/^[A-Za-z0-9._-]{20,220}\.apps\.googleusercontent\.com$/;
const STATE=/^[A-Za-z0-9_-]{32}$/;
const fault=(code,status)=>Object.assign(new Error(code),{status});

function credentials(row){
  const clientId=typeof row?.clientId==='string'?row.clientId.trim():'';
  const clientSecret=typeof row?.clientSecret==='string'?row.clientSecret.trim():'';
  if(!CLIENT_ID.test(clientId))throw fault('invalid_google_client_id',400);
  if(clientSecret.length<16||clientSecret.length>512||/\s/.test(clientSecret))
    throw fault('invalid_google_client_secret',400);
  return {clientId,clientSecret};
}
function configBinding(c){
  return crypto.createHmac('sha256',c.clientSecret)
    .update('light-remote-google-config-v1:'+JSON.stringify([c.clientId,c.redirectUri]))
    .digest('hex');
}
function assertFlowConfig(flow,c){
  const binding=typeof flow?.configBinding==='string'?flow.configBinding:'';
  if(!c||flow?.clientId!==c.clientId||flow?.redirectUri!==c.redirectUri||
      !/^[a-f0-9]{64}$/.test(binding)||
      !crypto.timingSafeEqual(Buffer.from(binding,'hex'),Buffer.from(configBinding(c),'hex')))
    throw fault('google_oauth_config_changed',409);
}

function config(){
  try{
    // A copied profile's old redirect_uri is historical metadata, never routing
    // authority. The callback always belongs to this running public origin.
    return {...credentials(googleState.config),redirectUri:PROFILE_REDIRECT_URI};
  }catch{return null;}
}
export function googleAuthStatus(){
  const current=config();
  return {configured:Boolean(current),origin:PUBLIC_ORIGIN,redirectUri:PROFILE_REDIRECT_URI,
    credentialsSource:current?'postgres':null,
    // Local credentials cannot prove the external Google Cloud allowlist.
    callbackRegistration:'unverified',
    storedRedirectRebased:Boolean(current&&googleState.config?.redirectUri&&
      googleState.config.redirectUri!==PROFILE_REDIRECT_URI)};
}
export async function saveGoogleAuthConfig({clientId,clientSecret}={}){
  const checked=credentials({clientId,clientSecret});
  const payload={schemaVersion:1,...checked,redirectUri:PROFILE_REDIRECT_URI};
  if(!goldGooglePool)throw Error('gold_google_pg_not_initialized');
  await goldGooglePool.query(`INSERT INTO lr_gold_google_oauth_config(singleton_id,client_id,client_secret,redirect_uri) VALUES(1,$1,$2,$3) ON CONFLICT(singleton_id) DO UPDATE SET client_id=EXCLUDED.client_id,client_secret=EXCLUDED.client_secret,redirect_uri=EXCLUDED.redirect_uri,updated_at=now()`,[payload.clientId,payload.clientSecret,payload.redirectUri]);
  googleState.config=payload;
  return googleAuthStatus();
}
export async function beginGoogleAuth({returnTo='/account'}={}){
  const c=config();if(!c)throw Object.assign(new Error('google_oauth_not_configured'),{status:503});
  const state=crypto.randomBytes(24).toString('base64url'),nonce=crypto.randomBytes(24).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const flow={state,nonce,verifier,expiresAt:Date.now()+10*60_000,redirectUri:c.redirectUri,clientId:c.clientId,configBinding:configBinding(c),returnTo:String(returnTo||'/account')};
  if(await googleRedis.set(flowKey(state),JSON.stringify(flow),{EX:600,NX:true})!=='OK')throw Error('google_oauth_state_not_saved');
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
  return {url:url.toString()};
}
export async function finishGoogleAuth({state,code}={}){
  const c=config();if(!c)throw Object.assign(new Error('google_oauth_not_configured'),{status:503});
  if(typeof state!=='string'||!STATE.test(state)||typeof code!=='string'||!code||code.length>8192)
    throw fault('google_oauth_state_invalid',401);
  const json=await googleRedis.getDel(flowKey(state));
  let flow;try{flow=json?JSON.parse(json):null;}catch{throw fault('google_oauth_state_invalid',401);}
  if(!flow||flow.state!==state||!Number.isFinite(flow.expiresAt)||flow.expiresAt<=Date.now()||
      typeof flow.verifier!=='string'||typeof flow.nonce!=='string')
    throw fault('google_oauth_state_invalid',401);
  assertFlowConfig(flow,c);
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,code:String(code),grant_type:'authorization_code',redirect_uri:flow.redirectUri,code_verifier:flow.verifier}),redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15_000)});
  assertFlowConfig(flow,config());
  const tokens=await response.json().catch(()=>({}));if(!response.ok||!tokens.id_token)throw Object.assign(new Error('google_oauth_token_exchange_failed'),{status:401});
  const {payload}=await jwtVerify(tokens.id_token,jwks,{issuer:['https://accounts.google.com','accounts.google.com'],audience:c.clientId});
  assertFlowConfig(flow,config());
  if(payload.nonce!==flow.nonce||payload.email_verified!==true||!payload.sub||!payload.email)throw Object.assign(new Error('google_identity_invalid'),{status:401});
  return {sub:String(payload.sub),email:String(payload.email).toLowerCase(),emailVerified:true,returnTo:String(flow.returnTo||'/account')};
}
