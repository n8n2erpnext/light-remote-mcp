// P2-I2h2c real PostgreSQL native A/B writer; only no-NIC disposable LXD DB.
// NO real Gold runtime tables, deployments, or historical records are mutated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import pg from 'pg';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
import {GoldNativeAB} from '../../lib/gold-native-ab.mjs';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';

assert.equal(process.env.LR_P2I2_NATIVE_PG_TEST_ALLOW,'1');
assert.equal(os.hostname(),'gold-p2a-runtime-rollback-20261030');
assert.deepEqual(fs.readdirSync('/sys/class/net'),['lo']);
assert.equal(fs.readFileSync('/proc/net/route','utf8').split('\n')
 .some(x=>/\s00000000\s/.test(x)),false);
const db='lr_gold_p2i2_grant_fixture_20261030';
const admin=new pg.Pool({database:'postgres',max:1});
let created=false;
const secret='/tmp/lr_p2i2_native_pg_credential_'+crypto.randomBytes(5).toString('hex');
fs.writeFileSync(secret,crypto.randomBytes(32),{mode:0o600});
process.env.LIGHT_REMOTE_GOLD_ROOT='/tmp';
process.env.LR_GOLD_AB_KEY_FILE=secret;
try{
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[db])).rows[0].n,0);
 await admin.query('CREATE DATABASE '+db);created=true;
 const pool=new pg.Pool({database:db,max:3});
 try{
  // Native A/B contract tables in a throwaway DB; no foreign accounts/devices.
  await pool.query(`CREATE TABLE lr_ab_requests (
   request_id text PRIMARY KEY, account_id text, device_id text,connection_id text,
   agent_id text,purpose text,poll_sha256 text,display_code_ciphertext bytea,
   state text,created_at timestamptz,expires_at timestamptz,consumed_at timestamptz);
  CREATE TABLE lr_gold_ab_request_metadata (
   request_id text PRIMARY KEY,label text,pairing_required boolean,pairing_id text,
   denied_ms bigint,deny_reason text);
  CREATE TABLE lr_ab_grants (
   grant_id text PRIMARY KEY,account_id text,device_id text,connection_id text,
   agent_id text,purpose text,approved_at timestamptz,last_activity_at timestamptz,
   idle_grace_ms bigint,expires_at timestamptz,absolute_expires_at timestamptz,
   closed_at timestamptz);
  CREATE TABLE lr_gold_ab_grant_metadata (
   grant_id text PRIMARY KEY,close_reason text);`);
  let now=Date.now(),blocked=false;
  const native=await GoldNativeAB.open({pool});
  const persisted=new GoldRegistryPersistence({pool});
  persisted.native={ab:native};
  const registry=new DeviceAccessGrantRegistry({now:()=>now});
  persisted.mount('access_grants',registry);
  await persisted.flush();
  const oldNativeWrite=native.write.bind(native);
  let releaseWrite,writeStarted;
  const blockedWrite=new Promise(resolve=>{releaseWrite=resolve});
  const started=new Promise(resolve=>{writeStarted=resolve});
  native.write=async data=>{
   blocked=true;writeStarted();
   await blockedWrite;
   return oldNativeWrite(data);
  };
  const p={
   requestId:'av2_'+'a'.repeat(32),ownerAccountId:'fixture-owner',
   deviceId:'fixture-device',connectionId:'fixture-connection',
   agentId:'fixture-agent-A',connectionExpiresAt:now+86400000*2,
   verifiedAt:now,label:'Agent A'
  };
  const a=registry.approveVerifiedV2(p);
  const flushPromise=persisted.flush();
  await started;
  const before=await pool.query('SELECT count(*)::int AS n FROM lr_ab_grants');
  assert.equal(before.rows[0].n,0,'PG write must still be queued');
  const visibleBefore=registry.activeGrantsForDevice(p.deviceId,p.connectionId);
  // SOURCE SECURITY GATE: a pending DB write MUST NOT authorize an Agent.
  const prematurelyVisible=visibleBefore.some(x=>x.grantId===a.grantId);
  releaseWrite();
  await flushPromise;
  assert.equal(prematurelyVisible,false,
   'PRE_DURABILITY_GRANT_VISIBLE: fix before enabling V2');
  native.write=oldNativeWrite;
  const rows=await pool.query('SELECT * FROM lr_ab_grants WHERE grant_id=$1',[a.grantId]);
  assert.equal(rows.rowCount,1);
  assert.equal(new Date(rows.rows[0].approved_at).getTime(),p.verifiedAt);
  assert.equal(new Date(rows.rows[0].absolute_expires_at).getTime(),p.verifiedAt+86400000);
  assert(rows.rows[0].closed_at,'staged V2 grant must persist closed');
  assert.throws(()=>registry.assert(a.grantId,{touch:false}),/device_access_grant_required/);
  // Simulate Redis granted after confirmed stage write.
  registry.activateVerifiedV2(a.grantId);
  assert.throws(()=>registry.assert(a.grantId,{touch:false}),/device_access_grant_required/);
  await persisted.flush();
  const active=await pool.query('SELECT closed_at FROM lr_ab_grants WHERE grant_id=$1',[a.grantId]);
  assert.equal(active.rows[0].closed_at,null);
  registry.finalizeVerifiedV2(a.grantId);
  await persisted.flush();
  assert.equal(registry.assert(a.grantId,{touch:false}).grantId,a.grantId);
  const reloaded=await GoldNativeAB.open({pool});
  const clone=new DeviceAccessGrantRegistry({now:()=>now});
  const state=reloaded.mount();
  clone.grants=new Map(state.grants);
  assert.equal(clone.assert(a.grantId,{touch:false}).grantId,a.grantId);
  console.log('GOLD_ABV2_REAL_NATIVE_PG_GRANT_FLUSH_READBACK_RESTART=PASS');
 }finally{await pool.end();}
}finally{
 if(created)await admin.query('DROP DATABASE '+db);
 await admin.end();
 fs.rmSync(secret,{force:true});
}
