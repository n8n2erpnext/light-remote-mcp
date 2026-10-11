\set ON_ERROR_STOP on
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan) VALUES
 ('uat_owner_08','owner-08@example.invalid','free'),
 ('uat_member_08','member-08@example.invalid','free');
INSERT INTO lr_devices(device_id,owner_account_id) VALUES('uat_device_08','uat_owner_08');
INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id)
 VALUES('uat_job_08','uat_owner_08','uat_owner_08','uat_device_08','op_test_08');
INSERT INTO lr_usage_budgets(owner_account_id,month_key,call_limit)
 VALUES('uat_owner_08','2026-10',3);
DO $$
DECLARE n BIGINT;
BEGIN
 IF NOT lr_charge_usage_uat('uat_event_08_1','uat_owner_08','uat_owner_08','uat_device_08','uat_job_08','2026-10',1)
 THEN RAISE EXCEPTION 'first call not charged'; END IF;
 IF lr_charge_usage_uat('uat_event_08_1','uat_owner_08','uat_owner_08','uat_device_08','uat_job_08','2026-10',1)
 THEN RAISE EXCEPTION 'same event charged twice'; END IF;
 -- Two distinct tool calls in the SAME job must be billed independently.
 IF NOT lr_charge_usage_uat('uat_event_08_2','uat_owner_08','uat_owner_08','uat_device_08','uat_job_08','2026-10',1)
 THEN RAISE EXCEPTION 'second event in same job lost'; END IF;
 IF NOT lr_charge_usage_uat('uat_event_08_3','uat_owner_08','uat_owner_08','uat_device_08','uat_job_08','2026-10',1)
 THEN RAISE EXCEPTION 'third event in same job lost'; END IF;
 SELECT COUNT(*) INTO n FROM lr_usage_events WHERE job_id='uat_job_08';
 IF n<>3 THEN RAISE EXCEPTION 'expected 3 distinct billable events'; END IF;
 SELECT tool_calls INTO n FROM lr_usage_monthly WHERE owner_account_id='uat_owner_08' AND month_key='2026-10';
 IF n<>3 THEN RAISE EXCEPTION 'monthly usage should be 3'; END IF;
 BEGIN
  PERFORM lr_charge_usage_uat('uat_event_08_4','uat_owner_08','uat_owner_08','uat_device_08','uat_job_08','2026-10',1);
  RAISE EXCEPTION 'fourth call incorrectly allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  PERFORM lr_charge_usage_uat('uat_event_08_1','uat_owner_08','uat_owner_08','uat_device_08','uat_job_08','2026-10',2);
  RAISE EXCEPTION 'changed event payload was accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  PERFORM lr_charge_usage_uat('uat_event_08_bad_actor','uat_owner_08','uat_member_08','uat_device_08','uat_job_08','2026-10',1);
  RAISE EXCEPTION 'team actor without proof was charged';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  PERFORM lr_charge_usage_uat('uat_event_08_bad_device','uat_owner_08','uat_owner_08','device_other','uat_job_08','2026-10',1);
  RAISE EXCEPTION 'foreign device charged';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM lr_accounts WHERE account_id='uat_owner_08')
 OR EXISTS(SELECT 1 FROM lr_jobs WHERE job_id='uat_job_08')
 OR EXISTS(SELECT 1 FROM lr_usage_events WHERE event_id LIKE 'uat_event_08_%')
 OR EXISTS(SELECT 1 FROM lr_usage_budgets WHERE owner_account_id='uat_owner_08')
 OR EXISTS(SELECT 1 FROM lr_usage_monthly WHERE owner_account_id='uat_owner_08')
 THEN RAISE EXCEPTION 'synthetic usage fixture not rolled back'; END IF;
END $$;
SELECT 'RC50_USAGE_MULTI_EVENT_IDEMPOTENCY_ROLLBACK_PASS' AS result;
