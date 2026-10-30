// P2-I2g signed OAuth Helper -> owner-only device discovery, NO A issuance.
// Requires explicit opt-in + PG043. Fail closed when schema/migration absent.
import {resolvePermittedDeviceTarget,listOwnerShortIdDevices} from '../lib/gold-device-short-id.mjs';
import {goldAbV2OwnerHttpConfig} from './gold-ab-v2-owner-http.mjs';
import {goldAbV2HelperKey,verifyGoldAbV2HelperTarget,GoldAbV2HelperProofError}
 from '../lib/gold-ab-v2-helper-proof.mjs';
export function createGoldAbV2HelperTarget({
 env=process.env,storage,accounts,devices,enrollments,connections,readJson,sendJson
}={}){
 const enabled=env.LR_GOLD_AB_V2_HELPER_TARGET_QUERY==='1';
 if(!enabled)return async(req,res,url)=>{
  if(url.pathname!=='/v1/plugin/abv2/target-resolve')return false;
  sendJson(res,404,{ok:false,error:'not_found'});return true;
 };
 const config=goldAbV2OwnerHttpConfig(env);
 if(!config.enabled)throw new GoldAbV2HelperProofError('abv2_operator_gate_off',503);
 const key=goldAbV2HelperKey(env);
 if(!storage?.pool?.query||!storage?.redis?.set||!accounts||
    !devices||!enrollments||!connections||
    typeof readJson!=='function'||typeof sendJson!=='function')
  throw new GoldAbV2HelperProofError('abv2_helper_dependencies_required',503);
 return async(req,res,url)=>{
  if(url.pathname!=='/v1/plugin/abv2/target-resolve')return false;
  if(req.method!=='POST'){sendJson(res,405,{ok:false,error:'method_not_allowed'});return true;}
  try{
   const proof=await readJson(req);
   const p=await verifyGoldAbV2HelperTarget({proof,key,
    redis:storage.redis,prefix:storage.prefix});
   if(!config.allowedAccounts.has(p.accountId))
    throw new GoldAbV2HelperProofError('abv2_helper_account_not_allowed',404);
   const account=accounts.assertOperational(p.accountId);
   if(account?.accountId!==p.accountId||account?.emailVerified!==true)
    throw new GoldAbV2HelperProofError('abv2_helper_owner_not_verified',403);
   // PG043 is a candidate, not part of production migration lock. Never
   // backfill or create schema in this read-only route.
   const schema=await storage.pool.query(
    "SELECT to_regclass('public.lr_gold_device_short_ids') IS NOT NULL AS present");
   if(schema.rows?.[0]?.present!==true)
    throw new GoldAbV2HelperProofError('abv2_short_id_schema_not_ready',503);
   const ownerRows=await listOwnerShortIdDevices(storage.pool,
    {accountId:p.accountId,limit:500});
   const permitted=[];
   for(const row of ownerRows){
    if(!config.allowedDevices.has(row.deviceId))continue;
    try{
     const d=devices.get(row.deviceId);
     const binding=enrollments.binding(row.deviceId);
     const policy=enrollments.policyView(row.deviceId);
     if(d.accountId!==p.accountId||d.deviceId!==row.deviceId||
        d.state==='revoked'||d.publicIdentityKey!==binding.publicIdentityKey||
        binding.revokedAt||binding.accountId!==p.accountId||
        policy.accountId!==p.accountId||
        policy.policyProfile==='disabled'||!policy.approvedCapabilities?.length)
      continue;
     const connection=connections.get(row.deviceId);
     permitted.push({...row,state:d.state,
      // Search result is only a discovery suggestion, not an access grant.
      // Online is derived from live registries, not a caller supplied flag.
      online:d.state==='online'&&connection?.state==='connected'&&
       Number(connection.hardExpiresAt)>Date.now()});
    }catch{/* revoked/unknown device is not discoverable */ }
   }
   const match=resolvePermittedDeviceTarget({permittedDevices:permitted,
    query:p.targetQuery,limit:5});
   sendJson(res,200,{ok:true,status:match.status,total:match.total,
    matches:match.matches.map(m=>({...m,online:Boolean(
     permitted.find(x=>x.deviceId===m.deviceId)?.online)})),
    helperReady:false,approvalState:'not_issued',
    // No A/B code, requestId, poll token or grant in this route.
    nextAction:match.status==='single'?'agent_request_not_enabled':
     match.status==='ambiguous'?'choose_exact_device':'specify_target'});
  }catch(error){
   const status=error instanceof GoldAbV2HelperProofError?
    error.status:503;
   sendJson(res,[400,401,403,404,405,409,429,503].includes(status)?status:503,
    {ok:false,error:error instanceof GoldAbV2HelperProofError?
     error.message:'abv2_helper_lookup_unavailable'});
  }
  return true;
 };
}
