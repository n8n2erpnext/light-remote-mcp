/** Gold isolated PostgreSQL job ledger durability test.
 * Stages: preflight -> write -> restart Gold Operator & Plugin -> read -> cleanup
 * No command/job execution, only synthetic metadata and no production changes.
 */
import assert from 'node:assert/strict';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldJobLedger} from '../../lib/gold-job-ledger.mjs';
const stage=String(process.env.GOLD_JOB_UAT_STAGE||'');
if(!['preflight','write','read','cleanup'].includes(stage))throw Error('gold_job_uat_stage_required');
assert.equal(process.env.LR_GOLD_INSTANCE_ID,'uat19','only_isolated_gold_instance_allowed');
const id='a0000000-0000-4000-8000-202610190001';
const note='PRIVATE_TEST_STRING_SHOULD_NOT_APPEAR';
const accountEmail='gold-native-uat-20261019@example.invalid';
const queryJob="SELECT status,public_view FROM lr_gold_job_records WHERE job_id=$1";
const gold=await connectGoldStorage(),pool=gold.pool;
const ledger=new GoldJobLedger({pool,redact:value=>String(value).replaceAll(note,'[REDACTED]')});
const count=async()=>Number((await pool.query('SELECT count(*)::integer AS n FROM lr_gold_job_records')).rows[0].n);
try{
 const current=await count();
 if(stage==='preflight'){
  assert.equal(current,0,'refuse_existing_gold_job_records');
  console.log('GOLD_JOB_REAL_PG17_PREFLIGHT=PASS');
 }else if(stage==='write'){
  assert.equal(current,0,'refuse_preexisting_jobs');
  const accounts=await pool.query('SELECT account_id FROM lr_accounts WHERE email=$1',[accountEmail]);
  assert.equal(accounts.rowCount,1,'isolated_existing_account_required');
  const accountId=accounts.rows[0].account_id;
  const devices=await pool.query('SELECT device_id FROM lr_devices WHERE owner_account_id=$1',[accountId]);
  assert.equal(devices.rowCount,1,'isolated_existing_device_required');
  const job={id,requestId:'gold-job-uat-20261019',operationId:'job-uat-20261019',
   accountId,deviceId:devices.rows[0].device_id,sessionId:'gold-uat-job-session',
   agentId:'gold-uat-agent',nodeId:'gold-uat-node',
   status:'running',remote:false,startedAt:Date.now(),finishedAt:null,
   exitCode:null,script:note,requiredCapabilities:['filesystem'],resultSummary:note,note};
  ledger.save(job);await ledger.flush();
  const row=(await pool.query(queryJob,[id])).rows[0];
  assert.equal(row?.status,'running');
  assert.equal(row.public_view.status,'running');
  assert.equal(JSON.stringify(row.public_view).includes(note),false,'raw_sensitive_data_persisted');
  assert.equal((await ledger.get(id)).note,'[REDACTED]');
  assert.equal(await count(),1);
  console.log('GOLD_JOB_REAL_PG17_RUNNING_AND_REDACTED=PASS');
 }else if(stage==='read'){
  assert.equal(current,1,'unexpected_job_count');
  const row=(await pool.query(queryJob,[id])).rows[0];
  assert.equal(row?.status,'interrupted','operator_restart_did_not_interrupt_job');
  assert.equal(row.public_view.status,'interrupted');
  assert.equal((await ledger.get(id)).status,'interrupted');
  assert.equal(JSON.stringify(row.public_view).includes(note),false);
  console.log('GOLD_JOB_REAL_PG17_AFTER_OPERATOR_RESTART=PASS');
 }else{
  assert.equal(current,1,'unexpected_job_cleanup_count');
  const row=(await pool.query(queryJob,[id])).rows[0];
  assert.equal(row?.status,'interrupted','job_cleanup_refuses_unexpected_state');
  await pool.query('DELETE FROM lr_gold_job_records WHERE job_id=$1',[id]);
  assert.equal(await count(),0,'job_cleanup_not_empty');
  console.log('GOLD_JOB_REAL_PG17_CLEANUP=PASS');
 }
}finally{await gold.close()}
