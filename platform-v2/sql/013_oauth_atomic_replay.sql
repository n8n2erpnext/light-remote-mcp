-- UAT-only: atomic consumed JWT-jti hash ledger for horizontally replicated OAuth.
-- Source JWT signature, issuer, audience, client binding, PKCE and scopes
-- MUST be verified by a trusted API BEFORE calling this SECURITY INVOKER function.
-- Never store raw JWTs, authorization codes, refresh tokens or raw JTI.
BEGIN;
CREATE OR REPLACE FUNCTION lr_consume_oauth_once_uat(
 p_hash TEXT,
 p_purpose TEXT,
 p_account_id TEXT,
 p_client_id TEXT,
 p_expires_epoch BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
 v_now TIMESTAMPTZ := clock_timestamp();
 v_exp TIMESTAMPTZ;
 v_max_seconds INTEGER;
 v_inserted TEXT;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
 OR p_purpose IS NULL OR p_purpose NOT IN ('authorization_code','refresh','resume')
 OR p_client_id IS NULL OR length(p_client_id) NOT BETWEEN 1 AND 4096
 OR p_expires_epoch IS NULL OR p_expires_epoch NOT BETWEEN 1000000000 AND 4102444800 THEN
   RAISE EXCEPTION 'invalid_oauth_replay_claims' USING ERRCODE='check_violation';
 END IF;
 v_max_seconds := CASE p_purpose
  WHEN 'authorization_code' THEN 120
  WHEN 'resume' THEN 86400
  WHEN 'refresh' THEN 2592000
 END;
 v_exp := to_timestamp(p_expires_epoch);
 IF v_exp <= v_now OR v_exp > v_now + make_interval(secs=>v_max_seconds+30) THEN
   RAISE EXCEPTION 'oauth_replay_expired_or_future' USING ERRCODE='check_violation';
 END IF;
 IF p_purpose = 'resume' AND p_account_id IS NOT NULL THEN
   RAISE EXCEPTION 'resume_token_must_not_contain_account' USING ERRCODE='check_violation';
 END IF;
 IF p_purpose IN ('authorization_code','refresh') THEN
   IF p_account_id IS NULL OR length(p_account_id) NOT BETWEEN 1 AND 128 THEN
     RAISE EXCEPTION 'oauth_replay_owner_required' USING ERRCODE='check_violation';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM lr_accounts
     WHERE account_id=p_account_id AND status='active') THEN
     RAISE EXCEPTION 'oauth_replay_account_inactive' USING ERRCODE='check_violation';
   END IF;
 END IF;
 INSERT INTO lr_oauth_one_time(
   token_sha256,purpose,account_id,client_id,expires_at,consumed_at
 ) VALUES(p_hash,p_purpose,p_account_id,p_client_id,v_exp,v_now)
 ON CONFLICT (token_sha256) DO NOTHING
 RETURNING token_sha256 INTO v_inserted;
 RETURN v_inserted IS NOT NULL;
END $$;
REVOKE EXECUTE ON FUNCTION lr_consume_oauth_once_uat(TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
INSERT INTO lr_schema_migrations(version) VALUES(13) ON CONFLICT DO NOTHING;
COMMIT;
