// P2-I2h2d: exact live-Gold schema constraints from the NO-NIC CLONE only.
// pg_dump SCHEMA ONLY from clone PG039 to a brand-new disposable DB.
// Never copy customer rows, never migrate or write to Gold UAT/production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
import {GoldNativeAB} from '../../lib/gold-native-ab.mjs';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
const env=process.env;
assert.equal(env.LR_P2I2_FULL_SCHEMA_TEST_ALLOW,'1','explicit fixture opt-in');
assert.equal(os.hostname(),'gold-p2a-runtime-rollback-20261030','no-NIC clone only');
assert.deepEqual(fs.readdirSync('/sys/class/net'),['lo'],'NO NIC');
assert.ok(!fs.readFileSync('/proc/net/route','utf8').split('\n')
 .some(line=>/\s00000000\s/.test(line)),'NO default route');
const db='lr_gold_p2i2_full_schema_fixture_20261030';
const temp=fs.mkdtempSync('/tmp/lr_p2i2_fullschema_');
fs.chmodSync(temp,0o700);
const archive=path.join(temp,'structure.dump');
const keyFile=path.join(temp,'ab.key');
fs.writeFileSync(keyFile,crypto.randomBytes(32),{mode:0o600});
const oldRoot=env.LIGHT_REMOTE_GOLD_ROOT,oldKey=env.LR_GOLD_AB_KEY_FILE;
env.LIGHT_REMOTE_GOLD_ROOT=temp;env.LR_GOLD_AB_KEY_FILE=keyFile;
function exec(bin,args){
 const done=spawnSync(bin,args,{encoding:'utf8',timeout:90000,
  env:{...process.env,PGHOST:'/var/run/postgresql'},maxBuffer:16*1024*1024});
 if(done.error||done.status!==0)
  throw Error('p2i2_disposable_schema_command_failed:'+bin+':'+String(done.stderr).slice(0,450));
}
const admin=new pg.Pool({database:'postgres',host:'/var/run/postgresql',max:1});
let created=false;
try{
 assert.equal((await admin.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[db])).rows[0].n,0,
  'never overwrite an existing database');
 // Read only the clone's original schema (PG039). No source-table writes.
 const current=await admin.query("SELECT count(*)::int n FROM pg_database WHERE datname='light_remote_gold_dev'");
 assert.equal(current.rows[0].n,1);
 exec('pg_dump',['-Fc','--schema-only','--no-owner','--no-acl','-d','light_remote_gold_dev','-f',archive]);
 assert.ok(fs.statSync(archive).size>4096);
 await admin.query('CREATE DATABASE '+db);created=true;
 exec('pg_restore',['--no-owner','--no-acl','--exit-on-error','-d',db,archive]);
 const pool=new pg.Pool({database:db,host:'/var/run/postgresql',max:4});
 try{
  const check=await pool.query("SELECT count(*)::int n FROM pg_constraint WHERE conrelid='lr_ab_grants'::regclass AND contype IN ('f','c')");
  assert.ok(check.rows[0].n>=3,'must inherit actual native AB FK and CHECK constraints');
  const schemas=await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'");
  assert.ok(schemas.rows[0].n>=25,'full schema snapshot was not restored');
  await pool.query(`INSERT INTO lr_accounts(account_id,email,plan,status)
    VALUES('fixture-owner','fixture-owner@example.invalid','vip','active'),
          ('fixture-other','fixture-other@example.invalid','free','active');
   INSERT INTO lr_devices(device_id,owner_account_id,state)
    VALUES('fixture-device','fixture-owner','online'),
          ('fixture-other-device','fixture-other','online');
   INSERT INTO lr_device_connections(connection_id,device_id,account_id,plan,
    hard_expires_at,reconnect_grace_ms)
    VALUES('fixture-connection','fixture-device','fixture-owner','vip',
      clock_timestamp()+interval '2 days',900000),
      ('fixture-other-connection','fixture-other-device','fixture-other','free',
      clock_timestamp()+interval '2 days',900000);`);
  let now=Date.now();
  const native=await GoldNativeAB.open({pool});
  const store=new GoldRegistryPersistence({pool});
  store.native={ab:native};
  const registry=new DeviceAccessGrantRegistry({now:()=>now});
  store.mount('access_grants',registry);await store.flush();
  const req=(letter,agent='agent-A')=>({
   requestId:'av2_'+letter.repeat(32),ownerAccountId:'fixture-owner',
   agentId:agent,deviceId:'fixture-device',connectionId:'fixture-connection',
   verifiedAt:now,connectionExpiresAt:now+86_400_000*2,label:agent
  });
  const a=registry.approveVerifiedV2(req('a'));
  assert.throws(()=>registry.assert(a.grantId,{touch:false}),/device_access_grant_required/);
  await store.flush();
  const staged=await pool.query(`SELECT g.*,m.close_reason FROM lr_ab_grants g
    JOIN lr_gold_ab_grant_metadata m USING(grant_id) WHERE g.grant_id=$1`,[a.grantId]);
  assert.equal(staged.rowCount,1);
  assert.ok(staged.rows[0].closed_at);
  assert.equal(staged.rows[0].close_reason,'abv2_uncommitted');
  assert.equal(new Date(staged.rows[0].absolute_expires_at).getTime(),a.approvedAt+86400000);
  const afterStage=await GoldNativeAB.open({pool});
  const loadedStage=new DeviceAccessGrantRegistry({now:()=>now});
  loadedStage.grants=new Map(afterStage.mount().grants);
  assert.throws(()=>loadedStage.assert(a.grantId,{touch:false}),/device_access_grant_required/,
    'real PG snapshot restart must not activate a staged B grant');
  registry.activateVerifiedV2(a.grantId);
  assert.throws(()=>registry.assert(a.grantId,{touch:false}),/device_access_grant_required/);
  await store.flush();
  assert.equal((await pool.query('SELECT closed_at FROM lr_ab_grants WHERE grant_id=$1',[a.grantId])).rows[0].closed_at,null);
  registry.finalizeVerifiedV2(a.grantId);
  await store.flush();
  assert.equal(registry.assert(a.grantId,{touch:false}).grantId,a.grantId);
  const reload=await GoldNativeAB.open({pool});
  const fresh=new DeviceAccessGrantRegistry({now:()=>now});
  fresh.grants=new Map(reload.mount().grants);
  assert.equal(fresh.assert(a.grantId,{touch:false}).grantId,a.grantId);
  assert.equal(fresh.approveVerifiedV2(req('a')).reused,true);
  // Native FK must reject wrong device for the same connection.
  const bad='dag_v2_'+'f'.repeat(32);
  await assert.rejects(()=>pool.query(`INSERT INTO lr_ab_grants(grant_id,account_id,
   device_id,connection_id,agent_id,purpose,approved_at,last_activity_at,
   idle_grace_ms,expires_at,absolute_expires_at,closed_at)
   VALUES($1,'fixture-owner','fixture-other-device','fixture-connection',
   'agent-f','device',now(),now(),86400000,now()+interval '1 hour',
   now()+interval '24 hours',now())`,[bad]),e=>e.code==='23503');
  // Native CHECK must reject a grant longer than 24h.
  await assert.rejects(()=>pool.query(`INSERT INTO lr_ab_grants(grant_id,account_id,
   device_id,connection_id,agent_id,purpose,approved_at,last_activity_at,
   idle_grace_ms,expires_at,absolute_expires_at,closed_at)
   VALUES($1,'fixture-owner','fixture-device','fixture-connection',
   'agent-f','device',now(),now(),86400000,now()+interval '1 hour',
   now()+interval '25 hours',now())`,[bad]),e=>e.code==='23514');
  now+=1500;
  const b=registry.approveVerifiedV2(req('b','agent-B'));
  await store.flush();
  const bStage=await GoldNativeAB.open({pool});
  const bRow=new Map(bStage.mount().grants).get(b.grantId);
  assert.equal(bRow.closeReason,'abv2_uncommitted');
  assert.equal(registry.assert(a.grantId,{touch:false}).grantId,a.grantId);
  registry.activateVerifiedV2(b.grantId);await store.flush();
  registry.finalizeVerifiedV2(b.grantId);await store.flush();
  assert.equal(registry.activeGrantsForDevice('fixture-device','fixture-connection').length,2);
  assert.equal(registry.assert(a.grantId,{touch:false}).grantId,a.grantId);
  console.log('GOLD_ABV2_FULL_SCHEMA_NATIVE_PG_FK_CHECK_STAGED_RESTART=PASS');
  console.log('GOLD_ABV2_FULL_SCHEMA_PER_AGENT_TWO_PHASE_24H=PASS');
 }finally{await pool.end();}
}finally{
 try{if(created)await admin.query('DROP DATABASE '+db);}finally{await admin.end();}
 fs.rmSync(temp,{recursive:true,force:true});
 if(oldRoot===undefined)delete env.LIGHT_REMOTE_GOLD_ROOT;else env.LIGHT_REMOTE_GOLD_ROOT=oldRoot;
 if(oldKey===undefined)delete env.LR_GOLD_AB_KEY_FILE;else env.LR_GOLD_AB_KEY_FILE=oldKey;
}
