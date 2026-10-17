import {lockedGoldMigrations,GOLD_MIGRATION_DATABASE,GOLD_MIGRATION_ROLE,GOLD_MIGRATION_VERSION} from './gold-migrations.mjs';

export const GOLD_APP_ROLE='lr_gold_app';
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const NAME=/^lr_[a-z0-9_]+$/;
const FN=/^(?:(?:public)\.)?lr_[a-z0-9_]+\([a-z0-9_,\s\[\]]*\)$/;
export const APP_ENTRY_FUNCTIONS=new Set([
 'lr_claim_worker_slot','lr_renew_worker_lease','lr_finish_worker_job',
 'lr_claim_outbox','lr_ack_outbox','lr_retry_outbox',
 'lr_charge_usage_uat','lr_charge_free_uat','lr_charge_team_member_uat',
 'lr_finalize_free_rotation_uat','lr_consume_oauth_once_uat',
]);
// Trigger-only functions must not have EXECUTE granted to the application.
const TRIGGER_ONLY=new Set([
 'lr_enforce_team_seat_limit','lr_enforce_team_seat_cap_change','lr_guard_free_event_uat',
]);
const canonical=(s)=>String(s).replace(/\s+/g,'').toLowerCase();
const sorted=a=>[...a].sort();
export function goldTableManifest(migrations=lockedGoldMigrations()){
 const tables=new Set();
 for(const m of migrations){
  for(const match of m.sql.matchAll(/\bCREATE TABLE IF NOT EXISTS (lr_[a-z0-9_]+)\s*\(/g)){
   assert(NAME.test(match[1]),'gold_unsafe_table_identifier');tables.add(match[1]);
  }
 }
 assert(tables.size>=25,'gold_schema_tables_incomplete');
 assert(tables.has('lr_schema_migrations')&&tables.has('lr_accounts')&&tables.has('lr_notifications'),
  'gold_schema_core_tables_missing');
 return sorted(tables);
}
async function migratorIdentity(client){
 const row=(await client.query(
  "SELECT current_database() AS db,current_user AS role,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser"
 )).rows?.[0];
 assert(row?.db===GOLD_MIGRATION_DATABASE&&row.role===GOLD_MIGRATION_ROLE&&row.superuser===false,
  'gold_permissions_migrator_invalid');
 const app=(await client.query(
  "SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=$1",
  [GOLD_APP_ROLE])).rows?.[0];
 assert(app&&app.rolsuper===false&&app.rolcreatedb===false&&app.rolcreaterole===false
  &&app.rolreplication===false&&app.rolbypassrls===false,
  'gold_permissions_app_role_not_least_privilege');
 const member=(await client.query("SELECT pg_has_role($1,$2,'member') AS inherited",
  [GOLD_APP_ROLE,GOLD_MIGRATION_ROLE])).rows?.[0];
 assert(member?.inherited===false,'gold_permissions_app_inherits_migrator');
}
async function schemaCatalog(client){
 const versions=(await client.query('SELECT version FROM lr_schema_migrations ORDER BY version')).rows;
 assert(versions.length===GOLD_MIGRATION_VERSION&&versions.every((x,i)=>Number(x.version)===i+1),
  'gold_permissions_schema_not_applied');
 const expected=goldTableManifest();
 const actual=(await client.query(
  "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'lr_%' ORDER BY tablename"
 )).rows.map(x=>x.tablename);
 assert(JSON.stringify(actual)===JSON.stringify(expected),'gold_permissions_table_catalog_mismatch');
 const fnRows=(await client.query(
  "SELECT p.proname AS name,p.oid::regprocedure::text AS signature "+
  "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "+
  "WHERE n.nspname='public' AND p.proname LIKE 'lr_%' ORDER BY p.proname"
 )).rows;
 const names=new Set();
 for(const f of fnRows){
  assert(NAME.test(f.name)&&FN.test(f.signature),'gold_permissions_unsafe_function_catalog');
  assert(!names.has(f.name),'gold_permissions_overloaded_function_forbidden');
  names.add(f.name);
 }
 assert(sorted(names).join(',')===sorted([...APP_ENTRY_FUNCTIONS,...TRIGGER_ONLY]).join(','),
  'gold_permissions_function_catalog_mismatch');
 return {tables:expected,functions:fnRows};
}
export async function applyGoldPrivileges(client){
 assert(client&&typeof client.query==='function','gold_permissions_client_required');
 await migratorIdentity(client);
 // Guarded session-scoped SQL transaction: all changes commit or roll back.
 await client.query('BEGIN');
 try{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('lr_gold_permissions_v1'))");
  const catalog=await schemaCatalog(client);
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query('GRANT USAGE ON SCHEMA public TO lr_gold_app');
  await client.query('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC');
  await client.query('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC');
  // Migration ledger is readable for status, never writable by application.
  await client.query('REVOKE ALL ON TABLE public.lr_schema_migrations FROM lr_gold_app');
  await client.query('GRANT SELECT ON TABLE public.lr_schema_migrations TO lr_gold_app');
  const appTables=catalog.tables.filter(x=>x!=='lr_schema_migrations');
  await client.query('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE '+
   appTables.map(t=>'public.'+t).join(',')+' TO lr_gold_app');
  await client.query('GRANT USAGE,SELECT ON SEQUENCE public.lr_outbox_outbox_id_seq TO lr_gold_app');
  for(const f of catalog.functions){
   const qualified=f.signature.startsWith('public.')?f.signature:'public.'+f.signature;
   await client.query('REVOKE EXECUTE ON FUNCTION '+qualified+' FROM PUBLIC');
   if(APP_ENTRY_FUNCTIONS.has(f.name))
    await client.query('GRANT EXECUTE ON FUNCTION '+qualified+' TO lr_gold_app');
  }
  // Query PostgreSQL's *effective* permissions before committing. Merely
  // observing successful GRANT statements would miss inherited privileges.
  const policy=(await client.query(
    "SELECT has_schema_privilege($1,'public','USAGE') AS schema_usage,"+
    "has_schema_privilege($1,'public','CREATE') AS schema_create,"+
    "has_table_privilege($1,'public.lr_schema_migrations','SELECT') AS ledger_read,"+
    "has_table_privilege($1,'public.lr_schema_migrations','INSERT') AS ledger_insert,"+
    "has_table_privilege($1,'public.lr_schema_migrations','UPDATE') AS ledger_update,"+
    "has_table_privilege($1,'public.lr_schema_migrations','DELETE') AS ledger_delete",
    [GOLD_APP_ROLE]
  )).rows?.[0];
  assert(policy?.schema_usage===true&&policy.schema_create===false&&
    policy.ledger_read===true&&policy.ledger_insert===false&&
    policy.ledger_update===false&&policy.ledger_delete===false,
    'gold_permissions_effective_schema_or_ledger_unsafe');
  for(const f of catalog.functions){
    const qualified=f.signature.startsWith('public.')?f.signature:'public.'+f.signature;
    const allowed=(await client.query(
      "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
      [GOLD_APP_ROLE,qualified])).rows?.[0]?.allowed;
    assert(allowed===APP_ENTRY_FUNCTIONS.has(f.name),
      'gold_permissions_effective_function_unsafe_'+f.name);
  }
  await client.query('COMMIT');
  return {ok:true,grantedTables:appTables.length,functions:APP_ENTRY_FUNCTIONS.size,
   triggerFunctionsNotGranted:TRIGGER_ONLY.size};
 }catch(error){
  await client.query('ROLLBACK');
  throw error;
 }
}
