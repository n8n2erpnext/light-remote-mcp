// Gold P1-C: signed-device terminal handling is authenticated by the route.
// This isolated real PG test exercises the transactional lease/ACK/fence path
// after authentication, not a substitute for a real enrolled-device E2E run.
import assert from 'node:assert/strict';
import pg from 'pg';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';
assert.equal(process.env.LR_EPOCH_PG_TEST_ALLOW,'1');
const database=process.env.LR_GOLD_EPOCH_TEST_DB||'';
assert.match(database,/^lr_gold_epoch_fixture_[0-9]{8}$/);
const poolA=new pg.Pool({database,max:3});
const poolB=new pg.Pool({database,max:3});
const locks=new GoldDeviceResourceLocks();
const accountId='acct-p1-c-replay',deviceId='dev-p1-c-replay';
const known='lp_111111111111111111111111',late='lp_222222222222222222222222';
const unknown='lp_333333333333333333333333',rejectPid='lp_444444444444444444444444';
const good={processId:known,state:'finished',finishedAt:1793222200001};
try{
 await poolA.query(`INSERT INTO lr_gold_device_resource_claims
 (job_id,account_id,device_id,resource_key,resource_mode,worker_state,process_id)
 VALUES('p1c-claim-known',$1,$2,'device:desktop','exclusive','running',$3),
 ('p1c-claim-reject',$1,$2,'device:files','exclusive','running',$4)`,
 [accountId,deviceId,known,rejectPid]);
 await poolA.query(`INSERT INTO lr_gold_device_gc_fences
 (job_id,account_id,device_id,resource_key,resource_mode,process_id,recovery_reason)
 VALUES ('p1c-fence-late',$1,$2,'device:process','exclusive',$3,'network_lost'),
 ('p1c-fence-no-pid',$1,$2,'device:unknown','exclusive',NULL,'connection_disconnected')`,
 [accountId,deviceId,late]);
 const different=await locks.acknowledgeVerifiedTerminal(poolA,{accountId:'acct-foreign',deviceId,process:good});
 assert.deepEqual(different,{acked:false,released:false});
 const [one,two]=await Promise.all([
  locks.acknowledgeVerifiedTerminal(poolA,{accountId,deviceId,process:good}),
  locks.acknowledgeVerifiedTerminal(poolB,{accountId,deviceId,process:good})
 ]);
 assert.ok(one.acked&&two.acked);
 assert.equal(Number(one.released)+Number(two.released),1,'concurrent same receipt must release only once');
 const original=await poolA.query('SELECT terminal_state,finished_at_ms FROM lr_gold_terminal_receipt_acks WHERE process_id=$1',[known]);
 assert.equal(original.rowCount,1);
 assert.equal(Number(original.rows[0].finished_at_ms),good.finishedAt);
 assert.deepEqual(await locks.acknowledgeVerifiedTerminal(poolA,{accountId,deviceId,process:good}),{acked:true,released:false});
 assert.deepEqual(await locks.acknowledgeVerifiedTerminal(poolA,{accountId,deviceId,process:{...good,finishedAt:good.finishedAt+1}}),{acked:false,released:false});
 assert.deepEqual(await locks.acknowledgeVerifiedTerminal(poolA,{accountId,deviceId,process:{...good,state:'stopped'}}),{acked:false,released:false});
 const overdue={processId:late,state:'stopped',finishedAt:1793222200003};
 const [ack1,ack2]=await Promise.all([
  locks.acknowledgeVerifiedTerminal(poolA,{accountId,deviceId,process:overdue}),
  locks.acknowledgeVerifiedTerminal(poolB,{accountId,deviceId,process:overdue})
 ]);
 assert.equal(Number(ack1.released)+Number(ack2.released),1,'late GC receipt may resolve fence exactly once');
 assert.ok(ack1.acked&&ack2.acked);
 const fence=(await poolA.query('SELECT resolution,resolved_at FROM lr_gold_device_gc_fences WHERE job_id=$1',['p1c-fence-late'])).rows[0];
 assert.equal(fence.resolution,'signed_terminal_receipt');
 assert.ok(fence.resolved_at,'GC fence must not remain unresolved after exact terminal');
 const missing=await locks.acknowledgeVerifiedTerminal(poolA,{accountId,deviceId,process:{processId:unknown,state:'finished',finishedAt:1793222200005}});
 assert.deepEqual(missing,{acked:false,released:false});
 const noPid=(await poolA.query('SELECT resolved_at FROM lr_gold_device_gc_fences WHERE job_id=$1',['p1c-fence-no-pid'])).rows[0];
 assert.equal(noPid.resolved_at,null,'unknown no-PID fence cannot be released by unrelated PID receipt');

 // Force the ACK insert to fail after DELETE would have run. The PG
 // transaction must restore the claim instead of losing the safety lease.
 await poolA.query(`CREATE FUNCTION p1c_reject_test_ack() RETURNS trigger AS $$
 BEGIN
  IF NEW.process_id='lp_444444444444444444444444' THEN
   RAISE EXCEPTION 'fixture_ack_rejected';
  END IF;
  RETURN NEW;
 END;
 $$ LANGUAGE plpgsql`);
 await poolA.query(`CREATE TRIGGER p1c_reject_test_ack BEFORE INSERT ON lr_gold_terminal_receipt_acks
 FOR EACH ROW EXECUTE FUNCTION p1c_reject_test_ack()`);
 await assert.rejects(()=>locks.acknowledgeVerifiedTerminal(poolB,{accountId,deviceId,
  process:{processId:rejectPid,state:'error',finishedAt:1793222200009}}),/fixture_ack_rejected/);
 const retained=await poolA.query('SELECT job_id FROM lr_gold_device_resource_claims WHERE process_id=$1',[rejectPid]);
 assert.equal(retained.rowCount,1,'ACK database failure must rollback lease deletion');
 assert.equal((await poolA.query('SELECT count(*)::int n FROM lr_gold_terminal_receipt_acks WHERE process_id=$1',[rejectPid])).rows[0].n,0);
 const result=await poolA.query('SELECT count(*)::int n FROM lr_gold_terminal_receipt_acks');
 assert.equal(result.rows[0].n,2,'one ACK for claim plus one ACK for late GC fence');
 console.log(JSON.stringify({ok:true,realPostgres:true,twoOperators:true,
   identicalReplayIdempotent:true,concurrentClaimReleaseExactlyOnce:true,
   lateGcFenceAutoResolvedByExactTerminal:true,concurrentFenceReleaseExactlyOnce:true,
   mismatchedTerminalRejected:true,crossAccountRejected:true,
   noPidFenceStillProtected:true,ackInsertFailureRollsBackClaimRelease:true,
   forgedAckRows:0,productionAndUatUntouched:true}));
}finally{await Promise.allSettled([poolA.end(),poolB.end()]);}
