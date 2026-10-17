/**
 * Gold PostgreSQL / Redis admission gate. Never infers readiness from a Docker
 * healthcheck, a mock, or a checked-in migration. No JSON-store fallback.
 *
 * Credentials are read only from owner-provisioned 0600 files inside the
 * Gold-independent root. This module does NOT start databases or run DDL.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Pool} from 'pg';
import {createClient} from 'redis';
import {assertGoldRuntimeIsolation} from '../../../lib/gold-runtime-isolation.mjs';
import {goldTableManifest} from './gold-permissions.mjs';

const REQUIRED_SCHEMA=18;
const EXPECTED_DATABASE='light_remote_gold_dev';
const EXPECTED_ROLE='lr_gold_app';
const INSTANCE=/^[a-z0-9][a-z0-9_-]{2,47}$/;
const check=(condition,code)=>{if(!condition)throw Error(code)};

export function goldCredentials(env=process.env,{role='operator'}={}){
  check(env.LIGHT_REMOTE_GOLD_INDEPENDENT==='1','gold_data_requires_independent_runtime');
  assertGoldRuntimeIsolation(env,role);
  const root=fs.realpathSync(String(env.LIGHT_REMOTE_GOLD_ROOT||''));
  const instance=String(env.LR_GOLD_INSTANCE_ID||'');
  check(INSTANCE.test(instance),'gold_instance_id_required');
  const urls={};
  for(const [kind,name] of [['pg','LR_GOLD_PG_URL_FILE'],['redis','LR_GOLD_REDIS_URL_FILE']]){
    const p=String(env[name]||'');
    check(path.isAbsolute(p),'gold_'+kind+'_credential_path_required');
    const real=fs.realpathSync(p);
    check(real.startsWith(root+path.sep),'gold_'+kind+'_credentials_outside_root');
    const stat=fs.statSync(real);
    check(stat.isFile()&&(stat.mode&0o077)===0,'gold_'+kind+'_credentials_perms');
    const value=fs.readFileSync(real,'utf8').trim();
    check(value.length>0&&value.length<4096,'gold_'+kind+'_credentials_empty');
    const uri=new URL(value);
    if(kind==='pg'){
      check(['postgres:','postgresql:'].includes(uri.protocol),'gold_pg_invalid_protocol');
      check(decodeURIComponent(uri.pathname.slice(1))===EXPECTED_DATABASE,'gold_pg_invalid_database');
      check(decodeURIComponent(uri.username)===EXPECTED_ROLE,'gold_pg_invalid_role');
    }else{
      check(['redis:','rediss:'].includes(uri.protocol),'gold_redis_invalid_protocol');
      check(uri.password.length>0,'gold_redis_auth_required');
    }
    check(uri.hostname!==''&&uri.port!=='0','gold_'+kind+'_invalid_endpoint');
    check(!['light-remote.thaiduy.digital','127.0.0.1'].includes(uri.hostname)
      || env.LR_GOLD_ALLOW_LOOPBACK_DB==='1','gold_database_endpoint_not_isolated');
    urls[kind]=value;
  }
  return {urls,instance};
}

export async function verifyGoldSchema(pool){
  const row=(await pool.query(
    "SELECT current_database() AS db,current_user AS role, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser"
  )).rows?.[0];
  check(row?.db===EXPECTED_DATABASE&&row?.role===EXPECTED_ROLE&&row.superuser===false,
    'gold_pg_database_role_mismatch');
  const records=(await pool.query('SELECT version FROM lr_schema_migrations ORDER BY version')).rows||[];
  const values=records.map(r=>Number(r.version));
  check(values.length===REQUIRED_SCHEMA&&values.every((v,i)=>v===i+1),
    'gold_pg_schema_incomplete');
  // A recorded migration version alone does not prove the actual business
  // schema exists; an accidentally hand-seeded ledger must not pass boot.
  const expected=goldTableManifest();
  const tables=(await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'lr_%' ORDER BY tablename"
  )).rows?.map(row=>row.tablename);
  check(Array.isArray(tables)&&JSON.stringify(tables)===JSON.stringify(expected),
    'gold_pg_table_catalog_incomplete_or_drifted');
  const policy=(await pool.query(
    "SELECT has_schema_privilege(current_user,'public','USAGE') AS schema_usage,"+
    "has_schema_privilege(current_user,'public','CREATE') AS schema_create,"+
    "has_table_privilege(current_user,'public.lr_schema_migrations','SELECT') AS ledger_read,"+
    "has_table_privilege(current_user,'public.lr_schema_migrations','INSERT') AS ledger_insert,"+
    "has_table_privilege(current_user,'public.lr_schema_migrations','UPDATE') AS ledger_update,"+
    "pg_has_role(current_user,'lr_gold_migrator','member') AS inherited_migrator"
  )).rows?.[0];
  check(policy?.schema_usage===true&&policy.schema_create===false&&
    policy.ledger_read===true&&policy.ledger_insert===false&&
    policy.ledger_update===false&&policy.inherited_migrator===false,
    'gold_pg_app_privileges_unsafe');
  // This only verifies recorded schema versions; apply source-SHA checked SQL
  // separately under a distinct migration role.
  return {database:row.db,role:row.role,schemaVersion:REQUIRED_SCHEMA};
}

export async function verifyGoldRedis(redis,{instance}){
  check(INSTANCE.test(instance),'gold_instance_id_required');
  check((await redis.ping())==='PONG','gold_redis_unavailable');
  const prefix='lr:gold:'+instance+':';
  const key=prefix+'ready:'+crypto.randomUUID();
  const value=crypto.randomBytes(16).toString('hex');
  const created=await redis.set(key,value,{EX:15,NX:true});
  check(created==='OK','gold_redis_write_unavailable');
  try{check((await redis.get(key))===value,'gold_redis_read_mismatch');}
  finally{await redis.del(key);}
  return {prefix,cacheOnly:true};
}

export async function openGoldDataPlane({env=process.env,poolFactory,redisFactory,role='operator'}={}){
  const {urls,instance}=goldCredentials(env,{role});
  let pool,redis;
  try{
    pool=poolFactory?poolFactory(urls.pg):new Pool({
      connectionString:urls.pg,max:10,connectionTimeoutMillis:4000,
      idleTimeoutMillis:15000,allowExitOnIdle:true,
    });
    const postgres=await verifyGoldSchema(pool);
    redis=redisFactory?redisFactory(urls.redis):createClient({url:urls.redis,
      socket:{connectTimeout:4000,reconnectStrategy:false}});
    if(typeof redis.connect==='function'&&!redis.isOpen)await redis.connect();
    const cache=await verifyGoldRedis(redis,{instance});
    return {pool,redis,postgres,cache,async close(){
      await Promise.allSettled([redis.quit?.(),pool.end?.()]);
    }};
  }catch(error){
    await Promise.allSettled([redis?.disconnect?.(),pool?.end?.()]);
    throw Error('gold_data_plane_not_ready',{cause:error});
  }
}
