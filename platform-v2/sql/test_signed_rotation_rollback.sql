\set ON_ERROR_STOP on
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan) VALUES
 ('uat_rot_owner_a','rot-a@example.invalid','free'),
 ('uat_rot_owner_b','rot-b@example.invalid','free');
INSERT INTO lr_devices(device_id,owner_account_id,state) VALUES
 ('uat_rot_old','uat_rot_owner_a','online'),
 ('uat_rot_new','uat_rot_owner_b','registered'),
 ('uat_rot_other','uat_rot_owner_b','registered');
INSERT INTO lr_device_identity_keys_uat(device_id,public_spki_base64,public_key_sha256)
 VALUES ('uat_rot_old',repeat('a',70),repeat('a',64)),
 ('uat_rot_new',repeat('b',70),repeat('b',64)),
 ('uat_rot_other',repeat('c',70),repeat('c',64));
INSERT INTO lr_free_families(family_id) VALUES('uat_rot_old_family'),('uat_rot_other_family');
INSERT INTO lr_free_family_devices(device_id,family_id)
 VALUES('uat_rot_old','uat_rot_old_family'),
 ('uat_rot_other','uat_rot_other_family');
INSERT INTO lr_free_family_monthly(family_id,month_key,tool_calls)
 VALUES('uat_rot_old_family','2026-10',9999);
INSERT INTO lr_free_rotation_challenges(challenge_id,old_device_id,new_device_id,
 old_owner_account_id,new_owner_account_id,source_family_id,old_key_sha256,new_key_sha256,nonce_sha256,expires_at)
 VALUES
 ('uat_rot_challenge','uat_rot_old','uat_rot_new','uat_rot_owner_a','uat_rot_owner_b','uat_rot_old_family',
  repeat('a',64),repeat('b',64),repeat('1',64),now()+interval '2 minutes'),
 ('uat_rot_taken','uat_rot_old','uat_rot_other','uat_rot_owner_a','uat_rot_owner_b','uat_rot_old_family',
  repeat('a',64),repeat('c',64),repeat('2',64),now()+interval '2 minutes'),
 ('uat_rot_expired','uat_rot_old','uat_rot_new','uat_rot_owner_a','uat_rot_owner_b','uat_rot_old_family',
  repeat('a',64),repeat('b',64),repeat('3',64),now()+interval '3 seconds');

DO $$
DECLARE result BOOLEAN; n INTEGER; msg TEXT;
BEGIN
 BEGIN
  PERFORM lr_finalize_free_rotation_uat('uat_rot_challenge',repeat('0',64),repeat('a',64),repeat('b',64));
  RAISE EXCEPTION 'invalid nonce should not authorize link';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'rotation_challenge_mismatch' THEN RAISE EXCEPTION 'wrong nonce failure: %',msg; END IF;
 END;
 BEGIN
  PERFORM lr_finalize_free_rotation_uat('uat_rot_taken',repeat('2',64),repeat('a',64),repeat('c',64));
  RAISE EXCEPTION 'target already assigned to family should not be merged';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'rotation_target_already_family_bound' THEN RAISE EXCEPTION 'wrong merge denial: %',msg; END IF;
 END;
 SELECT lr_finalize_free_rotation_uat('uat_rot_challenge',repeat('1',64),repeat('a',64),repeat('b',64)) INTO result;
 IF result IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'valid synthetically preverified challenge refused'; END IF;
 SELECT lr_finalize_free_rotation_uat('uat_rot_challenge',repeat('1',64),repeat('a',64),repeat('b',64)) INTO result;
 IF result IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'replay unexpectedly relinked'; END IF;
 SELECT count(*) INTO n FROM lr_free_family_devices
  WHERE family_id='uat_rot_old_family';
 IF n<>2 THEN RAISE EXCEPTION 'family linkage expected 2 devices'; END IF;
 IF NOT EXISTS(SELECT 1 FROM lr_free_rotation_audit WHERE challenge_id='uat_rot_challenge'
   AND old_device_id='uat_rot_old' AND new_device_id='uat_rot_new'
   AND family_id='uat_rot_old_family') THEN
  RAISE EXCEPTION 'rotation audit row missing'; END IF;
 IF (SELECT tool_calls FROM lr_free_family_monthly WHERE family_id='uat_rot_old_family' AND month_key='2026-10')<>9999 THEN
  RAISE EXCEPTION 'rotation reset existing family usage'; END IF;
END $$;
-- Already-consumed proof remains consumed; new month's usage must remain shared.
INSERT INTO lr_usage_events(event_id,owner_account_id,actor_account_id,device_id,month_key,tool_calls,free_family_id)
 VALUES ('uat_rot_old_event','uat_rot_owner_a','uat_rot_owner_a','uat_rot_old','2026-10',1,'uat_rot_old_family');
UPDATE lr_free_family_monthly SET tool_calls=10000
 WHERE family_id='uat_rot_old_family' AND month_key='2026-10';
DO $$
DECLARE msg TEXT;
BEGIN
 BEGIN
  PERFORM lr_charge_free_uat('uat_rot_after_cap','uat_rot_owner_b','uat_rot_new',NULL,'2026-10',1);
  RAISE EXCEPTION 'rotation reset the Free family cap';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'free_device_family_monthly_quota_exceeded' THEN RAISE EXCEPTION 'wrong quota failure: %',msg; END IF;
 END;
END $$;
INSERT INTO lr_free_rotation_challenges(challenge_id,old_device_id,new_device_id,
 old_owner_account_id,new_owner_account_id,source_family_id,
 old_key_sha256,new_key_sha256,nonce_sha256,expires_at)
 VALUES ('uat_rot_changed','uat_rot_old','uat_rot_other','uat_rot_owner_a',
 'uat_rot_owner_b','uat_rot_old_family',repeat('a',64),repeat('c',64),
 repeat('4',64),now()+interval '2 minutes');
UPDATE lr_free_family_devices SET family_id='uat_rot_other_family'
 WHERE device_id='uat_rot_old';
DO $$
DECLARE msg TEXT;
BEGIN
 BEGIN
  PERFORM lr_finalize_free_rotation_uat('uat_rot_changed',repeat('4',64),
   repeat('a',64),repeat('c',64));
  RAISE EXCEPTION 'source family changed but old proof accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'rotation_source_family_changed' THEN
   RAISE EXCEPTION 'wrong source family error: %',msg; END IF;
 END;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM lr_accounts WHERE account_id LIKE 'uat_rot_%')
  OR EXISTS(SELECT 1 FROM lr_free_rotation_challenges WHERE challenge_id LIKE 'uat_rot_%')
  OR EXISTS(SELECT 1 FROM lr_free_rotation_audit WHERE challenge_id LIKE 'uat_rot_%')
  OR EXISTS(SELECT 1 FROM lr_free_families WHERE family_id LIKE 'uat_rot_%')
  OR EXISTS(SELECT 1 FROM lr_usage_events WHERE event_id LIKE 'uat_rot_%')
 THEN RAISE EXCEPTION 'rotation fixtures survived ROLLBACK'; END IF;
END $$;
SELECT 'RC50_ROTATION_DB_SINGLE_USE_AND_NO_MERGE_PASS' AS result;
