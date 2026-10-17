/**
 * Gold-only support identity resolver. The public Plugin never trusts the
 * legacy Operator JSON account registry as a paid-support principal.
 * Resolve the browser's opaque Account cookie over a private Gold Core Unix
 * socket; the Core authenticates lr_sessions and live lr_entitlements.
 */
import http from 'node:http';
import {notificationCoreSocket} from '../operator-host/gold-notification-core-bridge.mjs';

const fail=(message,status=503)=>Object.assign(new Error(message),{status});
const signedOut=()=>({signedIn:false,token:null,account:null,supportEligible:false,
 goldVerified:true});
const eligibleAccount=profile=>{
 if(profile?.status!=='active'||profile?.emailVerified!==true)return false;
 const plan=String(profile?.plan||'');
 const kind=String(profile?.entitlement?.kind||'');
 return profile?.accountId&&profile?.entitlement?.entitlementId&&
  ((plan==='pro'&&(kind==='personal_pro'||kind==='pro_team'))||
   (plan==='vip'&&kind==='vip'));
};
export function createGoldSupportAccountResolver({
 env=process.env,request=http.request,timeoutMs=4000}={}){
 const socketPath=notificationCoreSocket(env);
 return async function resolveGoldSupportIdentity(_req,sessionToken){
  const opaque=String(sessionToken||'').trim();
  // This token is only a candidate; Gold Core authenticates its SHA-256
  // against an unrevoked, unexpired PostgreSQL session and active account.
  if(!opaque)return signedOut();
  if(opaque.length>4096)throw fail('gold_support_session_invalid',401);
  return new Promise((resolve,reject)=>{
   let settled=false,body=[],bytes=0;
   const done=(e,result)=>{if(settled)return;settled=true;e?reject(e):resolve(result)};
   let upstream;
   try{
    upstream=request({socketPath,path:'/v1/accounts/profile',method:'GET',
     timeout:timeoutMs,headers:{authorization:'Bearer '+opaque,
      accept:'application/json'}},response=>{
      response.on('data',chunk=>{
       bytes+=chunk.length;
       if(bytes>65536){upstream.destroy(Error('gold_support_core_response_too_large'));return}
       body.push(chunk);
      });
      response.on('error',()=>done(fail('gold_support_core_unavailable')));
      response.on('end',()=>{
       if(settled)return;
       if(bytes>65536)return done(fail('gold_support_core_unavailable'));
       if(response.statusCode===401)return done(null,signedOut());
       if(response.statusCode!==200)return done(fail('gold_support_core_unavailable'));
       try{
        const value=JSON.parse(Buffer.concat(body).toString('utf8'));
        const profile=value?.account;
        if(!profile?.accountId||!profile?.email||!value?.session?.sessionId||
           !Number.isFinite(value?.session?.expiresAt)||
           !profile?.entitlement||typeof profile?.policyAccepted!=='boolean')
          throw Error('gold_support_core_profile_invalid');
        if(profile.status!=='active'||profile.emailVerified!==true)
          return done(fail('gold_support_account_inactive',403));
        const eligible=Boolean(eligibleAccount(profile));
        return done(null,{signedIn:true,token:null,goldVerified:true,
         supportEligible:eligible,
         account:{accountId:profile.accountId,email:profile.email,
          plan:eligible?profile.plan:'free'}});
       }catch{return done(fail('gold_support_core_contract_invalid'))}
      });
     });
    upstream.on('timeout',()=>upstream.destroy(Error('gold_support_core_timeout')));
    upstream.on('error',()=>done(fail('gold_support_core_unavailable')));
    upstream.end();
   }catch{done(fail('gold_support_core_unavailable'))}
  });
 };
}
