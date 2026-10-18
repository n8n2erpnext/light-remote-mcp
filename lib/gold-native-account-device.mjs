/**
 * Native PostgreSQL persistence for canonical Account and Device rows.
 * Uses existing RC50 lr_accounts/lr_devices tables; no JSON snapshots.
 * Other legacy business collections are migrated separately.
 */
const ACCOUNT_COLS=[
 'account_id','email','plan','status','password_hash','created_at','password_enabled',
 'email_verified','google_sub','group_id','main_device_id','last_login_ms',
 'status_reason','dormant_ms','disabled_ms','disabled_by','disable_reason',
 'reactivated_ms','last_device_added_ms','dormancy_anchor_ms',
 'dormancy_notice14_ms','dormancy_notice3_ms'
];
const DEVICE_COLS=[
 'device_id','owner_account_id','state','last_seen_at','created_at',
 'node_id','display_name','platform','architecture','agent_version',
 'first_seen_ms','last_seen_ms','offline_ms','revoked_ms','public_identity_key',
 'capabilities','policy_profile','update_state','update_current_version',
 'update_target_version','update_helper_version','update_code','update_ms'
];
const ts=ms=>ms==null?null:new Date(ms);
const millis=t=>t==null?null:new Date(t).getTime();
const num=n=>n==null?null:Number(n);
const values=(row,cols)=>cols.map(c=>row[c]);
const upsert=(table,cols,pk)=>`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')})
 ON CONFLICT(${pk}) DO UPDATE SET ${cols.filter(c=>c!==pk&&c!=='created_at').map(c=>c+'=EXCLUDED.'+c).join(',')},updated_at=now()`;
const ACCOUNT_UPSERT=upsert('lr_accounts',ACCOUNT_COLS,'account_id');
const DEVICE_UPSERT=upsert('lr_devices',DEVICE_COLS,'device_id');
function toAccount(row){
 if(!row||!row.accountId||!row.email)throw Error('native_account_identity_missing');
 return {
  account_id:row.accountId,email:row.email,plan:row.plan||'free',status:row.status||'active',
  password_hash:row.passwordHash||null,created_at:ts(row.createdAt),password_enabled:row.passwordEnabled!==false,
  email_verified:row.emailVerified===true,google_sub:row.googleSub||null,group_id:row.groupId||null,
  main_device_id:row.mainDeviceId||null,last_login_ms:row.lastLoginAt??null,
  status_reason:row.statusReason||null,dormant_ms:row.dormantAt??null,
  disabled_ms:row.disabledAt??null,disabled_by:row.disabledBy||null,
  disable_reason:row.disableReason||null,reactivated_ms:row.reactivatedAt??null,
  last_device_added_ms:row.lastDeviceAddedAt??null,dormancy_anchor_ms:row.dormancyNoticeAnchor??null,
  dormancy_notice14_ms:row.dormancyNotice14At??null,
  dormancy_notice3_ms:row.dormancyNotice3At??null
 };
}
function toDevice(row){
 if(!row?.deviceId||!row.accountId||!row.nodeId)throw Error('native_device_identity_missing');
 const u=row.updateStatus||{};
 return {
  device_id:row.deviceId,owner_account_id:row.accountId,
  state:row.revokedAt?'revoked':row.offlineAt?'offline':'online',
  last_seen_at:ts(row.lastSeenAt),created_at:ts(row.firstSeenAt),
  node_id:row.nodeId,display_name:row.displayName||row.deviceId,
  platform:row.platform||'unknown',architecture:row.architecture||'unknown',
  agent_version:row.agentVersion||'unknown',
  first_seen_ms:row.firstSeenAt,last_seen_ms:row.lastSeenAt,
  offline_ms:row.offlineAt??null,revoked_ms:row.revokedAt??null,
  public_identity_key:row.publicIdentityKey||null,
  capabilities:Array.isArray(row.capabilities)?row.capabilities:[],
  policy_profile:row.policyProfile||'default',
  update_state:u.state||'idle',update_current_version:u.currentVersion||null,
  update_target_version:u.targetVersion||null,update_helper_version:u.helperVersion||null,
  update_code:u.code||null,update_ms:u.updatedAt??null
 };
}
function fromAccount(r,entitlements,fleets){
 const e=entitlements.get(r.account_id);
 const f=fleets.get(r.account_id);
 return {
  accountId:r.account_id,email:r.email,plan:r.plan,passwordHash:r.password_hash,
  passwordEnabled:r.password_enabled,emailVerified:r.email_verified,googleSub:r.google_sub,
  groupId:r.group_id,mainDeviceId:r.main_device_id,status:r.status,
  statusReason:r.status_reason,dormantAt:num(r.dormant_ms),disabledAt:num(r.disabled_ms),
  disabledBy:r.disabled_by,disableReason:r.disable_reason,reactivatedAt:num(r.reactivated_ms),
  lastDeviceAddedAt:num(r.last_device_added_ms),dormancyNoticeAnchor:num(r.dormancy_anchor_ms),
  dormancyNotice14At:num(r.dormancy_notice14_ms),dormancyNotice3At:num(r.dormancy_notice3_ms),
  createdAt:millis(r.created_at),lastLoginAt:num(r.last_login_ms),
  ...(e?{entitlement:{entitlementId:e.entitlement_id,plan:e.plan,source:e.source,
    sourceRef:e.source_ref,validFrom:num(e.valid_from_ms),validUntil:num(e.valid_until_ms),grantedAt:num(e.granted_ms)}}:{}),
  ...(f?{fleetProvisioning:{
    deviceId:f.device_id,state:f.state,reason:f.reason,moduleVersion:f.module_version,
    agentVersion:f.agent_version,minimumSupportedVersion:f.minimum_supported_version,
    latestVersion:f.latest_version,updateRequired:f.update_required,port:f.port,
    startedAt:num(f.started_ms),updatedAt:num(f.updated_ms),onlineAt:num(f.online_ms)
  }}:{})
 };
}
function fromDevice(r){
 return {
  deviceId:r.device_id,accountId:r.owner_account_id,nodeId:r.node_id,
  displayName:r.display_name,platform:r.platform,architecture:r.architecture,
  agentVersion:r.agent_version,firstSeenAt:num(r.first_seen_ms),lastSeenAt:num(r.last_seen_ms),
  offlineAt:num(r.offline_ms),revokedAt:num(r.revoked_ms),publicIdentityKey:r.public_identity_key,
  capabilities:r.capabilities||[],policyProfile:r.policy_profile||'default',
  updateStatus:{state:r.update_state,currentVersion:r.update_current_version,
   targetVersion:r.update_target_version,helperVersion:r.update_helper_version,
   code:r.update_code,updatedAt:num(r.update_ms)}
 };
}
export class GoldNativeAccountDevice{
 constructor({pool,accounts,devices}){
  if(!pool?.connect||!pool?.query)throw Error('native_pg_pool_required');
  this.pool=pool;this.accounts=accounts;this.devices=devices;
 }
 static async open({pool}){
  const [ar,dr,er,fr]=await Promise.all([
   pool.query('SELECT * FROM lr_accounts ORDER BY account_id'),
   pool.query('SELECT * FROM lr_devices ORDER BY device_id'),
   pool.query('SELECT * FROM lr_gold_account_entitlements'),
   pool.query('SELECT * FROM lr_gold_fleet_provisioning')]);
  const entitlements=new Map(er.rows.map(r=>[r.account_id,r]));
  const fleets=new Map(fr.rows.map(r=>[r.account_id,r]));
  return new GoldNativeAccountDevice({pool,
   accounts:ar.rows.map(r=>fromAccount(r,entitlements,fleets)),
   devices:dr.rows.map(fromDevice)});
 }
 async writeAccounts(map,saveRest){
  const client=await this.pool.connect();
  let started=false;
  try{
   await client.query('BEGIN');started=true;
   for(const row of map.values()){
    const normalized=toAccount(row);
    await client.query(ACCOUNT_UPSERT,values(normalized,ACCOUNT_COLS));
    const e=row.entitlement;
    if(e){
     await client.query(`INSERT INTO lr_gold_account_entitlements(account_id,entitlement_id,plan,source,source_ref,valid_from_ms,valid_until_ms,granted_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(account_id) DO UPDATE SET
      entitlement_id=EXCLUDED.entitlement_id,plan=EXCLUDED.plan,source=EXCLUDED.source,
      source_ref=EXCLUDED.source_ref,valid_from_ms=EXCLUDED.valid_from_ms,
      valid_until_ms=EXCLUDED.valid_until_ms,granted_ms=EXCLUDED.granted_ms`,
      [row.accountId,e.entitlementId,e.plan,e.source,e.sourceRef??null,
       e.validFrom,e.validUntil??null,e.grantedAt]);
    }else await client.query('DELETE FROM lr_gold_account_entitlements WHERE account_id=$1',[row.accountId]);
    const f=row.fleetProvisioning;
    if(f){
     await client.query(`INSERT INTO lr_gold_fleet_provisioning(account_id,device_id,state,reason,module_version,agent_version,minimum_supported_version,latest_version,update_required,port,started_ms,updated_ms,online_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(account_id) DO UPDATE SET
      device_id=EXCLUDED.device_id,state=EXCLUDED.state,reason=EXCLUDED.reason,
      module_version=EXCLUDED.module_version,agent_version=EXCLUDED.agent_version,
      minimum_supported_version=EXCLUDED.minimum_supported_version,latest_version=EXCLUDED.latest_version,
      update_required=EXCLUDED.update_required,port=EXCLUDED.port,
      started_ms=EXCLUDED.started_ms,updated_ms=EXCLUDED.updated_ms,online_ms=EXCLUDED.online_ms`,
      [row.accountId,f.deviceId,f.state,f.reason??null,f.moduleVersion??null,
       f.agentVersion??null,f.minimumSupportedVersion??null,f.latestVersion??null,
       f.updateRequired===true,f.port??null,f.startedAt,f.updatedAt,f.onlineAt??null]);
    }else await client.query('DELETE FROM lr_gold_fleet_provisioning WHERE account_id=$1',[row.accountId]);
   }
   if(saveRest)await saveRest(client);
   // Mirror authorized account removals; PostgreSQL FKs reject unsafe cascades.
   // Never let a deleted Account reappear after an Operator restart.
   const currentIds=[...map.keys()];
   if(currentIds.length)await client.query('DELETE FROM lr_accounts WHERE NOT (account_id=ANY($1::text[]))',[currentIds]);
   else await client.query('DELETE FROM lr_accounts');
   await client.query('COMMIT');started=false;
  }catch(error){if(started)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
 async writeDevices(map){
  const client=await this.pool.connect();let started=false;
  try{
   await client.query('BEGIN');started=true;
   for(const row of map.values()){
    const normalized=toDevice(row);
    await client.query(DEVICE_UPSERT,values(normalized,DEVICE_COLS));
   }
   const ids=[...map.keys()];
   if(ids.length)await client.query('DELETE FROM lr_devices WHERE NOT (device_id=ANY($1::text[]))',[ids]);
   else await client.query('DELETE FROM lr_devices');
   await client.query('COMMIT');started=false;
  }catch(error){if(started)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
}
