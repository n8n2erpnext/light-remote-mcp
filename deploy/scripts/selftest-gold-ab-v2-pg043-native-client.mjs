// P2-I2h2e-C2: actual clone PG039 schema-only + candidate PG043, Native AB
// + Native AgentClients, owner-scoped Short ID, restart+reapproval. NO-NIC only.
// Never applies 043 to the source clone database, Gold UAT or production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
import {GoldNativeAB} from '../../lib/gold-native-ab.mjs';
import {GoldNativeAgentClients} from '../../lib/gold-native-agent-clients.mjs';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {AgentClientRegistry} from '../../operator-host/agent-client-registry.mjs';
import {ensureGoldDeviceShortId,listOwnerShortIdDevices} from '../../lib/gold-device-short-id.mjs';
assert.equal(process.env.LR_P2I2_PG043_NATIVE_TEST_ALLOW,'1');
assert.equal(os.hostname(),'gold-p2a-runtime-rollback-20261030');
assert.deepEqual(fs.readdirSync('/sys/class/net'),['lo']);
assert.ok(!fs.readFileSync('/proc/net/route','utf8').split('\n').some(line=>/\s00000000\s/.test(line)));
const db='lr_gold_p2i2_pg043_native_fixture_20261030';
const tmp=fs.mkdtempSync('/tmp/lr_pg043_native_');fs.chmodSync(tmp,0o700);
const archive=path.join(tmp,'schema.dump');
const keyFile=path.join(tmp,'ab.key');
fs.writeFileSync(keyFile,crypto.randomBytes(32),{mode:0o600});
const previousRoot=process.env.LIGHT_REMOTE_GOLD_ROOT;
const previousKey=process.env.LR_GOLD_AB_KEY_FILE;
process.env.LIGHT_REMOTE_GOLD_ROOT=tmp;
process.env.LR_GOLD_AB_KEY_FILE=keyFile;
const pgenv={...process.env,PGHOST:'/var/run/postgresql'};
function cmd(bin,args){
 const result=spawnSync(bin,args,{env:pgenv,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024});
 if(result.status!==0||result.error)throw Error('isolated_pg_command_failed:'+bin+':'+String(result.stderr||result.error).slice(0,450));
}
const admin=new pg.Pool({host:'/var/run/postgresql',database:'postgres',max:1});
let created=false;
try{
 const prior=await admin.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[db]);
 assert.equal(prior.rows[0].n,0,'never overwrite existing test database');
 const base=await admin.query("SELECT count(*)::int n FROM pg_database WHERE datname='light_remote_gold_dev'");
 assert.equal(base.rows[0].n,1);
 cmd('pg_dump',['-Fc','--schema-only','--no-owner','--no-acl','-d','light_remote_gold_dev','-f',archive]);
 assert.ok(fs.statSync(archive).size>4096);
 await admin.query('CREATE DATABASE '+db);created=true;
 cmd('pg_restore',['--no-owner','--no-acl','--exit-on-error','-d',db,archive]);
 const pool=new pg.Pool({database:db,host:'/var/run/postgresql',max:8});
 try{
  const migration=fs.readFileSync(fileURLToPath(new URL('../../platform-v2/sql/043_gold_device_short_ids.sql',import.meta.url)),'utf8');
  await pool.query(migration);
  const count=await pool.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='lr_gold_device_short_ids' AND column_name='owner_account_id'");
  assert.equal(count.rows[0].n,0,'PG043 has no owner_account_id column; lookup MUST JOIN canonical device owner');
  await pool.query(`INSERT INTO lr_accounts(account_id,email,plan,status)
   VALUES('fixture-owner','fixture-owner@example.invalid','vip','active'),
   ('fixture-other','fixture-other@example.invalid','free','active');
   INSERT INTO lr_devices(device_id,owner_account_id,state)
   VALUES('fixture-device','fixture-owner','online'),
          ('fixture-other-device','fixture-other','online');
   INSERT INTO lr_device_connections(connection_id,device_id,account_id,plan,hard_expires_at,reconnect_grace_ms)
   VALUES('fixture-connection','fixture-device','fixture-owner','vip',clock_timestamp()+interval '2 days',900000),
          ('fixture-other-connection','fixture-other-device','fixture-other','free',clock_timestamp()+interval '2 days',900000);`);
  const short=await ensureGoldDeviceShortId(pool,{deviceId:'fixture-device'});
  const foreign=await ensureGoldDeviceShortId(pool,{deviceId:'fixture-other-device'});
  const query='SELECT s.short_id FROM lr_gold_device_short_ids s JOIN lr_devices d ON d.device_id=s.device_id WHERE d.owner_account_id=$1 AND s.device_id=$2';
  assert.equal((await pool.query(query,['fixture-owner','fixture-device'])).rows[0].short_id,short);
  assert.equal((await pool.query(query,['fixture-other','fixture-device'])).rowCount,0);
  assert.equal((await pool.query(query,['fixture-owner','fixture-other-device'])).rowCount,0);
  assert.equal((await listOwnerShortIdDevices(pool,{accountId:'fixture-owner'})).length,1);
  const ab=await GoldNativeAB.open({pool});
  const nativeClients=await GoldNativeAgentClients.open({pool});
  const store=new GoldRegistryPersistence({pool});
  store.native={ab,agentClients:nativeClients};
  store.loaded={agent_clients:{schemaVersion:1,rows:nativeClients.rows}};
  let now=Date.now();
  const grants=new DeviceAccessGrantRegistry({now:()=>now});
  const clients=new AgentClientRegistry({now:()=>now});
  store.mount('access_grants',grants);
  store.mount('agent_clients',clients);
  await store.flush();
  const request=(letter,agent)=>({requestId:'av2_'+letter.repeat(32),
   ownerAccountId:'fixture-owner',agentId:agent,deviceId:'fixture-device',
   connectionId:'fixture-connection',verifiedAt:now,
   connectionExpiresAt:now+2*86400000,label:agent});
  const a=grants.approveVerifiedV2(request('a','agent-a'));
  await store.flush();
  assert.throws(()=>grants.assert(a.grantId,{touch:false}),/device_access_grant_required/);
  let snapshot=await GoldNativeAB.open({pool});
  assert.equal(new Map(snapshot.mount().grants).get(a.grantId).closeReason,'abv2_uncommitted');
  grants.activateVerifiedV2(a.grantId);await store.flush();
  grants.finalizeVerifiedV2(a.grantId);await store.flush();
  const authorized=grants.assert(a.grantId,{touch:false});
  const attached=clients.attach({accountId:'fixture-owner',agentId:'agent-a',
   grant:authorized,pairingRequestId:request('a','agent-a').requestId});
  await store.flush();
  const native=await GoldNativeAgentClients.open({pool});
  const row=new Map(native.rows).get(attached.clientSessionId);
  assert.equal(row.agentId,'agent-a');assert.equal(row.accountId,'fixture-owner');
  assert.equal(row.bindings['fixture-device'].grantId,a.grantId);
  assert.equal(row.bindings['fixture-device'].connectionId,'fixture-connection');
  assert.equal(row.bindings['fixture-device'].pairingRequestId,'av2_'+'a'.repeat(32));
  const b=grants.approveVerifiedV2(request('b','agent-b'));
  await store.flush();
  grants.activateVerifiedV2(b.grantId);await store.flush();
  grants.finalizeVerifiedV2(b.grantId);await store.flush();
  clients.attach({accountId:'fixture-owner',agentId:'agent-b',
   grant:grants.assert(b.grantId,{touch:false}),pairingRequestId:'av2_'+'b'.repeat(32)});
  await store.flush();
  snapshot=await GoldNativeAB.open({pool});
  const restored=new DeviceAccessGrantRegistry({now:()=>now});
  restored.grants=new Map(snapshot.mount().grants);
  assert.equal(restored.activeGrantsForDevice('fixture-device','fixture-connection').length,2);
  const restoredClients=await GoldNativeAgentClients.open({pool});
  assert.equal(restoredClients.rows.length,2);
  const again=grants.approveVerifiedV2(request('a','agent-a'));
  assert.equal(again.reused,true);
  const repeated=clients.attach({accountId:'fixture-owner',agentId:'agent-a',
   grant:grants.assert(a.grantId,{touch:false}),pairingRequestId:'av2_'+'a'.repeat(32)});
  assert.equal(repeated.clientSessionId,attached.clientSessionId);
  assert.equal(grants.assert(a.grantId,{touch:false}).absoluteExpiresAt,a.absoluteExpiresAt);
  await store.flush();
  await assert.rejects(pool.query('UPDATE lr_gold_device_short_ids SET short_id=$1 WHERE device_id=$2',
    ['000000','fixture-device']),e=>e.code==='23514');
  assert.notEqual(short,foreign);
  console.log('GOLD_ABV2_PG039_PLUS_PG043_REAL_SCHEMA_OWNER_SHORT_ID=PASS');
  console.log('GOLD_ABV2_PG043_NATIVE_GRANT_CLIENT_BINDING_RESTART_TWO_AGENTS=PASS');
 }finally{await pool.end()}
}finally{
 try{if(created)await admin.query('DROP DATABASE '+db)}finally{await admin.end()}
 if(previousRoot===undefined)delete process.env.LIGHT_REMOTE_GOLD_ROOT;
 else process.env.LIGHT_REMOTE_GOLD_ROOT=previousRoot;
 if(previousKey===undefined)delete process.env.LR_GOLD_AB_KEY_FILE;
 else process.env.LR_GOLD_AB_KEY_FILE=previousKey;
 fs.rmSync(tmp,{recursive:true,force:true});
}
