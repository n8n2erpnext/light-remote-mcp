\set ON_ERROR_STOP on
-- Synthetic-only fixture, unconditionally ROLLBACK and verify zero rows.
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan) VALUES
 ('uat_owner_06','owner-06@example.invalid','pro'),
 ('uat_member_06','member-06@example.invalid','free');
INSERT INTO lr_devices(device_id,owner_account_id,state)
 VALUES('uat_device_06','uat_owner_06','online');
INSERT INTO lr_worker_slots(device_id,slot_number)
 VALUES('uat_device_06',1),('uat_device_06',2),('uat_device_06',3);
INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id)
 SELECT 'uat_job_06_'||i,'uat_owner_06','uat_owner_06','uat_device_06','uat_op_06_'||i
 FROM generate_series(1,5) i;
INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id)
 VALUES('uat_member_job_06','uat_owner_06','uat_member_06','uat_device_06','uat_member_op');

DO $$
DECLARE r RECORD; n INTEGER; gen1 BIGINT; gen4 BIGINT;
BEGIN
 BEGIN
  PERFORM * FROM lr_claim_worker_slot('uat_device_06','uat_member_job_06',repeat('e',64),90);
  RAISE EXCEPTION 'cross-account job claimed without trusted proof';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 FOR n IN 1..3 LOOP
  SELECT * INTO r FROM lr_claim_worker_slot('uat_device_06','uat_job_06_'||n,repeat(n::text,64),90);
  IF NOT FOUND OR r.slot_number<>n OR r.generation<>1 THEN
    RAISE EXCEPTION 'slot allocation failed: job % got %',n,r;
  END IF;
 END LOOP;
 gen1:=1;
 SELECT count(*) INTO n FROM lr_claim_worker_slot('uat_device_06','uat_job_06_4',repeat('4',64),90);
 IF n<>0 THEN RAISE EXCEPTION 'fourth concurrent slot allocated'; END IF;
 IF lr_finish_worker_job('uat_job_06_1',repeat('f',64),gen1,TRUE) THEN
   RAISE EXCEPTION 'wrong lease token finished job'; END IF;
 IF lr_finish_worker_job('uat_job_06_1',repeat('1',64),999,TRUE) THEN
   RAISE EXCEPTION 'wrong generation finished job'; END IF;
 IF NOT lr_renew_worker_lease('uat_job_06_1',repeat('1',64),gen1,90) THEN
   RAISE EXCEPTION 'valid lease renew denied'; END IF;
 -- Synthetic force-expire to model a crashed worker without wall-clock sleep.
 UPDATE lr_worker_slots SET expires_at=clock_timestamp()-interval '1 second'
  WHERE device_id='uat_device_06' AND slot_number=1;
 UPDATE lr_jobs SET lease_expires_at=clock_timestamp()-interval '1 second'
  WHERE job_id='uat_job_06_1';
 SELECT * INTO r FROM lr_claim_worker_slot('uat_device_06','uat_job_06_4',repeat('4',64),90);
 IF NOT FOUND OR r.slot_number<>1 OR r.generation<>2 THEN
   RAISE EXCEPTION 'expired slot was not fenced/reclaimed'; END IF;
 gen4:=r.generation;
 IF (SELECT state FROM lr_jobs WHERE job_id='uat_job_06_1')<>'lease_expired' THEN
   RAISE EXCEPTION 'old worker job was not expired'; END IF;
 IF lr_finish_worker_job('uat_job_06_1',repeat('1',64),1,TRUE) THEN
   RAISE EXCEPTION 'stale worker completed after reclaim'; END IF;
 IF lr_renew_worker_lease('uat_job_06_1',repeat('1',64),1,90) THEN
   RAISE EXCEPTION 'stale worker renewed after reclaim'; END IF;
 IF lr_finish_worker_job('uat_job_06_4',repeat('1',64),gen4,TRUE) THEN
   RAISE EXCEPTION 'wrong token finished reclaimed slot'; END IF;
 IF NOT lr_finish_worker_job('uat_job_06_4',repeat('4',64),gen4,TRUE) THEN
   RAISE EXCEPTION 'valid fenced completion denied'; END IF;
 IF lr_finish_worker_job('uat_job_06_4',repeat('4',64),gen4,TRUE) THEN
   RAISE EXCEPTION 'duplicate job completion accepted'; END IF;
 SELECT count(*) INTO n FROM lr_outbox WHERE aggregate_id IN ('uat_job_06_1','uat_job_06_4');
 IF n<>2 THEN RAISE EXCEPTION 'missing transactional outbox events'; END IF;
END $$;
DO $$
DECLARE a RECORD; b RECORD; n INTEGER;
BEGIN
 SELECT * INTO a FROM lr_claim_outbox('uat_consumer_A_06',1,60);
 IF NOT FOUND THEN RAISE EXCEPTION 'pending outbox cannot be claimed'; END IF;
 IF lr_ack_outbox(a.outbox_id,'uat_consumer_B_06',a.lease_generation) THEN
  RAISE EXCEPTION 'wrong consumer acknowledged message'; END IF;
 IF lr_ack_outbox(a.outbox_id,'uat_consumer_A_06',a.lease_generation+1) THEN
  RAISE EXCEPTION 'wrong generation acknowledged message'; END IF;
 IF (SELECT count(*) FROM lr_claim_outbox('uat_consumer_B_06',5,60))<>1 THEN
  RAISE EXCEPTION 'outbox double claim or lost other event'; END IF;
 IF NOT lr_ack_outbox(a.outbox_id,'uat_consumer_A_06',a.lease_generation) THEN
  RAISE EXCEPTION 'valid acknowledgement failed'; END IF;
 IF lr_ack_outbox(a.outbox_id,'uat_consumer_A_06',a.lease_generation) THEN
  RAISE EXCEPTION 'double acknowledgement accepted'; END IF;
 SELECT * INTO b FROM lr_outbox WHERE delivered_at IS NULL AND leased_by='uat_consumer_B_06';
 IF NOT FOUND THEN RAISE EXCEPTION 'second event unexpectedly lost'; END IF;
 IF NOT lr_retry_outbox(b.outbox_id,'uat_consumer_B_06',b.lease_generation,1,'synthetic delivery failure') THEN
  RAISE EXCEPTION 'retry failed'; END IF;
 IF lr_ack_outbox(b.outbox_id,'uat_consumer_B_06',b.lease_generation) THEN
  RAISE EXCEPTION 'stale ack accepted after retry'; END IF;
 UPDATE lr_outbox SET visible_at=clock_timestamp()-interval '1 second' WHERE outbox_id=b.outbox_id;
 SELECT * INTO b FROM lr_claim_outbox('uat_consumer_C_06',1,60);
 IF NOT FOUND OR b.lease_generation<>2 THEN
  RAISE EXCEPTION 'outbox retry did not increment fencing generation'; END IF;
 IF NOT lr_ack_outbox(b.outbox_id,'uat_consumer_C_06',b.lease_generation) THEN
  RAISE EXCEPTION 'reclaimed outbox ack failed'; END IF;
 SELECT count(*) INTO n FROM lr_outbox WHERE aggregate_id LIKE 'uat_job_06_%' AND delivered_at IS NOT NULL;
 IF n<>2 THEN RAISE EXCEPTION 'outbox delivery count mismatch'; END IF;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM lr_accounts WHERE account_id IN ('uat_owner_06','uat_member_06'))
  THEN RAISE EXCEPTION 'worker fixture retained accounts'; END IF;
 IF EXISTS(SELECT 1 FROM lr_outbox WHERE aggregate_id LIKE 'uat_job_06_%')
  THEN RAISE EXCEPTION 'worker fixture retained outbox records'; END IF;
 IF EXISTS(SELECT 1 FROM lr_jobs WHERE job_id LIKE 'uat_job_06_%')
  THEN RAISE EXCEPTION 'worker fixture retained jobs'; END IF;
END $$;
SELECT 'RC50_WORKER_OUTBOX_FENCING_ROLLBACK_PASS' AS result;
