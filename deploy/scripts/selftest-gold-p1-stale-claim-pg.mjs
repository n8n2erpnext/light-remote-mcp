// Gold P1-A: isolated PostgreSQL read-only stale claim classification contract.
import assert from 'node:assert/strict';
import pg from 'pg';
import {scanOwnerStaleClaims} from '../../lib/gold-stale-claim-detector.mjs';
assert.equal(process.env.LR_EPOCH_PG_TEST_ALLOW,'1');
const db=process.env.LR_GOLD_EPOCH_TEST_DB;
assert.match(db||'',/^lr_gold_epoch_fixture_[0-9]{8}$/);
const pool=new pg.Pool({database:db,max:2});
const accountId='acct-p1-stale-owner',dev='dev-p1-stale-primary',other='dev-p1-stale-other';
const now=Date.now(),H=3600000;
const rows=[
  ['p1-no-pid','terminal_unknown',null,new Date(now-2*H),'interrupted',accountId,dev],
  ['p1-real-pid','running','lp_01234567890123456789',new Date(now-2*H),'ok',accountId,dev],
  ['p1-ack-race','running','lp_98765432109876543210',new Date(now-2*H),'ok',accountId,dev],
  ['p1-fresh','running','lp_12345123451234512345',new Date(now-H+2500),'ok',accountId,dev],
  ['p1-foreign-account','terminal_unknown',null,new Date(now-2*H),'interrupted','acct-foreign',dev],
  ['p1-foreign-device','terminal_unknown',null,new Date(now-2*H),'interrupted',accountId,other]
];
try{
 for(const [job,state,pid,date,status,acct,device] of rows){
  await pool.query('INSERT INTO lr_gold_job_records(job_id,account_id,device_id,status) VALUES($1,$2,$3,$4)',[job,acct,device,status]);
  await pool.query('INSERT INTO lr_gold_device_resource_claims(job_id,account_id,device_id,resource_key,resource_mode,worker_state,process_id,claimed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[job,acct,device,'device:unknown','exclusive',state,pid,date]);
 }
 await pool.query('INSERT INTO lr_gold_terminal_receipt_acks(account_id,device_id,job_id,process_id,terminal_state,finished_at_ms) VALUES($1,$2,$3,$4,$5,$6)',[accountId,dev,'p1-ack-race','lp_98765432109876543210','finished',now-3000]);
 const before=Number((await pool.query('SELECT count(*)::int n FROM lr_gold_device_resource_claims')).rows[0].n);
 const result=await scanOwnerStaleClaims({pool,accountId,deviceIds:[dev],now,minimumAgeMs:H});
 assert.equal(result.totalCandidates,3);
 assert.equal(result.releasePerformed,false);
 const by=new Map(result.items.map(r=>[r.jobId,r]));
 assert.equal(by.get('p1-no-pid').classification,'unknown_no_pid');
 assert.equal(by.get('p1-real-pid').classification,'running_pid_unresolved');
 assert.equal(by.get('p1-ack-race').classification,'inconsistent_claim_after_signed_ack');
 assert.equal(by.get('p1-ack-race').signedTerminalAckPresent,true);
 for(const item of result.items){assert.equal(item.releaseAllowed,false);assert.equal(item.evidence,'diagnostic_only');}
 assert.equal(by.has('p1-fresh'),false);assert.equal(by.has('p1-foreign-account'),false);
 assert.equal(by.has('p1-foreign-device'),false);
 await assert.rejects(()=>scanOwnerStaleClaims({pool,accountId,deviceIds:[dev],now,minimumAgeMs:H,maxRows:2}),/truncated_fail_closed/);
 await assert.rejects(()=>scanOwnerStaleClaims({pool,accountId,deviceIds:['bad device'],now}),/owner_scope_required/);
 const after=Number((await pool.query('SELECT count(*)::int n FROM lr_gold_device_resource_claims')).rows[0].n);
 assert.equal(after,before,'detector may not mutate resource claims');
 assert.equal(Number((await pool.query('SELECT count(*)::int n FROM lr_gold_terminal_receipt_acks WHERE job_id=$1',['p1-ack-race'])).rows[0].n),1);
 console.log(JSON.stringify({ok:true,realPostgres:true,readOnly:true,ownerScoped:true,atLeastAgeMs:H,classified:result.totalCandidates,
    noPidPreserved:true,knownPidPreserved:true,terminalAckAnomalyDetected:true,
    freshNotReported:true,otherAccountExcluded:true,otherDeviceExcluded:true,boundedFailClosed:true,
    noClaimsReleased:true,noTerminalAckFabricated:true}));
}finally{await pool.end();}
