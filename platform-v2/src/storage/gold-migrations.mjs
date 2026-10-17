/**
 * Applies the 13 unchanged RC.50 SQL migrations to a fresh Gold database.
 * Migrator and app roles are distinct, never superuser.
 * Never used by the Operator or the Plugin on startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const GOLD_MIGRATION_VERSION=14;
export const GOLD_MIGRATION_DATABASE='light_remote_gold_dev';
export const GOLD_MIGRATION_ROLE='lr_gold_migrator';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../infra/pgredis/migrations');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const check=(condition,error)=>{if(!condition)throw Error(error)};

export function lockedGoldMigrations({directory=dir}={}){
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'migrations.lock.json'),'utf8'));
 check(manifest.format===1&&manifest.migrations?.length===GOLD_MIGRATION_VERSION,'gold_migration_lock_mismatch');
 const sqlFiles=fs.readdirSync(directory).filter(x=>/^[0-9]{3}_[a-z0-9_]+\.sql$/.test(x)).sort();
 const expected=[];
 const out=manifest.migrations.map((item,index)=>{
   const version=index+1;
   check(item.version===version&&new RegExp('^'+String(version).padStart(3,'0')+'_[a-z0-9_]+\\.sql$').test(item.file),
     'gold_migration_version_sequence_invalid');
   const bytes=fs.readFileSync(path.join(directory,item.file));
   check(sha(bytes)===item.sha256,'gold_migration_source_hash_mismatch_'+version);
   const sql=bytes.toString('utf8');
   check(/^BEGIN;\s/m.test(sql)&&/\bCOMMIT;\s*$/.test(sql),'gold_migration_nontransactional_'+version);
   check(sql.includes('lr_schema_migrations'),'gold_migration_missing_version_marker_'+version);
   check(!/\b(\\connect|CREATE DATABASE|DROP DATABASE|CREATE ROLE|ALTER ROLE)\b/i.test(sql),
     'gold_migration_unsafe_ddl_'+version);
   expected.push(item.file);
   return {version,file:item.file,sha256:item.sha256,sql};
 });
 check(JSON.stringify(sqlFiles)===JSON.stringify(expected.sort()),'gold_migration_unlocked_extra_file');
 return out;
}
export async function runLockedGoldMigrations(client,{migrations=lockedGoldMigrations()}={}){
 check(client&&typeof client.query==='function','gold_migration_client_required');
 // Advisory lock holds through the whole version sequence; release on all paths.
 const who=(await client.query(
   'SELECT current_database() AS db,current_user AS role,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser'
 )).rows?.[0];
 check(who?.db===GOLD_MIGRATION_DATABASE&&who.role===GOLD_MIGRATION_ROLE&&who.superuser===false,
   'gold_migrator_wrong_database_or_role');
 await client.query("SELECT pg_advisory_lock(hashtext('lr_gold_schema_v1'))");
 const applied=[];
 try{
   const rows=await client.query("SELECT to_regclass('public.lr_schema_migrations') AS name");
   const current=rows.rows?.[0]?.name?
     (await client.query('SELECT version FROM lr_schema_migrations ORDER BY version')).rows.map(x=>Number(x.version)):[];
   check(current.every((v,i)=>v===i+1&&v<=GOLD_MIGRATION_VERSION),
     'gold_migration_existing_schema_unknown');
   for(const m of migrations){
     if(current.includes(m.version))continue;
     // Every file begins BEGIN and ends COMMIT; do not wrap it again.
     await client.query(m.sql);
     const verify=await client.query('SELECT 1 AS found FROM lr_schema_migrations WHERE version=$1',[m.version]);
     check(verify.rows?.[0]?.found===1,'gold_migration_missing_ledger_'+m.version);
     applied.push(m.version);
   }
   const final=await client.query('SELECT version FROM lr_schema_migrations ORDER BY version');
   check(final.rows.length===GOLD_MIGRATION_VERSION&&final.rows.every((x,i)=>Number(x.version)===i+1),
     'gold_migration_final_ledger_invalid');
   return {schemaVersion:GOLD_MIGRATION_VERSION,applied,alreadyApplied:GOLD_MIGRATION_VERSION-applied.length};
 }finally{
   await client.query("SELECT pg_advisory_unlock(hashtext('lr_gold_schema_v1'))");
 }
}
