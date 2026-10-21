/**
 * Apply the reviewed RC50 PostgreSQL schema to an isolated Gold database.
 * Uses the separate owner-provisioned lr_gold_migrator role, not app credentials.
 * Never creates a database, connects to production, or auto-runs during API boot.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Pool} from 'pg';
import {fileURLToPath} from 'node:url';

const root=fs.realpathSync(process.env.LIGHT_REMOTE_GOLD_ROOT||'/nonexistent');
if(process.env.LIGHT_REMOTE_GOLD_INDEPENDENT!=='1'||process.env.LR_GOLD_APPLY_MIGRATIONS!=='1')
 throw Error('explicit_gold_independent_migration_approval_required');
const file=fs.realpathSync(process.env.LR_GOLD_MIGRATOR_URL_FILE||'/nonexistent');
if(!file.startsWith(root+path.sep)||(fs.statSync(file).mode&0o077)!==0)
 throw Error('gold_migrator_credentials_not_private');
const url=fs.readFileSync(file,'utf8').trim(),parsed=new URL(url);
if(!['postgresql:','postgres:'].includes(parsed.protocol)||
 decodeURIComponent(parsed.pathname.slice(1))!=='light_remote_gold_dev'||
 decodeURIComponent(parsed.username)!=='lr_gold_migrator')
 throw Error('gold_migrator_target_invalid');

const sqlRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../platform-v2/sql');
const manifest=JSON.parse(fs.readFileSync(path.join(sqlRoot,'migrations.lock.json'),'utf8'));
if(manifest.migrations?.length!==32||manifest.target!=='light_remote_gold_dev - independent Gold only')
 throw Error('gold_migration_manifest_not_verified');
const records=manifest.migrations.map((row,i)=>{
 if(row.version!==i+1||!/^[0-9]{3}_[a-z0-9_]+\.sql$/.test(row.file))
  throw Error('gold_migration_version_invalid');
 const source=fs.readFileSync(path.join(sqlRoot,row.file),'utf8');
 if(crypto.createHash('sha256').update(source).digest('hex')!==row.sha256)
  throw Error('gold_migration_hash_mismatch_'+row.version);
 const match=/^\s*(?:--[^\n]*\n\s*)*BEGIN;([\s\S]*?)COMMIT;\s*$/.exec(source);
 if(!match)throw Error('gold_migration_transaction_shape_invalid_'+row.version);
 return {version:row.version,sql:match[1]};
});
const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:4000});
try{
 const client=await pool.connect();
 try{
  const who=(await client.query("SELECT current_database() AS db,current_user AS role,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser")).rows?.[0];
  if(who?.db!=='light_remote_gold_dev'||who?.role!=='lr_gold_migrator'||who.superuser!==false)
   throw Error('gold_migrator_identity_mismatch');
  for(const row of records){
   await client.query('BEGIN');
   try{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('light_remote_gold_dev:schema_migrations'))");
    const hasLedger=(await client.query("SELECT to_regclass('public.lr_schema_migrations') AS ledger")).rows[0]?.ledger;
    let applied=false;
    if(hasLedger){
     applied=(await client.query('SELECT EXISTS(SELECT 1 FROM lr_schema_migrations WHERE version=$1) AS applied',[row.version])).rows[0].applied;
    }
    if(!applied){
     await client.query(row.sql);
     await client.query('INSERT INTO lr_schema_migrations(version) VALUES($1) ON CONFLICT(version) DO NOTHING',[row.version]);
    }
    await client.query('COMMIT');
    console.log('gold_sql_version',row.version,applied?'already_applied':'applied');
   }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
   }
  }
 }finally{client.release()}
}finally{await pool.end()}
