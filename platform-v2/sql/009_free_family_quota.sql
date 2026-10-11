-- rc50 MJS-only synthetic UAT: account AND authenticated device-family Free cap.
-- No production data, no public family-assignment path, no member/team dispatch.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_free_families (
 family_id TEXT PRIMARY KEY CHECK(length(family_id) BETWEEN 1 AND 160),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lr_free_family_devices (
 device_id TEXT PRIMARY KEY REFERENCES lr_devices(device_id),
 family_id TEXT NOT NULL REFERENCES lr_free_families(family_id),
 enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_free_family_devices_family_idx ON lr_free_family_devices(family_id);
CREATE TABLE IF NOT EXISTS lr_free_family_monthly (
 family_id TEXT NOT NULL REFERENCES lr_free_families(family_id),
 month_key CHAR(7) NOT NULL CHECK(month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 tool_calls BIGINT NOT NULL DEFAULT 0 CHECK(tool_calls>=0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(family_id,month_key)
);
ALTER TABLE lr_usage_events ADD COLUMN IF NOT EXISTS free_family_id TEXT REFERENCES lr_free_families(family_id);
CREATE INDEX IF NOT EXISTS lr_usage_events_free_family_idx
 ON lr_usage_events(free_family_id,month_key) WHERE free_family_id IS NOT NULL;

-- Free connection/operator must have already resolved device identity and owner.
-- Family links are provisioned by a separate privileged, proof-verified enrollment
-- service (NOT implemented in this migration). No client family ID parameter.
CREATE OR REPLACE FUNCTION lr_charge_free_uat(
 p_event TEXT,p_owner TEXT,p_device TEXT,p_job TEXT,p_month CHAR(7),p_calls INTEGER DEFAULT 1)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
 v_account lr_accounts%ROWTYPE;
 v_device lr_devices%ROWTYPE;
 v_job lr_jobs%ROWTYPE;
 v_prior lr_usage_events%ROWTYPE;
 v_family TEXT;
 v_account_used BIGINT;
 v_family_used BIGINT;
BEGIN
 IF p_event IS NULL OR p_event !~ '^[A-Za-z0-9._:-]{1,160}$'
  OR p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9._:-]{1,128}$'
  OR p_device IS NULL OR p_device !~ '^[A-Za-z0-9._:-]{1,160}$'
  OR p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  OR p_calls IS NULL OR p_calls NOT BETWEEN 1 AND 10000 THEN
  RAISE EXCEPTION 'invalid_free_charge' USING ERRCODE='check_violation';
 END IF;
 -- Lock account and month before family, consistent across requests on one account.
 PERFORM pg_advisory_xact_lock(hashtextextended('lightremote:uat:usage:'||p_owner||':'||p_month,0));
 SELECT * INTO v_prior FROM lr_usage_events WHERE event_id=p_event;
 IF FOUND THEN
  IF v_prior.owner_account_id<>p_owner OR v_prior.actor_account_id<>p_owner
   OR v_prior.device_id IS DISTINCT FROM p_device
   OR v_prior.job_id IS DISTINCT FROM p_job
   OR v_prior.month_key<>p_month OR v_prior.tool_calls<>p_calls
   OR v_prior.free_family_id IS NULL THEN
   RAISE EXCEPTION 'free_event_payload_mismatch' USING ERRCODE='check_violation';
  END IF;
  RETURN FALSE;
 END IF;
 SELECT * INTO v_account FROM lr_accounts WHERE account_id=p_owner FOR SHARE;
 IF NOT FOUND OR v_account.status<>'active' OR v_account.plan<>'free' THEN
  RAISE EXCEPTION 'free_account_ineligible' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO v_device FROM lr_devices WHERE device_id=p_device FOR SHARE;
 IF NOT FOUND OR v_device.owner_account_id<>p_owner OR v_device.state='revoked' THEN
  RAISE EXCEPTION 'free_device_owner_mismatch' USING ERRCODE='check_violation'; END IF;
 IF p_job IS NOT NULL THEN
  SELECT * INTO v_job FROM lr_jobs WHERE job_id=p_job;
  IF NOT FOUND OR v_job.owner_account_id<>p_owner OR v_job.actor_account_id<>p_owner
   OR v_job.device_id<>p_device THEN
   RAISE EXCEPTION 'free_job_owner_mismatch' USING ERRCODE='check_violation'; END IF;
 END IF;
 SELECT family_id INTO v_family FROM lr_free_family_devices
  WHERE device_id=p_device FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'free_device_family_unverified' USING ERRCODE='check_violation'; END IF;
 -- Serialize different Free accounts bound to the same verified installation family.
 PERFORM pg_advisory_xact_lock(hashtextextended('lightremote:uat:free-family:'||v_family||':'||p_month,0));
 SELECT COALESCE(tool_calls,0) INTO v_account_used FROM lr_usage_monthly
  WHERE owner_account_id=p_owner AND month_key=p_month FOR UPDATE;
 IF NOT FOUND THEN v_account_used:=0; END IF;
 SELECT COALESCE(tool_calls,0) INTO v_family_used FROM lr_free_family_monthly
  WHERE family_id=v_family AND month_key=p_month FOR UPDATE;
 IF NOT FOUND THEN v_family_used:=0; END IF;
 IF v_account_used+p_calls > 10000 THEN
  RAISE EXCEPTION 'free_account_monthly_quota_exceeded' USING ERRCODE='check_violation'; END IF;
 IF v_family_used+p_calls > 10000 THEN
  RAISE EXCEPTION 'free_device_family_monthly_quota_exceeded' USING ERRCODE='check_violation'; END IF;
 INSERT INTO lr_usage_events(event_id,owner_account_id,actor_account_id,device_id,
    job_id,month_key,tool_calls,free_family_id)
  VALUES(p_event,p_owner,p_owner,p_device,p_job,p_month,p_calls,v_family);
 INSERT INTO lr_usage_monthly(owner_account_id,month_key,tool_calls)
  VALUES(p_owner,p_month,p_calls)
 ON CONFLICT(owner_account_id,month_key)
 DO UPDATE SET tool_calls=lr_usage_monthly.tool_calls+EXCLUDED.tool_calls,updated_at=now();
 INSERT INTO lr_free_family_monthly(family_id,month_key,tool_calls)
  VALUES(v_family,p_month,p_calls)
 ON CONFLICT(family_id,month_key)
 DO UPDATE SET tool_calls=lr_free_family_monthly.tool_calls+EXCLUDED.tool_calls,updated_at=now();
 RETURN TRUE;
END $$;
REVOKE EXECUTE ON FUNCTION lr_charge_free_uat(TEXT,TEXT,TEXT,TEXT,CHAR(7),INTEGER) FROM PUBLIC;
INSERT INTO lr_schema_migrations(version) VALUES (9) ON CONFLICT DO NOTHING;
COMMIT;
