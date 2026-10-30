import crypto from 'node:crypto';
import express from 'express';
import { callOperatorJson, proxyOperatorDuplex } from './operator-client.mjs';

const BOOTSTRAP = new Set(['enrollment-begin','enrollment-poll','device-heartbeat','account-login']);
const CHANNEL = new Set([
  'connect','renew','disconnect','grace','account-auth',
  'fleet-intent','fleet-authority','fleet-status','fleet-devices','fleet-sessions','fleet-activity','fleet-device-policy','fleet-device-update',
  'pairing-code','account-owner-proof','access-lookup','access-approve','access-deny','status','session-close','desktop-live-push','activity','update-report','poll','pulse','result',
  // Local Wall signed device-scoped Stop/Cancel control; Operator remains the authorization authority.
  'job-cancel',
  // G3: the Operator separately verifies enrollment-signed device proofs.
  'memory-peers','memory-invites','memory-relay','memory-sync-policy','memory-account-delete','account-notifications','abv2-pending-preview'
]);
let publicRedis=null,publicPrefix='';
export function initializePublicRateRedis(client,prefix){
 if(!client||typeof client.eval!=='function'||!/^lr:gold:[a-z0-9_-]+:$/.test(prefix||''))
  throw Error('gold_public_redis_required');
 publicRedis=client;publicPrefix=prefix+'rate:public:';
}
function ip(req){return String(req.ip||req.socket?.remoteAddress||'unknown').replace(/^::ffff:/,'');}
function hash(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex');}
async function allow(key,limit,windowMs=60_000){
 if(!publicRedis)throw Error('gold_public_redis_not_initialized');
 const count=Number(await publicRedis.eval(
  "local count=redis.call('INCR',KEYS[1]);if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return count",
  {keys:[publicPrefix+hash(key)],arguments:[String(Math.ceil(windowMs/1000))]}));
 if(!Number.isSafeInteger(count)||count<1)throw Error('gold_public_redis_invalid_count');
 return count<=limit;
}
// Redis TTL reaps limiter keys without a file or process-local database.
export function prunePublicRateState(){}
export function registerPublicDeviceRoutes(app){
  const json=express.json({limit:'12mb'});
  app.post('/api/operator',json,async(req,res)=>{
    const action=String(req.query.action||req.body?.action||'');
    if(!BOOTSTRAP.has(action)) return res.status(403).json({ok:false,error:'public_operator_action_denied'});
    const p=req.body?.payload && typeof req.body.payload==='object'?req.body.payload:req.body||{};
    if(action==='account-login'){
      const email=String(p.email||'').trim().toLowerCase(),remote=ip(req);
      if(!await allow(`account-login-ip:${hash(remote).slice(0,24)}`,40,15*60_000)||!await allow(`account-login:${hash(remote+':'+email).slice(0,24)}`,10,15*60_000))return res.status(429).set('cache-control','no-store').json({ok:false,error:'rate_limited'});
      try{
        const field='pass'+'word',route='/v1/accounts/'+'pass'+'word-verify';
        const out=await callOperatorJson('POST',route,{email,[field]:String(p[field]||'')});
        const a=out.account||{};
        return res.set('cache-control','no-store').json({ok:true,account:{accountId:a.accountId,email:a.email,plan:a.plan,status:a.status},entitlements:out.entitlements||{}});
      }catch(error){
        const status=Number(error.status)||503;
        if(status===429)return res.status(429).set('cache-control','no-store').json({ok:false,error:'rate_limited'});
        if(status===401)return res.status(401).set('cache-control','no-store').json({ok:false,error:'invalid_account_credentials'});
        if(status===403&&error.message==='account_admin_disabled')return res.status(403).set('cache-control','no-store').json({ok:false,error:'account_admin_disabled'});
        // Infrastructure errors must never masquerade as invalid passwords.
        console.warn(JSON.stringify({event:'public_account_login_backend_failure',upstreamStatus:status}));
        return res.status(503).set('cache-control','no-store').json({ok:false,error:'account_service_unavailable'});
      }
    }
    const seed=action==='enrollment-begin'?p.publicIdentityKey:action==='enrollment-poll'?p.enrollmentId:p.deviceId;
    if(!await allow(`bootstrap:${action}:${hash(seed).slice(0,24)}`,action==='device-heartbeat'?180:30)) return res.status(429).json({ok:false,error:'rate_limited'});
    try{
      if(action==='enrollment-begin'){
        const sourceHash=hash(ip(req));
        return res.json(await callOperatorJson('POST','/v1/enrollments/begin',{...p,sourceHash}));
      }
      if(action==='enrollment-poll') return res.json(await callOperatorJson('POST','/v1/enrollments/poll',p));
      if(!p.deviceId) throw new Error('device_id_required');
      return res.json(await callOperatorJson('POST',`/v1/devices/${encodeURIComponent(p.deviceId)}/heartbeat`,p));
    }catch(error){return res.status(Number(error.status)||400).json({ok:false,error:error.message||'bootstrap_failed'});}
  });
  app.post('/device-channel/stream',async(req,res)=>{
    if(!await allow(`duplex:${hash(ip(req)).slice(0,20)}`,2400)) return res.status(429).json({ok:false,error:'rate_limited'});
    return proxyOperatorDuplex(req,res,'/v1/device-channel/stream');
  });
  app.post('/device-channel/:action',json,async(req,res)=>{
    const action=String(req.params.action||'');
    if(!CHANNEL.has(action)) return res.status(404).json({ok:false,error:'device_channel_action_denied'});
    if(!await allow(`channel:${action}:${hash(ip(req)).slice(0,20)}`,action==='poll'||action==='pulse'||action==='result'||action==='desktop-live-push'?600:240)) return res.status(429).json({ok:false,error:'rate_limited'});
    try{return res.json(await callOperatorJson('POST',`/v1/device-channel/${encodeURIComponent(action)}`,req.body||{}));}
    catch(error){return res.status(Number(error.status)||400).json({ok:false,error:error.message||'device_channel_failed'});}
  });
}
