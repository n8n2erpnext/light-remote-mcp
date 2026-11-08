// P2-I1: real PostgreSQL, STRICT no-NIC LXD clone only, disposable DB.
// No Gold UAT schema or historical rows are touched.
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {ensureGoldDeviceShortId,backfillGoldDeviceShortIds,
 listOwnerShortIdDevices,resolvePermittedDeviceTarget,SHORT_ID_RE}
 from '../../lib/gold-device-short-id.mjs';
assert.equal(process.env.LR_GOLD_P2I1_PG_TEST_ALLOW,'1','explicit fixture approval');
assert.equal(os.hostname(),'gold-p2a-runtime-rollback-20261030','must use isolated LXD clone');
assert.deepEqual(await fs.readdir('/sys/class/net'),['lo'],'no NIC');
const routes=await fs.readFile('/proc/net/route','utf8');
assert.ok(!routes.split('\n').some(x=>/\s00000000\s/.test(x)),'default route forbidden');
const db='lr_gold_p2i1_shortid_fixture_20261030';
const admin=new pg.Pool({database:'postgres',max:1});
let created=false;
try{
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[db])).rows[0].n,0,
   'refuse existing fixture DB');
 await admin.query('CREATE DATABASE '+db);created=true;
 const pool=new pg.Pool({database:db,max:10});
 try{
  await pool.query(`CREATE TABLE lr_accounts(account_id TEXT PRIMARY KEY);
   CREATE TABLE lr_devices(device_id TEXT PRIMARY KEY,
    owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
    node_id TEXT,display_name TEXT,platform TEXT,state TEXT NOT NULL DEFAULT 'online');
   INSERT INTO lr_accounts VALUES('owner-a'),('owner-b');
   INSERT INTO lr_devices(device_id,owner_account_id,node_id,display_name,platform)
    VALUES('dev1','owner-a','node1','Main Windows','windows'),
          ('dev2','owner-a','node2','Secondary Windows','windows'),
          ('dev3','owner-b','node3','Private Device','linux');`);
  const migration=fileURLToPath(new URL('../../platform-v2/sql/043_gold_device_short_ids.sql',import.meta.url));
  await pool.query(await fs.readFile(migration,'utf8'));
  const a=await ensureGoldDeviceShortId(pool,{deviceId:'dev1'});
  assert.match(a,SHORT_ID_RE);
  const concurrent=await Promise.all(Array.from({length:12},
   ()=>ensureGoldDeviceShortId(pool,{deviceId:'dev1'})));
  assert.ok(concurrent.every(x=>x===a),'concurrent allocation must be idempotent');
  const n=await pool.query('SELECT count(*)::int AS n FROM lr_gold_device_short_ids WHERE device_id=$1',['dev1']);
  assert.equal(n.rows[0].n,1);
  const fixture=await backfillGoldDeviceShortIds(pool,{batchSize:2});
  assert.equal(fixture.created,2);
  assert.equal((await backfillGoldDeviceShortIds(pool)).created,0,'repeat no-op');
  const ownerA=await listOwnerShortIdDevices(pool,{accountId:'owner-a'});
  assert.equal(ownerA.length,2);
  assert.equal(ownerA.some(x=>x.deviceId==='dev3'),false,'cross-owner leak');
  const ownerB=await listOwnerShortIdDevices(pool,{accountId:'owner-b'});
  assert.equal(ownerB.length,1);
  assert.equal(resolvePermittedDeviceTarget({permittedDevices:ownerA,query:'Windows'}).total,2);
  assert.equal(resolvePermittedDeviceTarget({permittedDevices:ownerA,query:ownerB[0].shortId}).status,'not_found');
  const other=(await pool.query('SELECT short_id FROM lr_gold_device_short_ids WHERE device_id=$1',['dev2'])).rows[0].short_id;
  assert.notEqual(a,other);
  await assert.rejects(()=>pool.query('UPDATE lr_gold_device_short_ids SET short_id=$1 WHERE device_id=$2',
    ['222222','dev1']),/gold_device_short_id_immutable/);
  await assert.rejects(()=>pool.query('UPDATE lr_gold_device_short_ids SET device_id=$1 WHERE device_id=$2',
    ['dev2','dev1']),/gold_device_short_id_immutable/);
  await pool.query("UPDATE lr_devices SET display_name='Renamed',node_id='changed' WHERE device_id='dev1'");
  assert.equal(await ensureGoldDeviceShortId(pool,{deviceId:'dev1'}),a);
  // Device deletion retires the public code; reusing that ID is forbidden.
  await pool.query("DELETE FROM lr_devices WHERE device_id='dev1'");
  assert.equal((await pool.query('SELECT device_id FROM lr_gold_device_short_ids WHERE short_id=$1',[a])).rows[0].device_id,null);
  await pool.query("INSERT INTO lr_devices(device_id,owner_account_id,node_id,display_name,platform) VALUES('dev1','owner-a','node-new','New enrollment','linux')");
  const newId=await ensureGoldDeviceShortId(pool,{deviceId:'dev1'});
  assert.notEqual(newId,a);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM lr_gold_device_short_ids WHERE short_id=$1',[a])).rows[0].n,1);
  await assert.rejects(()=>ensureGoldDeviceShortId(pool,{deviceId:'missing'}),/gold_short_id_device_unavailable/);
  console.log('P2I1_PG043_REAL_UNIQUE_CONCURRENT_ALLOCATION_AND_TOMBSTONE=PASS');
  console.log('P2I1_OWNER_SCOPED_DISCOVERY_AND_RENAME_STABILITY=PASS');
  console.log('P2I1_NO_NIC_CLONE_POSTGRES_FIXTURE=PASS');
 }finally{await pool.end();}
}finally{
 if(created)await admin.query('DROP DATABASE '+db); // refuse to terminate leaked fixture clients
 await admin.end();
}
