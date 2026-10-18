import assert from 'node:assert/strict';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
import {AccountRegistry} from '../../operator-host/account-registry.mjs';
import {DeviceRegistry} from '../../operator-host/device-registry.mjs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';

const docs=new Map(),nativeAccounts=new Map(),nativeDevices=new Map(),nativeEntitlements=new Map(),nativeFleet=new Map();
const ACCOUNT_COLS=['account_id','email','plan','status','password_hash','created_at','password_enabled','email_verified','google_sub','group_id','main_device_id','last_login_ms','status_reason','dormant_ms','disabled_ms','disabled_by','disable_reason','reactivated_ms','last_device_added_ms','dormancy_anchor_ms','dormancy_notice14_ms','dormancy_notice3_ms'];
const DEVICE_COLS=['device_id','owner_account_id','state','last_seen_at','created_at','node_id','display_name','platform','architecture','agent_version','first_seen_ms','last_seen_ms','offline_ms','revoked_ms','public_identity_key','capabilities','policy_profile','update_state','update_current_version','update_target_version','update_helper_version','update_code','update_ms'];
const sql=[];
const query=async(statement,args=[])=>{
 sql.push(statement);
 if(statement.startsWith('SELECT team_id,owner_account_id,created_at FROM lr_teams')||
 statement.startsWith('SELECT team_id,account_id FROM lr_team_members')||
 statement.startsWith('SELECT team_id,device_id FROM lr_gold_team_shared_devices')||
 statement.startsWith('SELECT * FROM lr_gold_team_entitlements')||
 statement.startsWith('SELECT * FROM lr_gold_team_invite_codes')||
 statement.startsWith('SELECT * FROM lr_gold_team_notification_reads')||
 statement.startsWith('SELECT owner_account_id,member_email,issued_ms FROM lr_gold_team_email_invite_events')||
 statement.startsWith('SELECT * FROM lr_gold_license_keys')||
 statement.startsWith('SELECT license_id,account_id,redeemed_ms FROM lr_gold_license_redemptions')||
 statement.startsWith('SELECT DISTINCT ON(device_id) * FROM lr_device_connections')||
 statement.startsWith('SELECT * FROM lr_gold_paddle_events')||
 statement.startsWith('SELECT * FROM lr_gold_paddle_subscriptions')||
 statement.startsWith('SELECT * FROM lr_gold_paddle_refunds')||
 statement.startsWith('SELECT * FROM lr_gold_support_outbox'))
 return {rows:[]};
 if(statement==='BEGIN'||statement==='COMMIT'||statement==='ROLLBACK')return {rows:[]};
 if((statement.startsWith('DELETE FROM lr_teams')||statement.startsWith('INSERT INTO lr_teams')||statement.startsWith('DELETE FROM lr_gold_team_')||statement.startsWith('DELETE FROM lr_team_')||
      statement.startsWith('INSERT INTO lr_gold_team_')||statement.startsWith('INSERT INTO lr_team_')||
      statement.startsWith('DELETE FROM lr_gold_license_')||statement.startsWith('INSERT INTO lr_gold_license_')))
   return {rows:[],rowCount:1};
 if(statement.startsWith('SELECT domain,payload FROM lr_gold_registry_documents'))
  return {rows:[...docs].map(([domain,payload])=>({domain,payload:structuredClone(payload)}))};
 if(statement.startsWith('SELECT * FROM lr_accounts ORDER BY'))
  return {rows:[...nativeAccounts.values()].map(row=>structuredClone(row))};
 if(statement.startsWith('SELECT * FROM lr_devices ORDER BY'))
  return {rows:[...nativeDevices.values()].map(row=>structuredClone(row))};
 if(statement.startsWith('SELECT * FROM lr_gold_account_entitlements'))
  return {rows:[...nativeEntitlements.values()].map(row=>structuredClone(row))};
 if(statement.startsWith('SELECT * FROM lr_gold_fleet_provisioning'))
  return {rows:[...nativeFleet.values()].map(row=>structuredClone(row))};
 if(statement.startsWith('INSERT INTO lr_gold_registry_documents')){
  docs.set(args[0],JSON.parse(args[1]));return {rowCount:1,rows:[]};
 }
 if(statement.startsWith('INSERT INTO lr_accounts')){
  const row=Object.fromEntries(ACCOUNT_COLS.map((col,i)=>[col,args[i]]));
  nativeAccounts.set(row.account_id,row);return {rowCount:1,rows:[]};
 }
 if(statement.startsWith('INSERT INTO lr_devices')){
  const row=Object.fromEntries(DEVICE_COLS.map((col,i)=>[col,args[i]]));
  assert.ok(nativeAccounts.has(row.owner_account_id),'native device owner must be committed');
  nativeDevices.set(row.device_id,row);return {rowCount:1,rows:[]};
 }
 if(statement.startsWith('DELETE FROM lr_gold_account_entitlements')){
  nativeEntitlements.delete(args[0]);return {rows:[]};
 }
 if(statement.startsWith('INSERT INTO lr_gold_account_entitlements')){
  nativeEntitlements.set(args[0],{account_id:args[0],entitlement_id:args[1],plan:args[2],source:args[3],source_ref:args[4],valid_from_ms:args[5],valid_until_ms:args[6],granted_ms:args[7]});return {rows:[]};
 }
 if(statement.startsWith('DELETE FROM lr_gold_fleet_provisioning')){
  nativeFleet.delete(args[0]);return {rows:[]};
 }
 if(statement.startsWith('INSERT INTO lr_gold_fleet_provisioning')){
  nativeFleet.set(args[0],{account_id:args[0],device_id:args[1],state:args[2],reason:args[3],module_version:args[4],agent_version:args[5],minimum_supported_version:args[6],latest_version:args[7],update_required:args[8],port:args[9],started_ms:args[10],updated_ms:args[11],online_ms:args[12]});return {rows:[]};
 }
 if(statement.startsWith('DELETE FROM lr_accounts WHERE NOT')){
  for(const id of [...nativeAccounts.keys()])if(!args[0].includes(id))nativeAccounts.delete(id);
  return {rows:[]};
 }
 if(statement.startsWith('DELETE FROM lr_accounts')){nativeAccounts.clear();return {rows:[]};}
 if(statement.startsWith('DELETE FROM lr_devices WHERE NOT')){
  for(const id of [...nativeDevices.keys()])if(!args[0].includes(id))nativeDevices.delete(id);
  return {rows:[]};
 }
 if(statement.startsWith('DELETE FROM lr_devices')){nativeDevices.clear();return {rows:[]};}
 throw Error('unexpected_sql:'+statement.slice(0,90));
};
const pool={query,async connect(){return {query,release(){}}}};
const make=async()=>{
 const store=await GoldRegistryPersistence.open({pool});
 const accounts=store.mount('accounts',new AccountRegistry({stateFile:null}));
 const devices=store.mount('devices',new DeviceRegistry({stateFile:null}));
 const team=store.mount('pro_teams',new ProTeamRegistry({stateFile:null,planFor:()=> 'pro',accountActive:()=>true,emailFor:()=>null}));
 await store.flush();
 return {store,accounts,devices,team};
};
const first=await make();
const group=first.accounts.createGroup('Gold PostgreSQL');
const registered=first.accounts.registerHosted({email:'gold-uat@example.test',password:'LongPassword123!'});
const accountId=registered.account.accountId;
first.devices.enroll({accountId,deviceId:'gold_device',nodeId:'gold_node',publicIdentityKey:'synthetic_public_key',displayName:'Gold Test'});
await first.store.flush();
assert.ok(nativeAccounts.has(accountId));
assert.equal(nativeDevices.get('gold_device').node_id,'gold_node');
assert.equal(docs.get('accounts').accounts,undefined,'whole account records must not be JSONB snapshots');
assert.equal(docs.has('devices'),false,'whole device records must not be JSONB snapshots');
const restarted=await make();
assert.ok(restarted.accounts.listGroups().some(x=>x.groupId===group.groupId));
assert.equal(restarted.accounts.verifyCredentials({email:'gold-uat@example.test',password:'LongPassword123!'}).accountId,accountId);
assert.equal(restarted.devices.get('gold_device').deviceId,'gold_device');
assert.ok(sql.some(x=>x.startsWith('INSERT INTO lr_accounts')));
assert.ok(sql.some(x=>x.startsWith('INSERT INTO lr_devices')));
console.log('GOLD_NATIVE_ACCOUNT_DEVICE_RESTART_FAKE=PASS');
