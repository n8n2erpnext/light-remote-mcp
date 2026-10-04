import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callOperatorJson } from './operator-client.mjs';
import { PUBLIC_ORIGIN } from './config.mjs';

const COOKIE='__Host-light_remote_account';
const ADMIN_ACCOUNT_ID=String(process.env.LIGHT_REMOTE_ADMIN_ACCOUNT_ID||'direct-production-local');
const adminFile=name=>fileURLToPath(new URL('./admin-portal/'+name,import.meta.url));

function parseCookies(header=''){
  const out={};
  for(const part of String(header).split(';')){
    const i=part.indexOf('=');
    if(i<1)continue;
    out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function token(req){return String(parseCookies(req.headers?.cookie||'')[COOKIE]||'');}
function headers(value){return {'x-light-account-session':value};}
function sameOrigin(req){
  const site=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
  if(site==='cross-site')return false;
  if(site==='same-origin')return true;
  const origin=String(req.headers?.origin||'').trim();
  if(!origin)return true;
  try{return new URL(origin).origin===PUBLIC_ORIGIN;}catch{return false;}
}
async function identity(req){
  const value=token(req);
  if(!value)return {ok:false,status:401,error:'account_session_required'};
  try{
    const me=await callOperatorJson('GET','/v1/accounts/me',null,headers(value));
    if(String(me.account?.accountId||'')!==ADMIN_ACCOUNT_ID)return {ok:false,status:403,error:'admin_account_required'};
    return {ok:true,token:value,me};
  }catch(error){
    return {ok:false,status:Number(error?.status)||401,error:error?.payload?.error||error?.message||'account_session_required'};
  }
}
async function requireAdmin(req,res,{html=false}={}){
  const row=await identity(req);
  if(row.ok)return row;
  if(html&&row.status===401){res.redirect(303,'/account/login');return null;}
  if(html){res.status(row.status).type('text').send('Admin account required.');return null;}
  res.status(row.status).json({ok:false,error:row.error});return null;
}
function sendAdmin(res){return res.type('html').send(fs.readFileSync(adminFile('index.html')));}

export function registerAdminPortal(app){
  app.get(['/admin','/admin/'],async(req,res)=>{
    const admin=await requireAdmin(req,res,{html:true});
    if(!admin)return;
    return sendAdmin(res);
  });
  app.all('/admin/api',async(req,res)=>{
    const admin=await requireAdmin(req,res);
    if(!admin)return;
    const action=String(req.query?.action||'').trim();
    const mutations=new Set(['set-plan','issue-license','revoke-license']);
    if(mutations.has(action)&&!sameOrigin(req))return res.status(403).json({ok:false,error:'cross_site_request_denied'});
    try{
      if(action==='overview'&&req.method==='GET')return res.json(await callOperatorJson('GET','/v1/admin/overview'));
      if(action==='accounts'&&req.method==='GET')return res.json(await callOperatorJson('GET','/v1/admin/accounts'));
      if(action==='licenses'&&req.method==='GET')return res.json(await callOperatorJson('GET','/v1/admin/licenses'));
      if(action==='set-plan'&&req.method==='POST'){
        const id=String(req.body?.accountId||''),plan=String(req.body?.plan||'');
        return res.json(await callOperatorJson('POST','/v1/admin/accounts/'+encodeURIComponent(id)+'/entitlement',{plan,durationDays:req.body?.durationDays??null,sourceRef:'web-admin'}));
      }
      if(action==='issue-license'&&req.method==='POST'){
        return res.status(201).json(await callOperatorJson('POST','/v1/admin/licenses/issue',{plan:req.body?.plan,durationDays:req.body?.durationDays,maxRedemptions:req.body?.maxRedemptions}));
      }
      if(action==='revoke-license'&&req.method==='POST'){
        const id=String(req.body?.licenseId||'');
        return res.json(await callOperatorJson('POST','/v1/admin/licenses/'+encodeURIComponent(id)+'/revoke',{reason:'web_admin'}));
      }
      return res.status(400).json({ok:false,error:'unknown_admin_action'});
    }catch(error){
      return res.status(Number(error?.status)||500).json({ok:false,error:error?.payload?.error||error?.message||'admin_unavailable'});
    }
  });
}
