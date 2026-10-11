\set ON_ERROR_STOP on
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan)
 VALUES('uat_guard_free_10','free-10@example.invalid','free'),
       ('uat_guard_paid_10','paid-10@example.invalid','pro');
INSERT INTO lr_devices(device_id,owner_account_id)
 VALUES('uat_guard_device_10','uat_guard_free_10');
INSERT INTO lr_free_families(family_id) VALUES('uat_guard_family_10');
INSERT INTO lr_free_family_devices(device_id,family_id)
 VALUES('uat_guard_device_10','uat_guard_family_10');
INSERT INTO lr_usage_budgets(owner_account_id,month_key,call_limit)
 VALUES('uat_guard_free_10','2026-10',10000);
DO $$
DECLARE msg TEXT;
BEGIN
 BEGIN
  PERFORM lr_charge_usage_uat('uat_guard_bypass_10','uat_guard_free_10',
   'uat_guard_free_10','uat_guard_device_10',NULL,'2026-10',1);
  RAISE EXCEPTION 'old generic path allowed Free without family quota';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'free_requires_family_meter' THEN
   RAISE EXCEPTION 'wrong Free bypass error: %',msg; END IF;
 END;
 -- Free-only family function is still the accepted accounting path.
 IF NOT lr_charge_free_uat('uat_guard_ok_10','uat_guard_free_10',
  'uat_guard_device_10',NULL,'2026-10',1) THEN
  RAISE EXCEPTION 'family metering wrongly blocked'; END IF;
 BEGIN
  INSERT INTO lr_usage_events(event_id,owner_account_id,actor_account_id,
    device_id,month_key,tool_calls,free_family_id)
   VALUES('uat_guard_bad_actor_10','uat_guard_free_10','uat_guard_paid_10',
    'uat_guard_device_10','2026-10',1,'uat_guard_family_10');
  RAISE EXCEPTION 'cross-actor direct Free insert accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'free_requires_family_meter' THEN
   RAISE EXCEPTION 'wrong Free actor rejection: %',msg; END IF;
 END;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM lr_accounts WHERE account_id LIKE 'uat_guard_%_10')
 OR EXISTS(SELECT 1 FROM lr_usage_events WHERE event_id LIKE 'uat_guard_%_10')
 OR EXISTS(SELECT 1 FROM lr_free_families WHERE family_id='uat_guard_family_10')
 THEN RAISE EXCEPTION 'guard fixtures persisted'; END IF;
END $$;
SELECT 'RC50_FREE_METER_BYPASS_GUARD_PASS' AS result;
