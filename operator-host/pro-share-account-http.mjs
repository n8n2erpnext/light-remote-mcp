// P2-I4B guarded account-plane management. NO guest command execution.
// Pro Share account API is independent of the legacy five-seat Pro Team.
import crypto from 'node:crypto';
import {GoldProShareStore,ProShareError} from './pro-share-store.mjs';
const PREFIX='/v1/accounts/pro-share';
const ACTIONS=new Set(['csrf','overview','invite','accept','share','revoke',
 'guest-pending','guest-approve']);
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const deny=(reason,status=403)=>{throw new ProShareError(reason,status)};
export function createGoldProShareStoreFromOperator({env=process.env,pool,accounts}={}){
 return new GoldProShareStore({pool,env,now:Date.now,
  planFor:id=>accounts.assertOperational(id).plan,
  accountActive:id=>{try{return accounts.assertOperational(id).status==='active'}
   catch{return false}},
  emailFor:id=>accounts.assertOperational(id).email,
  accountVerified:id=>accounts.assertOperational(id).emailVerified===true
 });
}
export function createGoldProShareAccountHttp({env=process.env,pool,accounts,
 requireAccount,accountSessionToken,readJson,sendJson,guestApproval=null}={}){
 const enabled=env.LR_GOLD_PRO_SHARE_ACCOUNT_HTTP==='1';
 const gate=env.LR_GOLD_PRO_SHARE_CORE==='1';
 if(enabled&&!gate)deny('pro_share_account_requires_core',503);
 if(enabled&&(!pool?.query||!pool?.connect||!accounts||
   typeof requireAccount!=='function'||typeof accountSessionToken!=='function'||
   typeof readJson!=='function'||typeof sendJson!=='function'))
  deny('pro_share_account_dependencies_missing',503);
 const origin=String(env.LR_GOLD_PRO_SHARE_OWNER_ORIGIN||'').trim();
 if(enabled&&(!/^https:\/\/[^/]+$/.test(origin)||new URL(origin).origin!==origin))
  deny('pro_share_owner_origin_required',503);
 const store=enabled?createGoldProShareStoreFromOperator({env,pool,accounts}):null;
 const csrf=(token)=>crypto.createHmac('sha256',token)
   .update('light-remote:pro-share:account-csrf:v1').digest('base64url');
 return async(req,res,url)=>{
  const path=url.pathname;
  if(path!==PREFIX&&!path.startsWith(PREFIX+'/'))return false;
  if(!enabled){sendJson(res,404,{ok:false,error:'not_found'});return true;}
  const action=path===PREFIX?'overview':path.slice(PREFIX.length+1);
  if(!ACTIONS.has(action)){
   sendJson(res,404,{ok:false,error:'not_found'});return true;
  }
  if(['guest-pending','guest-approve'].includes(action)&&!guestApproval){
   sendJson(res,404,{ok:false,error:'not_found'});return true;
  }
  if(req.method!==(['csrf','overview','guest-pending'].includes(action)?'GET':'POST')){
   sendJson(res,405,{ok:false,error:'method_not_allowed'});return true;
  }
  try{
   const principal=requireAccount(req,{touch:false});
   const account=principal?.account;
   if(!account?.accountId||!account.emailVerified)
    deny('pro_share_verified_account_required',401);
   const token=accountSessionToken(req);
   if(typeof token!=='string'||token.length<20||token.length>4096)
    deny('pro_share_account_session_required',401);
   const proof=csrf(token);
   if(action==='csrf'){
    sendJson(res,200,{ok:true,csrf:proof,shareEnabled:true,
     guestExecutionEnabled:false,checkoutEnabled:false});
    return true;
   }
   const actor=account.accountId;
   if(action==='overview'){
    const out=await store.overview({authenticatedOwnerAccountId:actor});
    sendJson(res,200,{ok:true,...out});return true;
   }
   if(action==='guest-pending'){
    const deviceId=url.searchParams.get('deviceId');
    if(!ID.test(String(deviceId||'')))deny('pro_share_device_invalid',400);
    const out=await guestApproval.list(req,{deviceId});
    sendJson(res,200,{ok:true,...out});return true;
   }
   if(req.headers?.origin!==origin||
      req.headers?.['sec-fetch-site']==='cross-site')
    deny('pro_share_origin_denied');
   const supplied=req.headers?.['x-light-pro-share-csrf'];
   if(typeof supplied!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(supplied)||
      !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(proof)))
    deny('pro_share_csrf_denied');
   const body=await readJson(req);
   if(!body||typeof body!=='object'||Array.isArray(body))deny('pro_share_body_invalid',400);
   let out;
   if(action==='invite'){
    out=await store.inviteEmail({authenticatedOwnerAccountId:actor,
     guestEmail:body.guestEmail});
   }else if(action==='accept'){
    if(!ID.test(String(body.ownerAccountId||'')))deny('pro_share_owner_invalid',400);
    out=await store.acceptInvite({authenticatedGuestAccountId:actor,
     ownerAccountId:body.ownerAccountId,inviteCode:body.inviteCode});
   }else if(action==='share'){
    if(!ID.test(String(body.deviceId||'')))deny('pro_share_device_invalid',400);
    out=await store.shareDevice({authenticatedOwnerAccountId:actor,deviceId:body.deviceId});
   }else if(action==='revoke'){
    if(body.removeGuest!==true&&!ID.test(String(body.deviceId||'')))
     deny('pro_share_revoke_target_invalid',400);
    out=await store.revoke({authenticatedOwnerAccountId:actor,
     deviceId:body.deviceId||null,removeGuest:body.removeGuest===true});
   }else if(action==='guest-approve'){
    if(!ID.test(String(body.deviceId||''))||
       !/^av2_[a-f0-9]{32}$/.test(String(body.requestId||''))||
       !Number.isSafeInteger(body.expectedAttempt)||body.expectedAttempt<1||
       !/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(String(body.bCode||'')))
     deny('pro_share_guest_b_payload_invalid',400);
    out=await guestApproval.approve(req,{deviceId:body.deviceId,
     requestId:body.requestId,expectedAttempt:body.expectedAttempt,
     bCode:body.bCode});
   }
   sendJson(res,200,{ok:true,...out});
  }catch(error){
   const own=error instanceof ProShareError;
   const status=own&&[400,401,403,404,409,429,503].includes(error.status)?
    error.status:error?.status===401?401:503;
   sendJson(res,status,{ok:false,error:own?error.message:
    status===401?'account_session_required':'pro_share_account_unavailable'});
  }
  return true;
 };
}
