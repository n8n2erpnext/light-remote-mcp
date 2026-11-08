import fs from 'node:fs';
import crypto from 'node:crypto';
import {Pool} from 'pg';

// This tool is only for a fresh, explicitly marked reconstruction fixture DB.
// It cannot migrate the old Lab/UAT: neither its network nor credentials are mounted.
if(process.env.LR_UNIFIED_DISPOSABLE_DEV!=='1')throw Error('disposable_dev_required');
const file=process.env.LR_GOLD_MIGRATOR_URL_FILE;
if(!file?.startsWith('/bootstrap/')||(fs.statSync(file).mode&0o077)!==0)throw Error('private_migrator_required');
const manifest=JSON.parse(fs.readFileSync('project.manifest.json'));
const extension=manifest.database.extensions.find(x=>x.id==='owner-authority.v1');
const sql=fs.readFileSync(extension.file,'utf8');
if(crypto.createHash('sha256').update(sql).digest('hex')!==extension.sha256)throw Error('extension_digest_mismatch');
const pool=new Pool({connectionString:fs.readFileSync(file,'utf8').trim(),max:1});
try{
 const client=await pool.connect();
 try{
  const identity=(await client.query("SELECT current_user AS role,current_database() AS db,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  if(identity.role!=='lr_gold_migrator'||identity.db!=='light_remote_gold_dev'||identity.marker!==`lr-unified-fixture:${process.env.LR_UNIFIED_SOURCE_COMMIT}`)throw Error('fixture_identity_mismatch');
  const versions=(await client.query('SELECT version FROM lr_schema_migrations ORDER BY version')).rows;
  if(versions.length!==43||versions.some((x,i)=>Number(x.version)!==i+1))throw Error('core_43_required');
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('lr-unified:owner-extension'))");
  await client.query('CREATE TABLE IF NOT EXISTS lr_unified_schema_extensions(extension_id text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const prior=(await client.query('SELECT sha256 FROM lr_unified_schema_extensions WHERE extension_id=$1',[extension.id])).rows[0];
  if(prior&&prior.sha256!==extension.sha256)throw Error('extension_ledger_drift');
  if(!prior){
   const match=/^\s*(?:--[^\n]*\n\s*)*BEGIN;([\s\S]*?)COMMIT;\s*$/.exec(sql);
   if(!match)throw Error('extension_transaction_invalid');
   await client.query(match[1]);
   await client.query('INSERT INTO lr_unified_schema_extensions(extension_id,sha256) VALUES($1,$2)',[extension.id,extension.sha256]);
  }
  await client.query('GRANT SELECT ON lr_unified_schema_extensions TO lr_gold_app');
  await client.query('COMMIT');
  console.log('owner-authority.v1',prior?'already_applied':'applied');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}finally{await pool.end()}
