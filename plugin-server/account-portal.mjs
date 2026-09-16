import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { callOperatorJson } from '../gateway/operator-proxy.mjs';
import { PUBLIC_ORIGIN } from './config.mjs';

const ROOT=path.resolve(import.meta.dirname,'..');
const COOKIE='__Host-light_remote_account';
const failures=new Map();
const portalFiles={
  account:path.join(ROOT,'index.html'),
  login:path.join(ROOT,'login/index.html'),
  register:path.join(ROOT,'register/index.html'),
  usage:path.join(ROOT,'usage/index.html'),
  settings:path.join(ROOT,'settings/index.html')
};
function cookies(req){const out={};for(const p of String(req.get('cookie')||'').split(';')){const i=p.indexOf('=');if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim());}return out;}
function token(req){return String(cookies(req)[COOKIE]||'');}
function sessionHeader(value){return {'x-light-account-session':value};}
function setCookie(res,value,expiresAt){const max=Math.max(60,Math.min(7*86400,Math.floor((Number(expiresAt)-Date.now())/1000)));res.append('Set-Cookie',`${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${max}; HttpOnly; Secure; SameSite=Strict; Priority=High`);}
function clearCookie(res){res.append('Set-Cookie',`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Priority=High`);}
function sameOrigin(req){const site=String(req.get('sec-fetch-site')||'').toLowerCase();if(site==='cross-site')return false;const origin=String(req.get('origin')||'');if(!origin)return true;try{return new URL(origin).origin===PUBLIC_ORIGIN;}catch{return false;}}
function rate(req){const key=crypto.createHash('sha256').update(String(req.ip||req.socket.remoteAddress||'unknown')).digest('hex').slice(0,24),cut=Date.now()-10*60_000,rows=(failures.get(key)||[]).filter(t=>t>cut);failures.set(key,rows);return {key,rows,blocked:rows.length>=10};}
function failRate(state){state.rows.push(Date.now());failures.set(state.key,state.rows);}
function noStore(res){res.set('Cache-Control','no-store');res.set('X-Robots-Tag','noindex, nofollow, noarchive');res.set('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");}
async function identity(req){const value=token(req);if(!value)return null;try{return await callOperatorJson('GET','/v1/accounts/me',null,sessionHeader(value));}catch{return null;}}
function requireToken(req,res){const value=token(req);if(!value){res.status(401).json({ok:false,error:'account_session_required'});return null;}return value;}
function safeError(res,error){return res.status(Number(error?.status)||400).json({ok:false,error:error?.payload?.error||error?.message||'account_request_failed'});}
function page(file){return (req,res)=>{noStore(res);return res.sendFile(file);};}

export function registerAccountPortal(app){
  const json=express.json({limit:'64kb'});
  app.use('/assets',express.static(path.join(ROOT,'assets'),{index:false,fallthrough:true,etag:false,maxAge:0}));
  app.get('/account',page(portalFiles.account));app.get('/account/',page(portalFiles.account));
  app.get('/login',page(portalFiles.login));app.get('/login/',page(portalFiles.login));
  app.get('/register',page(portalFiles.register));app.get('/register/',page(portalFiles.register));
  app.get('/usage',page(portalFiles.usage));app.get('/usage/',page(portalFiles.usage));
  app.get('/settings',page(portalFiles.settings));app.get('/settings/',page(portalFiles.settings));
  app.get('/',async(req,res,next)=>{if(await identity(req))return res.redirect(303,'/account');return next();});
  app.all('/api/auth',json,async(req,res)=>{
    noStore(res);const action=String(req.query?.action||'').trim();
    try{
      if(['register','login','logout','enrollment-approve','device-revoke','device-remove','device-update','devices-revoke-all','redeem-license','main-device','main-device-clear'].includes(action)&&!sameOrigin(req))return res.status(403).json({ok:false,error:'cross_site_request_denied'});
      if(action==='register'||action==='login'){
        if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
        const state=rate(req);if(state.blocked){res.set('Retry-After','600');return res.status(429).json({ok:false,error:'rate_limited',retryAfterSeconds:600});}
        try{const target=action==='register'?'/v1/accounts/register':'/v1/accounts/login',body=action==='register'?{email:req.body?.email,password:req.body?.password,ownerCode:req.body?.ownerCode}:{email:req.body?.email,password:req.body?.password};const row=await callOperatorJson('POST',target,body);failures.delete(state.key);setCookie(res,row.token,row.session?.expiresAt);return res.status(action==='register'?201:200).json({ok:true,account:row.account,session:row.session});}catch(error){failRate(state);return safeError(res,error);}
      }
      if(action==='me'||action==='devices'||action==='usage'){
        if(req.method!=='GET')return res.status(405).json({ok:false,error:'method_not_allowed'});const value=requireToken(req,res);if(!value)return;
        const target=action==='me'?'/v1/accounts/me':action==='devices'?'/v1/accounts/devices':`/v1/accounts/usage?months=${Math.max(1,Math.min(Number(req.query?.months)||6,24))}`;
        return res.json(await callOperatorJson('GET',target,null,sessionHeader(value)));
      }
      if(action==='logout'){
        if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});const value=token(req);if(value)await callOperatorJson('POST','/v1/accounts/logout',{},sessionHeader(value)).catch(()=>{});clearCookie(res);return res.json({ok:true,loggedOut:true});
      }
      const value=requireToken(req,res);if(!value)return;if(req.method!=='POST')return res.status(405).json({ok:false,error:'method_not_allowed'});
      let target='',body={};
      if(action==='enrollment-approve'){target='/v1/accounts/enrollments/approve';body={code:req.body?.code};}
      else if(action==='device-update'){const id=String(req.body?.deviceId||'');if(req.body?.force!==true)return res.status(428).json({ok:false,error:'force_update_confirmation_required'});target=`/v1/accounts/devices/${encodeURIComponent(id)}/update`;body={force:true};}
      else if(action==='device-revoke'){target=`/v1/accounts/devices/${encodeURIComponent(String(req.body?.deviceId||''))}/revoke`;}
      else if(action==='device-remove'){target=`/v1/accounts/devices/${encodeURIComponent(String(req.body?.deviceId||''))}/remove`;}
      else if(action==='devices-revoke-all'){target='/v1/accounts/devices/revoke-all';}
      else if(action==='main-device'){target='/v1/accounts/main-device';body={deviceId:req.body?.deviceId};}
      else if(action==='main-device-clear'){target='/v1/accounts/main-device/clear';}
      else if(action==='redeem-license'){target='/v1/accounts/redeem-license';body={key:req.body?.key};}
      else return res.status(400).json({ok:false,error:'unknown_account_action'});
      return res.json(await callOperatorJson('POST',target,body,sessionHeader(value)));
    }catch(error){return safeError(res,error);}
  });
}

export function pruneAccountPortalState(){const cut=Date.now()-10*60_000;for(const [key,rows] of failures){const live=rows.filter(t=>t>cut);if(live.length)failures.set(key,live);else failures.delete(key);}}
