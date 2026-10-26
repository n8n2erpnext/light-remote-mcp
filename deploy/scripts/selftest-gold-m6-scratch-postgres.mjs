#!/usr/bin/env node
// Live PostgreSQL integration fixture only. MUST connect to a disposable,
// standalone local-only cluster with an explicit scratch database name.
// Never use the Gold UAT application's database, even in development.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';

const socket=process.env.GOLD_PR4_SCRATCH_SOCKET;
const name=process.env.GOLD_PR4_SCRATCH_DATABASE;
assert(socket?.startsWith('/tmp/gold-pr4-pg-') && /^gold_pr4_scratch_[a-z0-9_]+$/.test(name||''),
 'EXPLICIT_ISOLATED_POSTGRES_SOCKET_AND_DB_REQUIRED');
assert(process.env.PGHOST===undefined && process.env.DATABASE_URL===undefined,
 'SHARED_PG_ENV_FORBIDDEN');
const pool=new pg.Pool({host:socket,port:Number(process.env.GOLD_PR4_SCRATCH_PORT||55998),
  user:'postgres',database:name,max:3,connectionTimeoutMillis:3500});
const locks=new GoldDeviceResourceLocks(), accountId='acct_scratch_owner';
const deviceId='dev_scratch_removed_windows',jobId=crypto.randomUUID();
const proc='lp_'+('x'.repeat(26)),boot=Date.parse('2026-10-23T02:22:26Z');
const claimTime='2026-10-22T07:59:43.563Z';
const query=(sql,args)=>pool.query(sql,args);
async function counts(){
 const a=await query('SELECT COUNT(*)::int AS n FROM lr_gold_device_resource_claims');
 const b=await query('SELECT COUNT(*)::int AS n FROM lr_audit_events');
 const c=await query('SELECT COUNT(*)::int AS n FROM lr_gold_terminal_receipt_acks');
 return [a.rows[0].n,b.rows[0].n,c.rows[0].n];
}
async function createFixture(){
 await query(`CREATE TABLE lr_devices(
   device_id text PRIMARY KEY,account_id text NOT NULL,node_id text NOT NULL,
   state text NOT NULL,policy_profile text NOT NULL);
 CREATE TABLE lr_gold_job_records(
   job_id text PRIMARY KEY,account_id text NOT NULL,device_id text NOT NULL,status text NOT NULL);
 CREATE TABLE lr_gold_device_resource_claims(
   job_id text PRIMARY KEY,account_id text NOT NULL,device_id text NOT NULL,
   process_id text,worker_state text NOT NULL,claimed_at timestamptz NOT NULL);
 CREATE TABLE lr_gold_terminal_receipt_acks(
   account_id text NOT NULL,device_id text NOT NULL,
   process_id text NOT NULL,job_id text NOT NULL,
   terminal_state text NOT NULL,finished_at_ms bigint NOT NULL,
   PRIMARY KEY(account_id,device_id,process_id));
 CREATE TABLE lr_audit_events(
   event_id text PRIMARY KEY,actor_account_id text NOT NULL,
   owner_account_id text NOT NULL,kind text NOT NULL,
   resource_type text NOT NULL,resource_id text NOT NULL,
   metadata jsonb NOT NULL);`);
 await query('INSERT INTO lr_devices VALUES($1,$2,$3,$4,$5)',
  [deviceId,accountId,'node_scratch_retired','revoked','__gold_removed_v1__']);
 await query('INSERT INTO lr_gold_job_records VALUES($1,$2,$3,$4)',
  [jobId,accountId,deviceId,'ok']);
 await query('INSERT INTO lr_gold_device_resource_claims VALUES($1,$2,$3,$4,$5,$6)',
  [jobId,accountId,deviceId,proc,'running',claimTime]);
}
async function testOrphan(){
 const match=await locks.inspectOwnerOrphanDevice(pool,{accountId,deviceId,jobId});
 assert.equal(match.accountId,accountId);
 assert.equal(match.policyProfile,'__gold_removed_v1__');
 assert.equal((await locks.inspectOwnerOrphanDevice(pool,
  {accountId:'acct_other',deviceId,jobId})),null);
 const attempt={accountId,deviceId,jobId,observedBootAtMs:boot,
  reason:'gold_agent_uninstalled',channelFresh:false};
 await assert.rejects(()=>locks.abandonOwnerAttestedOrphan(pool,
  {...attempt,channelFresh:true}),/m6_orphan_owner_attestation_invalid/);
 await assert.rejects(()=>locks.abandonOwnerAttestedOrphan(pool,
  {...attempt,observedBootAtMs:Date.parse(claimTime)-1000}),/m6_orphan_boot_not_after_claim/);
 assert.deepEqual(await counts(),[1,0,0]);
 // Force the audit insert to fail. A correct transaction must put the claim
 // back and must never synthesize a terminal receipt.
 await query(`CREATE FUNCTION deny_scratch_audit() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'scratch_audit_write_failed'; END $$;
 CREATE TRIGGER deny_scratch_audit_trigger
 BEFORE INSERT ON lr_audit_events FOR EACH ROW EXECUTE FUNCTION deny_scratch_audit();`);
 await assert.rejects(()=>locks.abandonOwnerAttestedOrphan(pool,attempt),
  /scratch_audit_write_failed/);
 assert.deepEqual(await counts(),[1,0,0],'orphan claim must survive failed audit');
 await query('DROP TRIGGER deny_scratch_audit_trigger ON lr_audit_events');
 const ok=await locks.abandonOwnerAttestedOrphan(pool,attempt);
 assert.equal(ok.released,true);assert.equal(ok.audited,true);
 assert.equal(ok.processOutcome,'unknown');
 assert.equal(ok.terminalReceiptCreated,false);
 assert.deepEqual(await counts(),[0,1,0]);
 const audit=await query('SELECT kind,metadata FROM lr_audit_events LIMIT 1');
 assert.equal(audit.rows[0].kind,'m6_orphan_claim_owner_abandoned');
 assert.equal(audit.rows[0].metadata.processOutcome,'unknown');
 assert.equal(audit.rows[0].metadata.terminalReceiptCreated,false);
 await assert.rejects(()=>locks.abandonOwnerAttestedOrphan(pool,attempt),
  /m6_orphan_claim_not_eligible/);
 assert.deepEqual(await counts(),[0,1,0]);
}
async function testSignedTerminal(){
 const newJob=crypto.randomUUID(),newProc='lp_'+('y'.repeat(26));
 await query('INSERT INTO lr_gold_job_records VALUES($1,$2,$3,$4)',
  [newJob,accountId,deviceId,'ok']);
 await query('INSERT INTO lr_gold_device_resource_claims VALUES($1,$2,$3,$4,$5,$6)',
  [newJob,accountId,deviceId,newProc,'running',claimTime]);
 const input={accountId,deviceId,process:{
  processId:newProc,state:'finished',finishedAt:Date.parse('2026-10-23T02:23:26Z')}};
 const first=await locks.acknowledgeVerifiedTerminal(pool,input);
 assert.deepEqual(first,{acked:true,released:true});
 const again=await locks.acknowledgeVerifiedTerminal(pool,input);
 assert.deepEqual(again,{acked:true,released:false},'terminal replay should be idempotent');
 assert.deepEqual(await counts(),[0,1,1]);
 const bad=await locks.acknowledgeVerifiedTerminal(pool,{...input,
  process:{...input.process,state:'error'}});
 assert.equal(bad.acked,false,'conflicting terminal outcome must not be acknowledged');
}
try{
 const who=await query('SELECT current_database() as database,inet_server_addr() as server_ip');
 assert.equal(who.rows[0].database,name);
 assert.equal(who.rows[0].server_ip,null,'Must be a local unix socket, not a TCP server');
 await createFixture();
 await testOrphan();
 await testSignedTerminal();
 console.log('GOLD_M6_REAL_POSTGRES_SCRATCH_PASS owner_device_join,wrong_owner_denied,online_denied,boot_denied,rollback_on_audit_failure,unknown_only,no_fake_ack,signed_receipt_atomic,replay_idempotent');
}finally{await pool.end();}
