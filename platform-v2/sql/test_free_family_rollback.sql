\set ON_ERROR_STOP on
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan) VALUES
 ('uat_free_09_a','free-a-09@example.invalid','free'),
 ('uat_free_09_b','free-b-09@example.invalid','free'),
 ('uat_paid_09','paid-09@example.invalid','pro');
INSERT INTO lr_devices(device_id,owner_account_id) VALUES
 ('uat_free_device_09_a','uat_free_09_a'),
 ('uat_free_device_09_b','uat_free_09_b'),
 ('uat_paid_device_09','uat_paid_09');
INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id) VALUES
 ('uat_free_job_09_a','uat_free_09_a','uat_free_09_a','uat_free_device_09_a','op_free_a_09'),
 ('uat_free_job_09_b','uat_free_09_b','uat_free_09_b','uat_free_device_09_b','op_free_b_09');
INSERT INTO lr_free_families(family_id) VALUES('uat_verified_family_09');
-- The UAT fixture simulates a prior trusted installation-rotation proof:
-- two distinct device owners share one pre-verified family. This SQL does not
-- implement or bypass the REAL signed proof validation step.
INSERT INTO lr_free_family_devices(device_id,family_id) VALUES
 ('uat_free_device_09_a','uat_verified_family_09'),
 ('uat_free_device_09_b','uat_verified_family_09');
DO $$
DECLARE n BIGINT;msg TEXT;
BEGIN
 IF NOT lr_charge_free_uat('uat_free_event_09_a1','uat_free_09_a','uat_free_device_09_a',
 'uat_free_job_09_a','2026-10',1) THEN RAISE EXCEPTION 'first charge denied'; END IF;
 IF NOT lr_charge_free_uat('uat_free_event_09_b1','uat_free_09_b','uat_free_device_09_b',
 'uat_free_job_09_b','2026-10',1) THEN RAISE EXCEPTION 'second Free account charge denied'; END IF;
 IF lr_charge_free_uat('uat_free_event_09_a1','uat_free_09_a','uat_free_device_09_a',
 'uat_free_job_09_a','2026-10',1) THEN RAISE EXCEPTION 'replay charged'; END IF;
 SELECT tool_calls INTO n FROM lr_free_family_monthly
  WHERE family_id='uat_verified_family_09' AND month_key='2026-10';
 IF n<>2 THEN RAISE EXCEPTION 'family rollup must be 2'; END IF;
 SELECT count(*) INTO n FROM lr_usage_events WHERE free_family_id='uat_verified_family_09';
 IF n<>2 THEN RAISE EXCEPTION 'family event ledger must be 2'; END IF;
 BEGIN
  PERFORM lr_charge_free_uat('uat_free_event_09_a1','uat_free_09_a','uat_free_device_09_a',
   'uat_free_job_09_a','2026-10',2);
  RAISE EXCEPTION 'tampered event replay unexpectedly accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'free_event_payload_mismatch' THEN RAISE EXCEPTION 'wrong replay rejection: %',msg; END IF;
 END;
 BEGIN
  PERFORM lr_charge_free_uat('uat_free_event_09_unverified','uat_paid_09','uat_paid_device_09',
   NULL,'2026-10',1);
  RAISE EXCEPTION 'paid or unverified account charged via Free';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'free_account_ineligible' THEN RAISE EXCEPTION 'wrong plan rejection: %',msg; END IF;
 END;
 BEGIN
  PERFORM lr_charge_free_uat('uat_free_event_09_badowner','uat_free_09_a','uat_free_device_09_b',
   NULL,'2026-10',1);
  RAISE EXCEPTION 'foreign device owner charge accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'free_device_owner_mismatch' THEN RAISE EXCEPTION 'wrong owner rejection: %',msg; END IF;
 END;
END $$;

-- Synthetic starting aggregate close to cap exercises enforcement without
-- fabricating 9,998 events. This aggregate is rolled back at end of the test.
UPDATE lr_free_family_monthly SET tool_calls=9998
 WHERE family_id='uat_verified_family_09' AND month_key='2026-10';
DO $$
DECLARE n BIGINT;msg TEXT;
BEGIN
 IF NOT lr_charge_free_uat('uat_free_event_09_a2','uat_free_09_a','uat_free_device_09_a',
 'uat_free_job_09_a','2026-10',1) THEN RAISE EXCEPTION 'penultimate call denied'; END IF;
 IF NOT lr_charge_free_uat('uat_free_event_09_b2','uat_free_09_b','uat_free_device_09_b',
 'uat_free_job_09_b','2026-10',1) THEN RAISE EXCEPTION 'last available call denied'; END IF;
 BEGIN
  PERFORM lr_charge_free_uat('uat_free_event_09_a3','uat_free_09_a','uat_free_device_09_a',
   'uat_free_job_09_a','2026-10',1);
  RAISE EXCEPTION 'family 10001st call was allowed';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'free_device_family_monthly_quota_exceeded' THEN RAISE EXCEPTION 'wrong family quota rejection: %',msg; END IF;
 END;
 IF lr_charge_free_uat('uat_free_event_09_b2','uat_free_09_b','uat_free_device_09_b',
 'uat_free_job_09_b','2026-10',1) THEN RAISE EXCEPTION 'duplicate after cap charged'; END IF;
 SELECT tool_calls INTO n FROM lr_free_family_monthly
  WHERE family_id='uat_verified_family_09' AND month_key='2026-10';
 IF n<>10000 THEN RAISE EXCEPTION 'expected family cap 10000, got %',n; END IF;
 -- New month is a separate bucket.
 IF NOT lr_charge_free_uat('uat_free_event_09_a_nov','uat_free_09_a','uat_free_device_09_a',
 'uat_free_job_09_a','2026-11',1) THEN RAISE EXCEPTION 'new month did not reset'; END IF;
 -- Account bucket is also capped independently, even if family has headroom.
 UPDATE lr_usage_monthly SET tool_calls=10000
  WHERE owner_account_id='uat_free_09_a' AND month_key='2026-11';
 BEGIN
  PERFORM lr_charge_free_uat('uat_free_event_09_accountcap','uat_free_09_a','uat_free_device_09_a',
   'uat_free_job_09_a','2026-11',1);
  RAISE EXCEPTION 'account exceeded 10000';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'free_account_monthly_quota_exceeded' THEN RAISE EXCEPTION 'wrong account quota rejection: %',msg; END IF;
 END;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM lr_accounts WHERE account_id LIKE 'uat_free_09_%')
 OR EXISTS (SELECT 1 FROM lr_free_families WHERE family_id='uat_verified_family_09')
 OR EXISTS (SELECT 1 FROM lr_free_family_devices WHERE device_id LIKE 'uat_free_device_09_%')
 OR EXISTS (SELECT 1 FROM lr_usage_events WHERE event_id LIKE 'uat_free_event_09_%')
 OR EXISTS (SELECT 1 FROM lr_free_family_monthly WHERE family_id='uat_verified_family_09')
 THEN RAISE EXCEPTION 'UAT free family fixture persisted'; END IF;
END $$;
SELECT 'RC50_FREE_FAMILY_ROLLBACK_PASS' AS result;
