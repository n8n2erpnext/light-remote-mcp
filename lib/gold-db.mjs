/**
 * Native Light Remote Gold storage connection (no alternate application/Core).
 * PostgreSQL is the durable authority; Redis is transient coordination only.
 * Credentials are supplied in owner-created, mode-0600 files, never arguments.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Pool} from 'pg';
import {createClient} from 'redis';

function secretFile(root,filename,field){
  if(!path.isAbsolute(filename||''))throw Error(field+'_file_required');
  const file=fs.realpathSync(filename);
  if(!file.startsWith(root+path.sep))throw Error(field+'_outside_gold_root');
  const stat=fs.statSync(file);
  if(!stat.isFile()||(stat.mode&0o077)!==0)throw Error(field+'_permissions');
  const secret=fs.readFileSync(file,'utf8').trim();
  if(secret.length<8||secret.length>4096)throw Error(field+'_invalid');
  return secret;
}
export function goldStorageConfig(env=process.env){
  if(env.LIGHT_REMOTE_GOLD_INDEPENDENT!=='1')throw Error('gold_independent_mode_required');
  const root=fs.realpathSync(String(env.LIGHT_REMOTE_GOLD_ROOT||''));
  const pgUrl=secretFile(root,env.LR_GOLD_PG_URL_FILE,'gold_pg');
  const redisUrl=secretFile(root,env.LR_GOLD_REDIS_URL_FILE,'gold_redis');
  const pg=new URL(pgUrl),redis=new URL(redisUrl);
  if(!['postgresql:','postgres:'].includes(pg.protocol)||decodeURIComponent(pg.pathname.slice(1))!=='light_remote_gold_dev'||
     decodeURIComponent(pg.username)!=='lr_gold_app')throw Error('gold_pg_database_or_role_invalid');
  if(!['redis:','rediss:'].includes(redis.protocol)||!redis.password)throw Error('gold_redis_auth_required');
  const instance=String(env.LR_GOLD_INSTANCE_ID||'');
  if(!/^[a-z0-9][a-z0-9_-]{2,47}$/.test(instance))throw Error('gold_instance_invalid');
  return {pgUrl,redisUrl,instance};
}
export async function connectGoldStorage(env=process.env){
  const {pgUrl,redisUrl,instance}=goldStorageConfig(env);
  const pool=new Pool({connectionString:pgUrl,max:10,connectionTimeoutMillis:4000,idleTimeoutMillis:15000});
  let redis;
  try{
    const info=(await pool.query("SELECT current_database() AS db,current_user AS username,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser")).rows?.[0];
    if(info?.db!=='light_remote_gold_dev'||info?.username!=='lr_gold_app'||info?.superuser!==false)
      throw Error('gold_pg_target_not_authorized');
    const grants=(await pool.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS schema_create,has_table_privilege(current_user,'public.lr_schema_migrations','INSERT') AS ledger_insert,has_table_privilege(current_user,'public.lr_schema_migrations','UPDATE') AS ledger_update,pg_has_role(current_user,'lr_gold_migrator','member') AS migrator_member")).rows?.[0];
    if(grants?.schema_create!==false||grants?.ledger_insert!==false||grants?.ledger_update!==false||
       grants?.migrator_member!==false)throw Error('gold_pg_app_privilege_unsafe');
    const records=(await pool.query('SELECT version FROM lr_schema_migrations ORDER BY version')).rows||[];
    if(records.length!==20||records.some((v,i)=>Number(v.version)!==i+1))
      throw Error('gold_pg_migrations_missing');
    redis=createClient({url:redisUrl,socket:{connectTimeout:4000,reconnectStrategy:false}});
    await redis.connect();
    if(await redis.ping()!=='PONG')throw Error('gold_redis_not_ready');
    const key='lr:gold:'+instance+':health:'+crypto.randomUUID(),token=crypto.randomBytes(16).toString('hex');
    if(await redis.set(key,token,{EX:15,NX:true})!=='OK')throw Error('gold_redis_not_writable');
    try{if(await redis.get(key)!==token)throw Error('gold_redis_read_mismatch')}finally{await redis.del(key)}
    return {pool,redis,prefix:'lr:gold:'+instance+':',async close(){
      await Promise.allSettled([redis.quit(),pool.end()]);
    }};
  }catch(error){
    await Promise.allSettled([redis?.quit?.(),pool.end()]);
    throw error;
  }
}
