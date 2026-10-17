// Gold-only schema migration CLI. This script neither creates users/databases
// nor starts Docker. Owner must provision the isolated PG service and migrator.
import fs from 'node:fs';
import path from 'node:path';
import {Client} from 'pg';
import {GOLD_MIGRATION_DATABASE,GOLD_MIGRATION_ROLE,runLockedGoldMigrations}
  from '../../platform-v2/src/storage/gold-migrations.mjs';
import {applyGoldPrivileges} from '../../platform-v2/src/storage/gold-permissions.mjs';

const required=(cond,msg)=>{if(!cond)throw Error(msg)};
const env=process.env;
let client;
try{
 required(env.LIGHT_REMOTE_GOLD_INDEPENDENT==='1','gold_migrations_independent_flag_required');
 required(env.LR_GOLD_MIGRATIONS_APPROVED==='1','gold_migration_owner_approval_required');
 required(env.LR_GOLD_PERMISSIONS_APPROVED==='1','gold_permissions_owner_approval_required');
 const root=fs.realpathSync(String(env.LIGHT_REMOTE_GOLD_ROOT||''));
 required(root!=='/'&&root.length>8,'gold_migration_invalid_root');
 const file=fs.realpathSync(String(env.LR_GOLD_MIGRATOR_URL_FILE||''));
 const stat=fs.statSync(file);
 required(file.startsWith(root+path.sep)&&stat.isFile()&&(stat.mode&0o077)===0,
  'gold_migration_credentials_not_private');
 const uri=new URL(fs.readFileSync(file,'utf8').trim());
 required(['postgres:','postgresql:'].includes(uri.protocol),'gold_migration_protocol_invalid');
 required(decodeURIComponent(uri.username)===GOLD_MIGRATION_ROLE,'gold_migration_wrong_role');
 required(decodeURIComponent(uri.pathname.slice(1))===GOLD_MIGRATION_DATABASE,'gold_migration_wrong_database');
 required(uri.password.length>0,'gold_migration_missing_password');
 required(uri.hostname!=='light-remote.thaiduy.digital','gold_migration_production_endpoint_forbidden');
 client=new Client({connectionString:uri.toString(),connectionTimeoutMillis:5000,
   statement_timeout:180000,query_timeout:190000});
 await client.connect();
 const result=await runLockedGoldMigrations(client);
 const permissions=await applyGoldPrivileges(client);
 console.log(JSON.stringify({ok:true,database:GOLD_MIGRATION_DATABASE,
   role:GOLD_MIGRATION_ROLE,applied:result.applied,
   alreadyApplied:result.alreadyApplied,schemaVersion:result.schemaVersion,
   permissions}));
}catch(error){
 console.error('gold_migration_denied_or_failed: '+String(error?.message||'unknown').replace(/:\/\/[^@]+@/g,'://[redacted]@'));
 process.exitCode=2;
}finally{
 await client?.end();
}
