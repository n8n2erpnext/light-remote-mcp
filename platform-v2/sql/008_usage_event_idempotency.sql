-- UAT-only accounting guard, no production integration.
-- Billable event_id is unique, but a job may emit MANY billable events.
BEGIN;
DROP INDEX IF EXISTS lr_usage_job_once;
CREATE INDEX IF NOT EXISTS lr_usage_by_job ON lr_usage_events(job_id) WHERE job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lr_usage_budgets (
 owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
 month_key CHAR(7) NOT NULL CHECK(month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 call_limit BIGINT NOT NULL CHECK(call_limit>=0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_account_id,month_key)
);

CREATE OR REPLACE FUNCTION lr_charge_usage_uat(
 p_event TEXT,p_owner TEXT,p_actor TEXT,p_device TEXT,p_job TEXT,
 p_month CHAR(7),p_calls INTEGER DEFAULT 1)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
 v_account lr_accounts%ROWTYPE;
 v_device lr_devices%ROWTYPE;
 v_job lr_jobs%ROWTYPE;
 v_prior lr_usage_events%ROWTYPE;
 v_cap BIGINT;
 v_used BIGINT;
BEGIN
 IF p_event !~ '^[A-Za-z0-9._:-]{1,160}$'
  OR p_owner !~ '^[A-Za-z0-9._:-]{1,128}$'
  OR p_actor !~ '^[A-Za-z0-9._:-]{1,128}$'
  OR p_device IS NULL OR p_device !~ '^[A-Za-z0-9._:-]{1,160}$'
  OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  OR p_calls NOT BETWEEN 1 AND 10000 THEN
  RAISE EXCEPTION 'invalid_uat_charge' USING ERRCODE='check_violation';
 END IF;
 -- Do not authorize Team member dispatch without an independently verified A/B proof.
 IF p_actor<>p_owner THEN
  RAISE EXCEPTION 'member_charge_requires_trusted_proof' USING ERRCODE='check_violation';
 END IF;
 -- Serialize all charges within the same owner/month, including absent aggregate rows.
 PERFORM pg_advisory_xact_lock(hashtextextended('lightremote:uat:usage:'||p_owner||':'||p_month,0));
 SELECT * INTO v_prior FROM lr_usage_events WHERE event_id=p_event;
 IF FOUND THEN
  IF v_prior.owner_account_id<>p_owner OR v_prior.actor_account_id<>p_actor
   OR v_prior.device_id IS DISTINCT FROM p_device
   OR v_prior.job_id IS DISTINCT FROM p_job
   OR v_prior.month_key<>p_month OR v_prior.tool_calls<>p_calls THEN
   RAISE EXCEPTION 'usage_idempotency_payload_mismatch' USING ERRCODE='check_violation';
  END IF;
  RETURN FALSE;
 END IF;
 SELECT * INTO v_account FROM lr_accounts WHERE account_id=p_owner FOR SHARE;
 IF NOT FOUND OR v_account.status<>'active' THEN
  RAISE EXCEPTION 'owner_account_not_active' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO v_device FROM lr_devices WHERE device_id=p_device FOR SHARE;
 IF NOT FOUND OR v_device.owner_account_id<>p_owner OR v_device.state='revoked' THEN
  RAISE EXCEPTION 'usage_device_owner_mismatch' USING ERRCODE='check_violation'; END IF;
 IF p_job IS NOT NULL THEN
  SELECT * INTO v_job FROM lr_jobs WHERE job_id=p_job;
  IF NOT FOUND OR v_job.owner_account_id<>p_owner
   OR v_job.actor_account_id<>p_actor OR v_job.device_id<>p_device THEN
   RAISE EXCEPTION 'usage_job_owner_mismatch' USING ERRCODE='check_violation';
  END IF;
 END IF;
 SELECT call_limit INTO v_cap FROM lr_usage_budgets
  WHERE owner_account_id=p_owner AND month_key=p_month FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'usage_budget_not_configured' USING ERRCODE='check_violation'; END IF;
 SELECT COALESCE(tool_calls,0) INTO v_used FROM lr_usage_monthly
  WHERE owner_account_id=p_owner AND month_key=p_month FOR UPDATE;
 IF NOT FOUND THEN v_used:=0; END IF;
 IF v_used+p_calls > v_cap THEN
  RAISE EXCEPTION 'monthly_call_quota_exceeded' USING ERRCODE='check_violation'; END IF;
 INSERT INTO lr_usage_events(
  event_id,owner_account_id,actor_account_id,device_id,job_id,month_key,tool_calls)
 VALUES(p_event,p_owner,p_actor,p_device,p_job,p_month,p_calls);
 INSERT INTO lr_usage_monthly(owner_account_id,month_key,tool_calls)
  VALUES(p_owner,p_month,p_calls)
 ON CONFLICT(owner_account_id,month_key) DO UPDATE SET
  tool_calls=lr_usage_monthly.tool_calls+EXCLUDED.tool_calls,updated_at=now();
 RETURN TRUE;
END $$;

REVOKE EXECUTE ON FUNCTION lr_charge_usage_uat(TEXT,TEXT,TEXT,TEXT,TEXT,CHAR(7),INTEGER) FROM PUBLIC;
INSERT INTO lr_schema_migrations(version) VALUES (8) ON CONFLICT DO NOTHING;
COMMIT;
