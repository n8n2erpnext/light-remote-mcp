// OAuth Helper V2: signed principal -> Redis approved + PostgreSQL active grant -> persisted binding.
// Source OFF by default. A Redis grant marker alone never authorizes an Agent.
import crypto from 'node:crypto';
import {GoldAbV2PendingRedis} from '../lib/gold-ab-v2-pending-redis.mjs';
import {goldAbV2OwnerHttpConfig} from './gold-ab-v2-owner-http.mjs';
import {goldAbV2HelperKey,GoldAbV2HelperProofError} from '../lib/gold-ab-v2-helper-proof.mjs';
import {verifyGoldAbV2HelperPoll} from '../lib/gold-ab-v2-helper-poll-proof.mjs';
const deny=(msg,status=403)=>{throw new GoldAbV2HelperProofError(msg,status)};
const ROUTE='/v1/plugin/abv2/request-poll';
export function createGoldAbV2HelperPoll({env=process.env,storage,accounts,
 devices,connections,enrollments,accessGrants,agentClients,goldRegistries,
 readJson,sendJson,now=Date.now}={}){
 const enabled=env.LR_GOLD_AB_V2_HELPER_POLL_ATTACH==='1';
 if(enabled&&(env.LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE!=='1'||
   env.LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE!=='1'))
  deny('abv2_poll_requires_issue_and_durable_grant',503);
 if(!enabled)return async(req,res,url)=>{
  if(url.pathname!==ROUTE)return false;
  sendJson(res,404,{ok:false,error:'not_found'});return true;
 };
 const cfg=goldAbV2OwnerHttpConfig(env);
 if(!cfg.enabled||!storage?.pool?.query||!storage?.redis?.eval||
    !storage?.redis?.set||!storage?.prefix||!accounts||!devices||
    !connections||!enrollments||!accessGrants||!agentClients||
    typeof goldRegistries?.flush!=='function'||
    typeof readJson!=='function'||typeof sendJson!=='function')
  deny('abv2_poll_dependencies_required',503);
 const key=goldAbV2HelperKey(env);
 const pending=new GoldAbV2PendingRedis({redis:storage.redis,prefix:storage.prefix,
  sealingKey:cfg.sealingKey});
 const validateDevice=p=>{
  if(!cfg.allowedAccounts.has(p.accountId)||!cfg.allowedDevices.has(p.deviceId))
   deny('abv2_poll_not_allowlisted',404);
  const account=accounts.assertOperational(p.accountId);
  if(account.accountId!==p.accountId||account.emailVerified!==true)
   deny('abv2_poll_owner_not_verified',403);
  const d=devices.get(p.deviceId),e=enrollments.binding(p.deviceId);
  const policy=enrollments.policyView(p.deviceId);
  if(d.deviceId!==p.deviceId||d.accountId!==p.accountId||
     d.state!=='online'||d.revokedAt||
     e.deviceId!==p.deviceId||e.accountId!==p.accountId||e.revokedAt||
     d.publicIdentityKey!==e.publicIdentityKey||
     policy.accountId!==p.accountId||policy.policyProfile==='disabled'||
     !Number.isSafeInteger(policy.policyRevision)||policy.policyRevision<1||
     !Array.isArray(policy.approvedCapabilities)||!policy.approvedCapabilities.length)
   deny('abv2_poll_enrollment_or_policy_denied',403);
  const cn=connections.assertConnected(p.deviceId);
  if(cn.deviceId!==p.deviceId||cn.accountId!==p.accountId||
     cn.state!=='connected'||!cn.connectionId||
     Number(cn.hardExpiresAt)<=now())
   deny('abv2_poll_connection_expired',409);
  return cn;
 };
 return async(req,res,url)=>{
  if(url.pathname!==ROUTE)return false;
  if(req.method!=='POST'){
   sendJson(res,405,{ok:false,error:'method_not_allowed'});return true;
  }
  try{
   const p=await verifyGoldAbV2HelperPoll({proof:await readJson(req),key,
    redis:storage.redis,prefix:storage.prefix,now:now()});
   const cn=validateDevice(p);
   // Exact Short ID and device, no Main fallback.
   const short=await storage.pool.query(
    'SELECT s.short_id FROM lr_gold_device_short_ids s JOIN lr_devices d ON d.device_id=s.device_id WHERE d.owner_account_id=$1 AND s.device_id=$2',
    [p.accountId,p.deviceId]);
   if(short.rowCount!==1||short.rows[0].short_id!==p.shortId)
    deny('abv2_poll_short_id_changed',409);
   const clientHash='oauth-'+crypto.createHash('sha256')
    .update(p.clientId).digest('hex');
   const status=await pending.agentPoll({requestId:p.requestId,
    actorAccountId:p.accountId,agentId:p.agentId,clientId:clientHash,
    connectionId:cn.connectionId});
   if(status.requestId!==p.requestId)deny('abv2_poll_request_mismatch',403);
   if(status.state!=='granted'){
    sendJson(res,200,{ok:true,status:'approval_pending',
     approvalState:status.state,requestId:p.requestId,
     helperReady:false,nextAction:'owner_b_approval_or_durable_grant_pending'});
    return true;
   }
   const receipt=await pending.grantReceipt({ownerAccountId:p.accountId,
    deviceId:p.deviceId,connectionId:cn.connectionId,requestId:p.requestId});
   const grantId='dag_v2_'+p.requestId.slice(4);
   if(receipt.state!=='granted'||receipt.requestId!==p.requestId||
      receipt.owner!==p.accountId||receipt.actor!==p.accountId||
      receipt.agent!==p.agentId||receipt.client!==clientHash||
      receipt.device!==p.deviceId||receipt.connection!==cn.connectionId||
      receipt.grantId!==grantId||!Number.isSafeInteger(receipt.approvedAt))
    deny('abv2_poll_receipt_scope_invalid',403);
   const pg=await storage.pool.query(
    'SELECT g.grant_id,g.account_id,g.device_id,g.connection_id,g.agent_id,g.approved_at,g.expires_at,g.absolute_expires_at,g.closed_at,m.close_reason FROM lr_ab_grants g JOIN lr_gold_ab_grant_metadata m ON m.grant_id=g.grant_id WHERE g.grant_id=$1',
    [grantId]);
   const row=pg.rows?.[0];
   if(pg.rowCount!==1||row?.grant_id!==grantId||
      row.account_id!==p.accountId||row.device_id!==p.deviceId||
      row.connection_id!==cn.connectionId||row.agent_id!==p.agentId||
      row.closed_at!==null||row.close_reason!=null||
      new Date(row.approved_at).getTime()!==receipt.approvedAt||
      new Date(row.absolute_expires_at).getTime()!==receipt.approvedAt+86400000||
      !(new Date(row.expires_at).getTime()>now())||
      !(new Date(row.absolute_expires_at).getTime()>now()))
    deny('abv2_poll_grant_not_durable_or_inactive',409);
   const grant=accessGrants.assert(grantId,{accountId:p.accountId,
    agentId:p.agentId,deviceId:p.deviceId,
    connectionId:cn.connectionId,touch:false});
   if(grant.approvedAt!==receipt.approvedAt||
      grant.absoluteExpiresAt!==receipt.approvedAt+86400000)
    deny('abv2_poll_registry_mismatch',409);
   const fresh=validateDevice(p);
   if(fresh.connectionId!==cn.connectionId)
    deny('abv2_poll_connection_changed',409);
   const attached=agentClients.attach({accountId:p.accountId,
    agentId:p.agentId,grant,pairingRequestId:p.requestId});
   await goldRegistries.flush();
   const binding=await storage.pool.query(
    'SELECT c.account_id,c.agent_id,c.closed_at,c.expires_at,b.device_id,b.connection_id,b.grant_id,b.pairing_request_id FROM lr_agent_clients c JOIN lr_agent_bindings b ON b.client_session_id=c.client_session_id WHERE c.client_session_id=$1 AND b.device_id=$2',
    [attached.clientSessionId,p.deviceId]);
   const bound=binding.rows?.[0];
   if(binding.rowCount!==1||bound.account_id!==p.accountId||
      bound.agent_id!==p.agentId||bound.device_id!==p.deviceId||
      bound.connection_id!==cn.connectionId||bound.grant_id!==grantId||
      bound.pairing_request_id!==p.requestId||bound.closed_at!==null||
      !(new Date(bound.expires_at).getTime()>now()))
    deny('abv2_poll_client_not_durable',503);
   const final=validateDevice(p);
   if(final.connectionId!==cn.connectionId||
      accessGrants.assert(grantId,{accountId:p.accountId,agentId:p.agentId,
       deviceId:p.deviceId,connectionId:cn.connectionId,touch:false}).grantId!==grantId)
    deny('abv2_poll_final_scope_changed',409);
   sendJson(res,200,{ok:true,status:'ready',helperReady:true,
    requestId:p.requestId,deviceId:p.deviceId,shortId:p.shortId,
    clientSessionId:attached.clientSessionId,
    agentId:p.agentId,expiresAt:Math.min(new Date(row.expires_at).getTime(),
      new Date(row.absolute_expires_at).getTime())});
  }catch(error){
   const status=error instanceof GoldAbV2HelperProofError?error.status:503;
   sendJson(res,[400,401,403,404,405,409,429,503].includes(status)?status:503,
    {ok:false,error:error instanceof GoldAbV2HelperProofError?
     error.message:'abv2_poll_unavailable'});
  }
  return true;
 };
}
