// Explicitly opt-in CI harness. It never connects to a live Gold database and
// refuses to replace or drop a database that already exists.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
assert.equal(process.env.LR_EPOCH_PG_TEST_ALLOW,'1','disposable PG test opt-in required');
const db='lr_gold_epoch_fixture_20261029';
const isolatedHttp=process.env.LR_P2B_HTTP_ONLY==='1';
if(isolatedHttp){
 assert.equal(os.hostname(),'gold-p2a-runtime-rollback-20261030','clone hostname required');
 assert.deepEqual(await fs.readdir('/sys/class/net'),['lo'],'no physical/network NIC allowed');
 const route=await fs.readFile('/proc/net/route','utf8');
 assert.ok(!route.split('\n').some(row=>/\s00000000\s/.test(row)),'default route denied');
 console.log('P2B_PHYSICALLY_ISOLATED_CLONE_HTTP_ONLY=PASS');
}
const admin=new pg.Pool({database:'postgres',max:2});
let created=false;
const sqlRoot=fileURLToPath(new URL('../../platform-v2/sql/',import.meta.url));
const run=(script,timeoutMs=60000,overrides={})=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL(script,import.meta.url))],{
    env:{...process.env,...overrides,LR_GOLD_EPOCH_TEST_DB:db},stdio:'inherit',timeout:timeoutMs});
  if(result.error||result.status!==0)throw Error('epoch_pg_suite_failed:'+script+':'+String(result.error?.message||result.status));
};
try{
  const found=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db]);
  assert.equal(found.rowCount,0,'fixture database already exists; refusing to overwrite');
  await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lr_gold_app')
    THEN CREATE ROLE lr_gold_app NOLOGIN; END IF; END $$;`);
  await admin.query('CREATE DATABASE '+db);
  created=true;
  const pool=new pg.Pool({database:db,max:3});
  try{
    await pool.query(`CREATE TABLE lr_device_connections (
      connection_id TEXT PRIMARY KEY,account_id TEXT,device_id TEXT,connected_at TIMESTAMPTZ NOT NULL,
      closed_at TIMESTAMPTZ,hard_expires_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE lr_devices(device_id TEXT PRIMARY KEY,state TEXT,last_seen_at TIMESTAMPTZ);
      CREATE TABLE lr_gold_job_records(job_id TEXT PRIMARY KEY,account_id TEXT,device_id TEXT,status TEXT,
        finished_at TIMESTAMPTZ,exit_code INTEGER,public_view JSONB,updated_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE lr_gold_personal_agent_work(job_id TEXT PRIMARY KEY,account_id TEXT,device_id TEXT,
        state TEXT,finished_at TIMESTAMPTZ,queue_reason TEXT,disposition TEXT,resource_key TEXT,resource_mode TEXT);
      CREATE TABLE lr_gold_device_resource_claims(job_id TEXT PRIMARY KEY,account_id TEXT,device_id TEXT,
        resource_key TEXT,resource_mode TEXT,worker_state TEXT,process_id TEXT,claimed_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE lr_gold_terminal_receipt_acks(account_id TEXT NOT NULL,device_id TEXT NOT NULL,job_id TEXT NOT NULL,
        process_id TEXT NOT NULL,terminal_state TEXT NOT NULL,finished_at_ms BIGINT NOT NULL,
        PRIMARY KEY(account_id,device_id,process_id));
      CREATE TABLE lr_audit_events(event_id TEXT PRIMARY KEY,actor_account_id TEXT,owner_account_id TEXT,
        kind TEXT,resource_type TEXT,resource_id TEXT,metadata JSONB);
      CREATE TABLE lr_site_announcements(announcement_id TEXT PRIMARY KEY,
        audience TEXT NOT NULL CHECK (audience IN ('site','clients','both')));
      INSERT INTO lr_devices VALUES('dev-epoch-fixture','online',now());
      INSERT INTO lr_device_connections VALUES('dc_epoch_fixture_1','acct-epoch-fixture',
        'dev-epoch-fixture',now(),NULL,now()+interval '12 hours');`);
    for(const version of ['040_gold_connection_job_gc_fences.sql','041_gold_device_execution_epoch.sql','042_gold_wall_announcements_channel.sql'])
      await pool.query(await fs.readFile(path.join(sqlRoot,version),'utf8'));
    const schema042=await pool.query("SELECT pg_get_constraintdef(oid) AS rule FROM pg_constraint WHERE conname='lr_site_announcements_audience_check'");
    assert.equal(schema042.rowCount,1,'schema042 audience constraint required');
    assert.ok(schema042.rows[0].rule.includes('wall'),'schema042 wall audience required');
    console.log('GOLD_P2B_FIXTURE_SQL040_041_042=PASS');
  }finally{await pool.end();}
  if(isolatedHttp){
    run('./selftest-gold-signed-http-duplex-pg.mjs');
    console.log('P2B_REAL_LOOPBACK_SIGNED_HTTP_PG042_FIXTURE=PASS');
  }else{
  run('./selftest-gold-execution-epoch-pg.mjs');
  run('./selftest-gold-gc-epoch-race-pg.mjs');
  run('./selftest-gold-gc-boundary-pg.mjs');
  run('./selftest-gold-p1-stale-claim-pg.mjs');
  run('./selftest-gold-p1-stale-monitor-pg.mjs');
  run('./selftest-gold-p1-terminal-replay-pg.mjs');
  run('./selftest-gold-signed-http-duplex-pg.mjs');
  run('./selftest-gold-real-agent-daemon-pg.mjs');
  // Last, execute P1-E on disposable 1k/10k synthetic device population.
  // No live endpoints, real clients, external sockets or production DB.
  run('./selftest-gold-p1-e-load-chaos-pg.mjs',600000,
    {LR_P1E_LOAD_ALLOW:'1',LR_P1E_TARGET:process.env.LR_P1E_TARGET||'10000'});
  console.log('GOLD_EPOCH_REAL_PG_TWO_OPERATOR_GC_RECONNECT_RACE=PASS');
  }
}finally{
  if(created){
    try{await admin.query('DROP DATABASE '+db+' WITH (FORCE)');}
    catch(error){console.error('DISPOSABLE_DB_CLEANUP_FAILED:'+String(error.message));throw error;}
  }
  await admin.end();
}
