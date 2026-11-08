// Gold P2-I4C3c2b3c2b2: schema release gate for UNREGISTERED candidates.
// Never silently advance the Gold Operator when a schema is newer than
// the checksum-pinned migration lock. Current lock ENDS AT 042; 043 and 044 HOLD.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const lockPath=fileURLToPath(new URL('../platform-v2/sql/migrations.lock.json',import.meta.url));
const migrations=new Map([
 [43,'043_gold_device_short_ids.sql'],
 [44,'044_gold_pro_share.sql']
]);
// A release flag does not constitute a wired native Fleet/Device/M6
// adapter. Keep SQL044 startup impossible until an independently reviewed
// source integration explicitly replaces this build-time release HOLD.
// Never derive this switch from an environment variable.
export const GOLD_GUEST_NATIVE_RUNTIME_WIRED=false;
const fail=(code)=>{throw Error(code)};
function validateRecordLedger(rows){
 if(!Array.isArray(rows)||rows.length<34||rows.length>44||
    rows.some((r,i)=>Number(r?.version)!==i+1))
  fail('gold_pg_migrations_missing');
 return rows.length;
}
function requireLockedMigration(version,lock){
 const expected=migrations.get(version);
 const entry=lock?.migrations?.find(row=>row.version===version);
 if(!entry||entry.file!==expected||!/^[a-f0-9]{64}$/.test(entry.sha256||''))
  fail('gold_pg_candidate_'+version+'_not_locked');
 const src=fs.readFileSync(new URL('../platform-v2/sql/'+expected,import.meta.url));
 const digest=crypto.createHash('sha256').update(src).digest('hex');
 if(entry.sha256!==digest)fail('gold_pg_candidate_'+version+'_source_digest_mismatch');
}
export function assertGoldStartupMigrationLedger(rows,{
 env=process.env,lock=null
}={}){
 const n=validateRecordLedger(rows);
 if(n<=42)return Object.freeze({version:n,guestSchemaReady:false});
 // Reading the actual locked migration catalog is mandatory. Test callers
 // may inject a synthetic lock for unit tests, but never into the Operator.
 const verifiedLock=lock||JSON.parse(fs.readFileSync(lockPath,'utf8'));
 if(env.LR_GOLD_SCHEMA_043_RELEASE_ACCEPT!=='1')
  fail('gold_pg_schema_043_release_not_approved');
 requireLockedMigration(43,verifiedLock);
 if(n===43)return Object.freeze({version:43,guestSchemaReady:false});
 // A future 044 release must be independently approved and implement the
 // actual signed Guest Device runtime, not merely add a SQL table.
 const requiredGuestFlags=[
  'LR_GOLD_PRO_SHARE_GUEST_RUNTIME_APPROVED',
  'LR_GOLD_PRO_SHARE_CORE','LR_GOLD_PRO_SHARE_GUEST_QUEUE',
  'LR_GOLD_PRO_SHARE_GUEST_SLOTS',
  'LR_GOLD_PRO_SHARE_GUEST_PAYLOAD_STAGE',
  'LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL',
  'LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE',
  'LR_GOLD_PRO_SHARE_GUEST_TICKET_ISSUE',
  'LR_GOLD_PRO_SHARE_GUEST_OUTBOUND_PREPARE',
  'LR_GOLD_PRO_SHARE_GUEST_FLEET_ADAPTER',
  'LR_GOLD_PRO_SHARE_GUEST_SIGNED_LAUNCH',
  'LR_GOLD_PRO_SHARE_GUEST_LAUNCH_BIND',
  'LR_GOLD_PRO_SHARE_GUEST_TERMINAL_SETTLE',
  'OPERATOR_PERSONAL_AGENT_SCHEDULER',
  'OPERATOR_DEVICE_RESOURCE_LOCKS',
  'OPERATOR_EXECUTION_EPOCH_ENABLED'
 ];
 if(env.LR_GOLD_PRO_SHARE_SCHEMA_044_RELEASE_ACCEPT!=='1'||
    requiredGuestFlags.some(key=>env[key]!=='1'))
  fail('gold_pg_schema_044_guest_runtime_release_not_approved');
 requireLockedMigration(44,verifiedLock);
 // Future locked SQL044 plus all ON env flags is STILL insufficient until
 // actual authenticated Fleet dispatch, Agent receipt, M6 and bill-once
 // are routed through the Operator. This build ships no such integration.
 if(GOLD_GUEST_NATIVE_RUNTIME_WIRED!==true)
  fail('gold_pg_schema_044_native_guest_runtime_not_wired');
 return Object.freeze({version:44,guestSchemaReady:true});
}
export async function assertGoldStartupExtensionTables(pool,version){
 if(!Number.isInteger(version)||version<34||version>44||!pool?.query)
  fail('gold_pg_extension_probe_invalid');
 if(version>=43){
  const x=(await pool.query(`SELECT
    to_regclass('public.lr_gold_device_short_ids') IS NOT NULL AS short_ids,
    EXISTS(SELECT 1 FROM pg_trigger
      WHERE tgrelid='public.lr_gold_device_short_ids'::regclass
        AND tgname='lr_gold_short_id_immutable_trg'
        AND NOT tgisinternal) AS immutable_trigger`)).rows?.[0];
  if(x?.short_ids!==true||x?.immutable_trigger!==true)
   fail('gold_pg_migration_043_short_id_contract_missing');
 }
 if(version>=44){
  const x=(await pool.query(`SELECT
    to_regclass('public.lr_gold_pro_share_addons') IS NOT NULL AS addons,
    to_regclass('public.lr_gold_pro_share_seats') IS NOT NULL AS seats,
    to_regclass('public.lr_gold_pro_share_devices') IS NOT NULL AS devices,
    to_regclass('public.lr_gold_pro_share_guest_jobs') IS NOT NULL AS jobs,
    to_regclass('public.lr_gold_pro_share_guest_slots') IS NOT NULL AS slots,
    to_regclass('public.lr_gold_pro_share_guest_payloads') IS NOT NULL AS payloads,
    to_regclass('public.lr_gold_pro_share_guest_outbound') IS NOT NULL AS outbound,
    to_regclass('public.lr_gold_pro_share_usage_events') IS NOT NULL AS usage,
    EXISTS(SELECT 1 FROM pg_constraint
      WHERE conrelid='public.lr_ab_grants'::regclass
        AND conname='lr_ab_grants_owner_connection_fk') AS owner_connection_fk`)).rows?.[0];
  if(!x||Object.values(x).some(v=>v!==true))
   fail('gold_pg_migration_044_guest_scope_contract_missing');
 }
 return Object.freeze({version,verified:true});
}
