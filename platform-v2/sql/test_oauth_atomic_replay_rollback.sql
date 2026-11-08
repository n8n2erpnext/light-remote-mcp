\set ON_ERROR_STOP on
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan)
 VALUES ('uat_oauth_owner_13','oauth-13@example.invalid','free');
DO $$
DECLARE
 result BOOLEAN;
 inserted INTEGER;
 problem TEXT;
 exp_code BIGINT:=(extract(epoch FROM clock_timestamp()+interval '90 seconds'))::bigint;
 exp_refresh BIGINT:=(extract(epoch FROM clock_timestamp()+interval '2 days'))::bigint;
 exp_resume BIGINT:=(extract(epoch FROM clock_timestamp()+interval '15 minutes'))::bigint;
BEGIN
 SELECT lr_consume_oauth_once_uat(repeat('a',64),'authorization_code',
  'uat_oauth_owner_13','uat_client',exp_code) INTO result;
 IF result IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'first code failed'; END IF;
 SELECT lr_consume_oauth_once_uat(repeat('a',64),'authorization_code',
  'uat_oauth_owner_13','uat_client',exp_code) INTO result;
 IF result IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'code replay accepted'; END IF;
 SELECT lr_consume_oauth_once_uat(repeat('b',64),'refresh',
  'uat_oauth_owner_13','uat_client',exp_refresh) INTO result;
 IF result IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'first refresh failed'; END IF;
 SELECT lr_consume_oauth_once_uat(repeat('b',64),'refresh',
  'uat_oauth_owner_13','uat_client',exp_refresh) INTO result;
 IF result IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'refresh replay accepted'; END IF;
 SELECT lr_consume_oauth_once_uat(repeat('c',64),'resume',
  NULL,'uat_client',exp_resume) INTO result;
 IF result IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'resume failed'; END IF;
 SELECT lr_consume_oauth_once_uat(repeat('c',64),'resume',
  NULL,'uat_client',exp_resume) INTO result;
 IF result IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'resume replay accepted'; END IF;
 SELECT count(*) INTO inserted FROM lr_oauth_one_time
  WHERE token_sha256 IN (repeat('a',64),repeat('b',64),repeat('c',64))
  AND consumed_at IS NOT NULL;
 IF inserted<>3 THEN RAISE EXCEPTION 'ledger count mismatch: %',inserted; END IF;
 -- Safety: never accept an expired, missing-owner, changed-role or malformed claim.
 BEGIN
  PERFORM lr_consume_oauth_once_uat(repeat('d',64),'authorization_code',
    'uat_oauth_owner_13','uat_client', (extract(epoch FROM clock_timestamp()-interval '1 minute'))::bigint);
  RAISE EXCEPTION 'expired authorization code accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS problem=MESSAGE_TEXT;
  IF problem<>'oauth_replay_expired_or_future' THEN RAISE EXCEPTION 'wrong error: %',problem; END IF;
 END;
 BEGIN
  PERFORM lr_consume_oauth_once_uat(repeat('e',64),'refresh',
    'does_not_exist','uat_client',exp_refresh);
  RAISE EXCEPTION 'unregistered principal accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS problem=MESSAGE_TEXT;
  IF problem<>'oauth_replay_account_inactive' THEN RAISE EXCEPTION 'wrong error: %',problem; END IF;
 END;
 BEGIN
  PERFORM lr_consume_oauth_once_uat(repeat('f',64),'resume',
    'uat_oauth_owner_13','uat_client',exp_resume);
  RAISE EXCEPTION 'resume with account association accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS problem=MESSAGE_TEXT;
  IF problem<>'resume_token_must_not_contain_account' THEN RAISE EXCEPTION 'wrong error: %',problem; END IF;
 END;
 BEGIN
  PERFORM lr_consume_oauth_once_uat(repeat('z',64),'refresh',
    'uat_oauth_owner_13','uat_client',exp_refresh);
  RAISE EXCEPTION 'invalid token hash accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS problem=MESSAGE_TEXT;
  IF problem<>'invalid_oauth_replay_claims' THEN RAISE EXCEPTION 'wrong error: %',problem; END IF;
 END;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM lr_accounts WHERE account_id='uat_oauth_owner_13')
 OR EXISTS(SELECT 1 FROM lr_oauth_one_time
 WHERE token_sha256 IN(repeat('a',64),repeat('b',64),repeat('c',64)))
 THEN RAISE EXCEPTION 'synthetic OAuth fixture survived rollback'; END IF;
END $$;
SELECT 'RC50_OAUTH_ATOMIC_REPLAY_ROLLBACK_PASS' AS result;
