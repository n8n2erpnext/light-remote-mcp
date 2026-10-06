import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callOperatorJson } from './operator-client.mjs';
import { PUBLIC_ORIGIN } from './config.mjs';
import { mailConfig, sendLicense, sendUpgradeActivated, verifyMail } from './mailer.mjs';
import { googleAuthStatus, saveGoogleAuthConfig } from './google-auth.mjs';
import { paddleBilling, paddleBillingStatus } from './paddle-billing.mjs';

const COOKIE='__Host-light_remote_account';
const ADMIN_ACCOUNT_ID=String(process.env.LIGHT_REMOTE_ADMIN_ACCOUNT_ID||'direct-production-local');
const adminFile=name=>fileURLToPath(new URL('./admin-portal/'+name,import.meta.url));

function parseCookies(header=''){const out={};for(const part of String(header).split(';')){const i=part.indexOf('=');if(i<1)continue;out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());}return out;}
function token(req){return String(parseCookies(req.headers?.cookie||'')[COOKIE]||'');}
function headers(value){return {'x-light-account-session':value};}
function sameOrigin(req){const site=String(req.headers?.['sec-fetch-site']||'').toLowerCase();if(site==='cross-site')return false;if(site==='same-origin')return true;const origin=String(req.headers?.origin||'').trim();if(!origin)return true;try{return new URL(origin).origin===PUBLIC_ORIGIN;}catch{return false;}}
async function identity(req){const value=token(req);if(!value)return {ok:false,status:401,error:'account_session_required'};try{const me=await callOperatorJson('GET','/v1/accounts/me',null,headers(value));if(String(me.account?.accountId||'')!==ADMIN_ACCOUNT_ID)return {ok:false,status:403,error:'admin_account_required'};return {ok:true,token:value,me};}catch(error){return {ok:false,status:Number(error?.status)||401,error:error?.payload?.error||error?.message||'account_session_required'};}}
async function requireAdmin(req,res,{html=false}={}){const row=await identity(req);if(row.ok)return row;if(html&&row.status===401){res.redirect(303,'/account/login');return null;}if(html){res.status(row.status).type('text').send('Admin account required.');return null;}res.status(row.status).json({ok:false,error:row.error});return null;}
function sendAdmin(res){return res.type('html').send(fs.readFileSync(adminFile('index.html')));}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim());}

export function registerAdminPortal(app){
  app.get(['/admin','/admin/'],async(req,res)=>{const admin=await requireAdmin(req,res,{html:true});if(!admin)return;return sendAdmin(res);});
  app.all('/admin/api',async(req,res)=>{
    const admin=await requireAdmin(req,res);if(!admin)return;
    const action=String(req.query?.action||'').trim();
    const mutations=new Set(['set-plan','set-group','set-status','create-group','rename-group','delete-group','cancel-pending','issue-license','revoke-license','resolve-upgrade','mail-test','google-config','paddle-refund']);
    if(mutations.has(action)&&!sameOrigin(req))return res.status(403).json({ok:false,error:'cross_site_request_denied'});
    try{
      if(action==='overview'&&req.method==='GET')return res.json(await callOperatorJson('GET','/v1/admin/overview'));
      if(action==='accounts'&&req.method==='GET')return res.json(await callOperatorJson('GET','/v1/admin/accounts'));
      if(action==='groups'&&req.method==='GET')return res.json(await callOperatorJson('GET','/v1/admin/groups'));
      if(action==='pending'&&req.method==='GET')return res.json(await callOperatorJson('GET','/v1/admin/pending-registrations'));
      if(action==='licenses'&&req.method==='GET')return res.json(await callOperatorJson('GET','/v1/admin/licenses'));
      if(action==='upgrades'&&req.method==='GET')return res.json(await callOperatorJson('GET','/v1/admin/upgrades'));
      if(action==='paddle-billing'&&req.method==='GET'){
        const billing=await paddleBilling.adminBillingTransactions({
          query:String(req.query?.q||''),
          limit:Number(req.query?.limit||50),
          refundWindowHours:24,
        });
        return res.json({ok:true,paddle:paddleBillingStatus(),...billing});
      }
      if(action==='paddle-refund'&&req.method==='POST'){
        const transactionId=String(req.body?.transactionId||'').trim();
        const reason=String(req.body?.reason||'').trim();
        const result=await paddleBilling.requestEmergencyRefund({
          transactionId,
          reason,
          maxAgeHours:24,
          requestedBy:String(admin.me?.account?.accountId||ADMIN_ACCOUNT_ID),
        });
        console.log(JSON.stringify({
          event:'paddle_admin_refund',
          transactionId,
          adjustmentId:result.adjustmentId||null,
          status:result.status||null,
          action:result.action||null,
          requestedBy:String(admin.me?.account?.accountId||ADMIN_ACCOUNT_ID),
        }));
        return res.status(201).json({ok:true,refund:result});
      }
      if(action==='mail-status'&&req.method==='GET')return res.json({ok:true,configured:Boolean(mailConfig()),google:googleAuthStatus()});
      if(action==='mail-test'&&req.method==='POST'){const verified=await verifyMail();return res.status(verified?200:503).json({ok:verified,verified});}
      if(action==='google-config'&&req.method==='POST'){const google=saveGoogleAuthConfig({clientId:req.body?.clientId,clientSecret:req.body?.clientSecret});return res.status(200).json({ok:true,google});}
      if(action==='set-plan'&&req.method==='POST'){
        const id=String(req.body?.accountId||''),plan=String(req.body?.plan||'');
        const out=await callOperatorJson('POST','/v1/admin/accounts/'+encodeURIComponent(id)+'/entitlement',{plan,durationDays:req.body?.durationDays??null,sourceRef:'web-admin'});
        if(['pro','vip'].includes(String(out.account?.plan||'')))sendUpgradeActivated({to:out.account?.email,plan:out.account.plan,validUntil:out.account?.entitlement?.validUntil||null}).catch(()=>{});
        return res.json(out);
      }
      if(action==='set-group'&&req.method==='POST'){const id=String(req.body?.accountId||''),groupId=String(req.body?.groupId||'');return res.json(await callOperatorJson('POST','/v1/admin/accounts/'+encodeURIComponent(id)+'/group',{groupId}));}
      if(action==='set-status'&&req.method==='POST'){const id=String(req.body?.accountId||''),status=String(req.body?.status||''),reason=String(req.body?.reason||'');return res.json(await callOperatorJson('POST','/v1/admin/accounts/'+encodeURIComponent(id)+'/status',{status,reason,by:'web_admin'}));}
      if(action==='create-group'&&req.method==='POST')return res.status(201).json(await callOperatorJson('POST','/v1/admin/groups',{name:req.body?.name}));
      if(action==='rename-group'&&req.method==='POST'){const id=String(req.body?.groupId||'');return res.json(await callOperatorJson('POST','/v1/admin/groups/'+encodeURIComponent(id),{name:req.body?.name}));}
      if(action==='delete-group'&&req.method==='POST'){const id=String(req.body?.groupId||'');return res.json(await callOperatorJson('DELETE','/v1/admin/groups/'+encodeURIComponent(id),{moveTo:req.body?.moveTo||'grp_default'}));}
      if(action==='cancel-pending'&&req.method==='POST'){const id=String(req.body?.pendingId||'');return res.json(await callOperatorJson('POST','/v1/admin/pending-registrations/'+encodeURIComponent(id)+'/cancel',{reason:'web_admin'}));}
      if(action==='issue-license'&&req.method==='POST'){
        const out=await callOperatorJson('POST','/v1/admin/licenses/issue',{plan:req.body?.plan,durationDays:req.body?.durationDays,maxRedemptions:req.body?.maxRedemptions,label:req.body?.label||''});
        let mail={sent:false,reason:'recipient_not_provided'};const recipient=String(req.body?.recipient||'').trim();
        if(recipient&&validEmail(recipient))mail=await sendLicense({to:recipient,plan:out.license?.plan,key:out.key,durationDays:out.license?.durationDays||null,expiresAt:out.license?.expiresAt||null}).catch(error=>({sent:false,reason:error?.message||'mail_failed'}));
        return res.status(201).json({...out,mail});
      }
      if(action==='revoke-license'&&req.method==='POST'){const id=String(req.body?.licenseId||'');return res.json(await callOperatorJson('POST','/v1/admin/licenses/'+encodeURIComponent(id)+'/revoke',{reason:'web_admin'}));}
      if(action==='resolve-upgrade'&&req.method==='POST'){
        const id=String(req.body?.requestId||''),decision=String(req.body?.decision||'approve');
        const out=await callOperatorJson('POST','/v1/admin/upgrades/'+encodeURIComponent(id)+'/resolve',{decision,durationDays:req.body?.durationDays??null,sourceRef:'web-admin'});
        if(decision==='approve')sendUpgradeActivated({to:out.account?.email,plan:out.account?.plan,validUntil:out.account?.entitlement?.validUntil||null}).catch(()=>{});
        return res.json(out);
      }
      return res.status(400).json({ok:false,error:'unknown_admin_action'});
    }catch(error){return res.status(Number(error?.status)||500).json({ok:false,error:error?.payload?.error||error?.message||'admin_unavailable'});}
  });
}
