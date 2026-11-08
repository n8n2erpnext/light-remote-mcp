-- Synthetic UAT only. This is a DB-side consistency guard, NOT an OAuth verifier.
-- Caller identity must still be authenticated by the API, and dispatch disabled
-- until device/agent OS-side A/B and fencing are proven.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_team_member_budgets (
 owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
 month_key CHAR(7) NOT NULL CHECK(month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 call_limit BIGINT NOT NULL CHECK(call_limit BETWEEN 1 AND 1000000),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_account_id,month_key)
);
CREATE TABLE IF NOT EXISTS lr_team_member_monthly (
 owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
 month_key CHAR(7) NOT NULL CHECK(month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 tool_calls BIGINT NOT NULL DEFAULT 0 CHECK(tool_calls >= 0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_account_id,month_key)
);
CREATE OR REPLACE FUNCTION lr_charge_team_member_uat(
 p_event TEXT,p_owner TEXT,p_actor TEXT,p_device TEXT,p_job TEXT,
 p_client_session TEXT,p_grant_id TEXT,p_month CHAR(7),p_calls INTEGER DEFAULT 1)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
 v_prior lr_usage_events%ROWTYPE;
 v_owner lr_accounts%ROWTYPE;
 v_actor lr_accounts%ROWTYPE;
 v_job lr_jobs%ROWTYPE;
 v_client lr_agent_clients%ROWTYPE;
 v_grant lr_ab_grants%ROWTYPE;
 v_conn lr_device_connections%ROWTYPE;
 v_cap BIGINT;
 v_team_used BIGINT;
 v_now TIMESTAMPTZ:=clock_timestamp();
BEGIN
 IF p_event IS NULL OR p_event !~ '^[A-Za-z0-9._:-]{1,160}$'
  OR p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9._:-]{1,128}$'
  OR p_actor IS NULL OR p_actor !~ '^[A-Za-z0-9._:-]{1,128}$'
  OR p_actor=p_owner
  OR p_device IS NULL OR p_device !~ '^[A-Za-z0-9._:-]{1,160}$'
  OR p_job IS NULL OR p_job !~ '^[A-Za-z0-9._:-]{1,160}$'
  OR p_client_session IS NULL OR p_client_session !~ '^[A-Za-z0-9._:-]{1,180}$'
  OR p_grant_id IS NULL OR p_grant_id !~ '^[A-Za-z0-9._:-]{1,160}$'
  OR p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  OR p_calls IS NULL OR p_calls NOT BETWEEN 1 AND 10000 THEN
  RAISE EXCEPTION 'invalid_team_member_charge' USING ERRCODE='check_violation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lightremote:uat:usage:'||p_owner||':'||p_month,0));
 SELECT * INTO v_prior FROM lr_usage_events WHERE event_id=p_event;
 IF FOUND THEN
  IF v_prior.owner_account_id<>p_owner OR v_prior.actor_account_id<>p_actor
   OR v_prior.device_id IS DISTINCT FROM p_device
   OR v_prior.job_id IS DISTINCT FROM p_job
   OR v_prior.month_key<>p_month OR v_prior.tool_calls<>p_calls
   OR v_prior.free_family_id IS NOT NULL THEN
   RAISE EXCEPTION 'team_event_payload_mismatch' USING ERRCODE='check_violation'; END IF;
  RETURN FALSE;
 END IF;
 SELECT * INTO v_owner FROM lr_accounts WHERE account_id=p_owner FOR SHARE;
 IF NOT FOUND OR v_owner.plan NOT IN ('pro','vip') OR v_owner.status<>'active' THEN
  RAISE EXCEPTION 'team_owner_subscription_required' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO v_actor FROM lr_accounts WHERE account_id=p_actor FOR SHARE;
 IF NOT FOUND OR v_actor.status<>'active' THEN
  RAISE EXCEPTION 'team_member_account_inactive' USING ERRCODE='check_violation'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM lr_teams t JOIN lr_team_members m ON m.team_id=t.team_id
   WHERE t.owner_account_id=p_owner AND m.account_id=p_actor AND m.state='active') THEN
  RAISE EXCEPTION 'team_membership_required' USING ERRCODE='check_violation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM lr_entitlements e WHERE e.owner_account_id=p_owner
   AND e.kind='pro_team' AND e.revoked_at IS NULL AND e.effective_at<=v_now
   AND (e.valid_until IS NULL OR e.valid_until>v_now)) THEN
  RAISE EXCEPTION 'team_addon_required' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO v_job FROM lr_jobs WHERE job_id=p_job;
 IF NOT FOUND OR v_job.owner_account_id<>p_owner OR v_job.actor_account_id<>p_actor
   OR v_job.device_id<>p_device THEN
  RAISE EXCEPTION 'team_job_identity_mismatch' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO v_client FROM lr_agent_clients WHERE client_session_id=p_client_session FOR SHARE;
 IF NOT FOUND OR v_client.account_id<>p_actor OR v_client.closed_at IS NOT NULL
   OR v_client.expires_at<=v_now THEN
  RAISE EXCEPTION 'team_agent_session_unverified' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO v_grant FROM lr_ab_grants WHERE grant_id=p_grant_id FOR SHARE;
 IF NOT FOUND OR v_grant.account_id<>p_actor OR v_grant.device_id<>p_device
   OR v_grant.purpose<>'team-member' OR v_grant.closed_at IS NOT NULL
   OR v_grant.approved_at>v_now OR v_grant.expires_at<=v_now
   OR v_grant.absolute_expires_at<=v_now OR v_grant.agent_id IS DISTINCT FROM v_client.agent_id THEN
  RAISE EXCEPTION 'team_member_ab_approval_required' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO v_conn FROM lr_device_connections WHERE connection_id=v_grant.connection_id FOR SHARE;
 IF NOT FOUND OR v_conn.device_id<>p_device OR v_conn.account_id<>p_owner
   OR v_conn.closed_at IS NOT NULL OR v_conn.hard_expires_at<=v_now THEN
  RAISE EXCEPTION 'team_owner_connection_invalid' USING ERRCODE='check_violation'; END IF;
 SELECT call_limit INTO v_cap FROM lr_team_member_budgets
 WHERE owner_account_id=p_owner AND month_key=p_month FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'team_member_budget_unconfigured' USING ERRCODE='check_violation'; END IF;
 SELECT tool_calls INTO v_team_used FROM lr_team_member_monthly
 WHERE owner_account_id=p_owner AND month_key=p_month FOR UPDATE;
 IF NOT FOUND THEN v_team_used:=0; END IF;
 IF v_team_used+p_calls>v_cap THEN
  RAISE EXCEPTION 'team_member_monthly_budget_exceeded' USING ERRCODE='check_violation'; END IF;
 INSERT INTO lr_usage_events(event_id,owner_account_id,actor_account_id,device_id,
  job_id,month_key,tool_calls)
 VALUES(p_event,p_owner,p_actor,p_device,p_job,p_month,p_calls);
 INSERT INTO lr_usage_monthly(owner_account_id,month_key,tool_calls)
 VALUES(p_owner,p_month,p_calls)
 ON CONFLICT(owner_account_id,month_key)
 DO UPDATE SET tool_calls=lr_usage_monthly.tool_calls+EXCLUDED.tool_calls,updated_at=now();
 INSERT INTO lr_team_member_monthly(owner_account_id,month_key,tool_calls)
 VALUES(p_owner,p_month,p_calls)
 ON CONFLICT(owner_account_id,month_key)
 DO UPDATE SET tool_calls=lr_team_member_monthly.tool_calls+EXCLUDED.tool_calls,updated_at=now();
 RETURN TRUE;
END $$;
REVOKE EXECUTE ON FUNCTION lr_charge_team_member_uat(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,CHAR(7),INTEGER) FROM PUBLIC;
INSERT INTO lr_schema_migrations(version) VALUES(11) ON CONFLICT DO NOTHING;
COMMIT;
