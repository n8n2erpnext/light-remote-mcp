// P2-I4B2: reuse existing two-phase native A/B V2 grant coordinator,
// owner Account HTTP authentication/CSRF and Pro Share seat/device policy.
// No Guest execution or Helper-ready. All flags OFF by default.
import {GoldAbV2PendingRedis} from '../lib/gold-ab-v2-pending-redis.mjs';
import {goldAbV2OwnerHttpConfig,createGoldAbV2Csrf}
 from './gold-ab-v2-owner-http.mjs';
import {createGoldAbV2GrantOperator}
 from './gold-ab-v2-grant-operator.mjs';
import {GoldProShareStore,ProShareError} from './pro-share-store.mjs';
const deny=(reason,status=403)=>{throw new ProShareError(reason,status)};
export function createGoldProShareGuestApproval({
 env=process.env,storage,accounts,devices,connections,enrollments,
 accessGrants,goldRegistries,store,requireAccount,accountSessionToken
}={}){
 if(env.LR_GOLD_PRO_SHARE_GUEST_B_APPROVE!=='1')return null;
 if(env.LR_GOLD_PRO_SHARE_CORE!=='1'||
    env.LR_GOLD_PRO_SHARE_ACCOUNT_HTTP!=='1'||
    env.LR_GOLD_PRO_SHARE_GUEST_AB_REQUEST_ISSUE!=='1'||
    env.LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE!=='1')
  deny('pro_share_guest_approval_dependencies_off',503);
 if(!store?.assertEligibleGuestRequest||!storage?.pool?.query||!storage?.redis?.eval)
  deny('pro_share_guest_approval_dependencies_missing',503);
 const cfg=goldAbV2OwnerHttpConfig(env);
 if(!cfg.enabled||cfg.origin!==env.LR_GOLD_PRO_SHARE_OWNER_ORIGIN)
  deny('pro_share_guest_owner_origin_mismatch',503);
 const csrf=createGoldAbV2Csrf({sealingKey:cfg.sealingKey,
  origin:cfg.origin,sessionToken:accountSessionToken});
 const pending=new GoldAbV2PendingRedis({redis:storage.redis,prefix:storage.prefix,
  sealingKey:cfg.sealingKey});
 const authorizeGuest=async(_req,scope)=>{
  const {ownerAccountId,guestAccountId,deviceId,connectionId}=scope;
  const guest=accounts.assertOperational(guestAccountId);
  if(guest.accountId!==guestAccountId||guest.emailVerified!==true||
     String(guest.plan||'free').toLowerCase()!=='free')
   deny('pro_share_guest_oauth_identity_invalid');
  const device=devices.get(deviceId);
  const connection=connections.assertConnected(deviceId);
  if(device.accountId!==ownerAccountId||
     connection.accountId!==ownerAccountId||
     connection.deviceId!==deviceId||
     connection.connectionId!==connectionId)
   deny('pro_share_guest_owner_connection_changed',409);
  const allowed=await store.assertEligibleGuestRequest({
   authenticatedGuestAccountId:guestAccountId,device,connection});
  if(allowed.ownerAccountId!==ownerAccountId||
     allowed.deviceId!==deviceId||
     allowed.connectionId!==connectionId)
   deny('pro_share_guest_owner_scope_changed',409);
  return allowed;
 };
 const grantOperator=createGoldAbV2GrantOperator({
  env,storage,requireAccount,accountSessionToken,
  accounts,devices,connections,enrollments,accessGrants,goldRegistries,
  expectedPurpose:'pro-share-guest',authorizeGuest
 });
 if(typeof grantOperator!=='function')deny('pro_share_guest_grant_operator_off',503);
 const ownerDevice=async(req,deviceId)=>{
  const who=requireAccount(req,{touch:false})?.account;
  if(!who?.accountId||!cfg.allowedAccounts.has(who.accountId)||
     !cfg.allowedDevices.has(deviceId))deny('pro_share_owner_not_allowed',403);
  const device=devices.get(deviceId),connection=connections.assertConnected(deviceId);
  if(device.accountId!==who.accountId||connection.accountId!==who.accountId||
     connection.deviceId!==deviceId||connection.state!=='connected')
   deny('pro_share_guest_owner_device_not_owned');
  return {accountId:who.accountId,connectionId:connection.connectionId};
 };
 return {
  async list(req,{deviceId}={}){
   const s=await ownerDevice(req,deviceId);
   const requests=await pending.listDevicePending({ownerAccountId:s.accountId,
    deviceId,connectionId:s.connectionId,limit:5});
   // The ordinary owner's own requests are never granted as Guest by mistake.
   return {deviceId,pending:requests.filter(x=>x.purpose==='pro-share-guest')
    .map(x=>({requestId:x.requestId,attempt:x.attempt,expiresAt:x.expiresAt,
     requesterAccountId:x.requester,purpose:x.purpose}))};
  },
  async approve(req,{deviceId,requestId,expectedAttempt,bCode}={}){
   await ownerDevice(req,deviceId);
   // The Pro Share account route already verified the SAME authenticated
   // Account session, Origin and its own CSRF. Reuse the existing A/B V2
   // device-scoped owner nonce; do not weaken the grant Operator verification.
   const trustedReq={...req,headers:{...req.headers,
    'x-light-abv2-csrf':csrf.nonce(req,deviceId)}};
   return grantOperator(trustedReq,{deviceId,requestId,expectedAttempt,bCode});
  }
 };
}
