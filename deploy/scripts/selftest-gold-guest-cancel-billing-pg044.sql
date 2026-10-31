-- Offline no-network PG17 only. Synthetic post-restart cancellation
-- and usage-once ledger acceptance; does NOT invoke any payment API.
BEGIN;
UPDATE lr_gold_pro_share_guest_jobs SET state='cancelled'
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf102'
  AND owner_account_id='p44-owner' AND state='queued';
UPDATE lr_gold_pro_share_guest_slots SET state='cancelled'
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf102'
  AND owner_account_id='p44-owner' AND state='reserved';
DO $$
DECLARE n INTEGER;
BEGIN
 SELECT count(*) INTO n FROM lr_gold_pro_share_guest_jobs g
 JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
 JOIN lr_gold_personal_agent_work w ON w.job_id=g.job_id
 JOIN lr_gold_job_records j ON j.job_id=g.job_id
 JOIN lr_gold_device_resource_claims c ON c.job_id=g.job_id
 WHERE g.job_id='0af5a9c1-8050-478a-83d1-5e26821cf102'
  AND g.state='cancelled' AND s.state='cancelled'
  AND w.state='running' AND j.status='queued'
  AND c.worker_state='admitting' AND c.process_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM lr_gold_pro_share_guest_outbound o
    WHERE o.job_id=g.job_id);
 IF n<>1 THEN RAISE EXCEPTION 'Pre-effect Guest M4 cancellation proof missing';END IF;
END $$;
DELETE FROM lr_gold_device_resource_claims
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf102'
 AND account_id='p44-owner' AND device_id='p44-device'
 AND worker_state='admitting' AND process_id IS NULL;
DELETE FROM lr_gold_personal_agent_work
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf102'
 AND account_id='p44-owner' AND device_id='p44-device'
 AND state='running';
DELETE FROM lr_gold_job_records
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf102'
 AND account_id='p44-owner' AND device_id='p44-device'
 AND status='queued';
DO $$
DECLARE n INTEGER;
BEGIN
 SELECT count(*) INTO n FROM lr_gold_pro_share_guest_jobs g
 JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
 WHERE g.job_id='0af5a9c1-8050-478a-83d1-5e26821cf102'
  AND g.state='cancelled' AND s.state='cancelled'
  AND NOT EXISTS(SELECT 1 FROM lr_gold_personal_agent_work w WHERE w.job_id=g.job_id)
  AND NOT EXISTS(SELECT 1 FROM lr_gold_device_resource_claims c WHERE c.job_id=g.job_id)
  AND NOT EXISTS(SELECT 1 FROM lr_gold_job_records j WHERE j.job_id=g.job_id);
 IF n<>1 THEN RAISE EXCEPTION 'Cancel after restart left M3/M4/Gold orphan';END IF;
END $$;
COMMIT;
SELECT 'GOLD_PG044_NATIVE_CANCEL_AFTER_RESTART_NO_ORPHANS=PASS';
-- The Operator crashed AFTER queue and slot reached CANCELLED. The
-- subsequent startup must preserve M3/M4/Gold until this cleanup succeeds.
BEGIN;
DO $$
DECLARE n INTEGER;
BEGIN
 SELECT count(*) INTO n FROM lr_gold_pro_share_guest_jobs g
 JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
 JOIN lr_gold_personal_agent_work w ON w.job_id=g.job_id
 JOIN lr_gold_job_records j ON j.job_id=g.job_id
 JOIN lr_gold_device_resource_claims c ON c.job_id=g.job_id
 WHERE g.job_id='0af5a9c1-8050-478a-83d1-5e26821cf104'
  AND g.state='cancelled' AND s.state='cancelled'
  AND w.state='running' AND j.status='queued'
  AND c.worker_state='admitting' AND c.process_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM lr_gold_pro_share_guest_outbound o
    WHERE o.job_id=g.job_id);
 IF n<>1 THEN RAISE EXCEPTION 'Cancelled Guest cannot resume preeffect cleanup';END IF;
END $$;
DELETE FROM lr_gold_device_resource_claims
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf104'
 AND account_id='p44-owner' AND device_id='p44-device'
 AND worker_state='admitting' AND process_id IS NULL;
DELETE FROM lr_gold_personal_agent_work
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf104'
 AND account_id='p44-owner' AND device_id='p44-device'
 AND state='running';
DELETE FROM lr_gold_job_records
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf104'
 AND account_id='p44-owner' AND device_id='p44-device'
 AND status='queued';
DO $$
DECLARE n INTEGER;
BEGIN
 SELECT count(*) INTO n FROM lr_gold_pro_share_guest_jobs g
 JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
 WHERE g.job_id='0af5a9c1-8050-478a-83d1-5e26821cf104'
  AND g.state='cancelled' AND s.state='cancelled'
  AND NOT EXISTS(SELECT 1 FROM lr_gold_personal_agent_work w WHERE w.job_id=g.job_id)
  AND NOT EXISTS(SELECT 1 FROM lr_gold_device_resource_claims c WHERE c.job_id=g.job_id)
  AND NOT EXISTS(SELECT 1 FROM lr_gold_job_records j WHERE j.job_id=g.job_id);
 IF n<>1 THEN RAISE EXCEPTION 'Cancelled Guest still has orphan after restart';END IF;
END $$;
COMMIT;
SELECT 'GOLD_PG044_NATIVE_CANCELLED_GUEST_AFTER_RESTART_NO_ORPHANS=PASS';
-- A single owner-charged Guest operation occupies a unique persisted
-- (owner,operation) identity. This test has no billing API, only SQL044 DDL.
BEGIN;
INSERT INTO lr_gold_pro_share_usage_events (
 owner_account_id,operation_id,guest_account_id,device_id,
 agent_id,grant_id,connection_id,period_utc,units
) VALUES (
 'p44-owner','guestop-a111111111111111','p44-guest','p44-device',
 'p44-plugin-agent','p44-guest-grant','p44-connection',202610,1
);
DO $$
DECLARE blocked BOOLEAN:=FALSE; n INTEGER;
BEGIN
 BEGIN
  INSERT INTO lr_gold_pro_share_usage_events (
   owner_account_id,operation_id,guest_account_id,device_id,
   agent_id,grant_id,connection_id,period_utc,units
  ) VALUES (
   'p44-owner','guestop-a111111111111111','p44-guest','p44-device',
   'p44-plugin-agent','p44-guest-grant','p44-connection',202610,1
  );
 EXCEPTION WHEN unique_violation THEN blocked:=TRUE;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Double-charge operation accepted';END IF;
 SELECT count(*) INTO n FROM lr_gold_pro_share_usage_events
 WHERE owner_account_id='p44-owner' AND operation_id='guestop-a111111111111111';
 IF n<>1 THEN RAISE EXCEPTION 'Owner operation charged more than once';END IF;
 SELECT count(*) INTO n FROM lr_gold_pro_share_usage_events
 WHERE owner_account_id='p44-owner' AND operation_id='guestop-b111111111111111';
 IF n<>0 THEN RAISE EXCEPTION 'Cancelled pre-effect Guest was charged';END IF;
END $$;
COMMIT;
SELECT 'GOLD_PG044_NATIVE_OWNER_GUEST_OPERATION_BILLED_ONCE=PASS';
