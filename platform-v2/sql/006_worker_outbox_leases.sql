-- rc50-v2 UAT only: lease/fence worker claims and outbox retries. Never dispatch live jobs.
BEGIN;
ALTER TABLE lr_jobs ADD COLUMN IF NOT EXISTS lease_slot SMALLINT;
ALTER TABLE lr_jobs ADD COLUMN IF NOT EXISTS lease_generation BIGINT NOT NULL DEFAULT 0;
ALTER TABLE lr_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE lr_jobs ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lr_jobs ADD COLUMN IF NOT EXISTS last_error TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS lr_worker_one_job_per_slot ON lr_worker_slots(job_id) WHERE job_id IS NOT NULL;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='lr_worker_slots'::regclass AND conname='lr_worker_slot_all_or_none') THEN
  ALTER TABLE lr_worker_slots ADD CONSTRAINT lr_worker_slot_all_or_none
  CHECK ((job_id IS NULL AND lease_token_sha256 IS NULL AND expires_at IS NULL)
    OR (job_id IS NOT NULL AND lease_token_sha256 IS NOT NULL AND expires_at IS NOT NULL));
 END IF;
END $$;
ALTER TABLE lr_outbox ADD COLUMN IF NOT EXISTS lease_generation BIGINT NOT NULL DEFAULT 0;
ALTER TABLE lr_outbox ADD COLUMN IF NOT EXISTS leased_by TEXT;
ALTER TABLE lr_outbox ADD COLUMN IF NOT EXISTS leased_until TIMESTAMPTZ;
ALTER TABLE lr_outbox ADD COLUMN IF NOT EXISTS last_error TEXT;
CREATE INDEX IF NOT EXISTS lr_outbox_ready_idx ON lr_outbox(visible_at,outbox_id) WHERE delivered_at IS NULL;

CREATE OR REPLACE FUNCTION lr_claim_worker_slot(p_device TEXT,p_job TEXT,p_hash TEXT,p_seconds INTEGER DEFAULT 120)
RETURNS TABLE(slot_number SMALLINT,generation BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE j lr_jobs%ROWTYPE; d lr_devices%ROWTYPE; s lr_worker_slots%ROWTYPE;
 stamp TIMESTAMPTZ:=clock_timestamp();
BEGIN
 IF p_hash !~ '^[0-9a-f]{64}$' OR p_seconds NOT BETWEEN 5 AND 900 THEN
  RAISE EXCEPTION 'invalid_lease_claim' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO j FROM lr_jobs WHERE job_id=p_job FOR UPDATE;
 IF NOT FOUND OR j.state<>'queued' OR j.device_id<>p_device THEN
  RAISE EXCEPTION 'job_unavailable_for_claim' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO d FROM lr_devices WHERE device_id=p_device FOR UPDATE;
 IF NOT FOUND OR d.state='revoked' OR d.owner_account_id<>j.owner_account_id THEN
  RAISE EXCEPTION 'device_owner_mismatch' USING ERRCODE='check_violation'; END IF;
 -- Cross-account real dispatch is not authorized by this UAT function.
 IF j.actor_account_id<>j.owner_account_id THEN
  RAISE EXCEPTION 'member_dispatch_requires_trusted_proof' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO s FROM lr_worker_slots WHERE device_id=p_device
   AND (job_id IS NULL OR expires_at<=stamp)
   ORDER BY slot_number FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 IF s.job_id IS NOT NULL THEN
  UPDATE lr_jobs SET state='lease_expired',finished_at=stamp,lease_expires_at=NULL,
    last_error='lease_expired' WHERE job_id=s.job_id AND state='running';
  INSERT INTO lr_outbox(topic,aggregate_id,payload)
   VALUES('job_lease_expired',s.job_id,jsonb_build_object('jobId',s.job_id,
    'deviceId',p_device,'slot',s.slot_number,'generation',s.generation));
 END IF;
 UPDATE lr_worker_slots ws SET job_id=p_job,generation=s.generation+1,
  lease_token_sha256=p_hash,expires_at=stamp+make_interval(secs=>p_seconds)
  WHERE ws.device_id=p_device AND ws.slot_number=s.slot_number;
 UPDATE lr_jobs SET state='running',lease_slot=s.slot_number,
  lease_generation=s.generation+1,lease_expires_at=stamp+make_interval(secs=>p_seconds),
  attempt_count=attempt_count+1 WHERE job_id=p_job;
 slot_number:=s.slot_number;generation:=s.generation+1;
 RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION lr_renew_worker_lease(p_job TEXT,p_hash TEXT,p_generation BIGINT,p_seconds INTEGER DEFAULT 120)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE j lr_jobs%ROWTYPE; stamp TIMESTAMPTZ:=clock_timestamp(); next_exp TIMESTAMPTZ;
BEGIN
 IF p_seconds NOT BETWEEN 5 AND 900 OR p_hash !~ '^[0-9a-f]{64}$' THEN RETURN FALSE; END IF;
 SELECT * INTO j FROM lr_jobs WHERE job_id=p_job FOR UPDATE;
 IF NOT FOUND OR j.state<>'running' OR j.lease_generation<>p_generation
  OR j.lease_expires_at<=stamp OR j.lease_slot IS NULL THEN RETURN FALSE; END IF;
 next_exp:=LEAST(stamp+make_interval(secs=>p_seconds),j.created_at+interval '1 hour');
 IF next_exp<=stamp THEN RETURN FALSE; END IF;
 UPDATE lr_worker_slots SET expires_at=next_exp WHERE device_id=j.device_id
  AND slot_number=j.lease_slot AND job_id=p_job AND generation=p_generation
  AND lease_token_sha256=p_hash AND expires_at>stamp;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 UPDATE lr_jobs SET lease_expires_at=next_exp WHERE job_id=p_job;
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION lr_finish_worker_job(p_job TEXT,p_hash TEXT,p_generation BIGINT,p_succeeded BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE j lr_jobs%ROWTYPE; stamp TIMESTAMPTZ:=clock_timestamp();
BEGIN
 IF p_hash !~ '^[0-9a-f]{64}$' THEN RETURN FALSE; END IF;
 SELECT * INTO j FROM lr_jobs WHERE job_id=p_job FOR UPDATE;
 IF NOT FOUND OR j.state<>'running' OR j.lease_generation<>p_generation
  OR j.lease_expires_at<=stamp OR j.lease_slot IS NULL THEN RETURN FALSE; END IF;
 UPDATE lr_worker_slots SET job_id=NULL,lease_token_sha256=NULL,expires_at=NULL
  WHERE device_id=j.device_id AND slot_number=j.lease_slot AND job_id=p_job
  AND generation=p_generation AND lease_token_sha256=p_hash AND expires_at>stamp;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 UPDATE lr_jobs SET state=CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
  finished_at=stamp,lease_expires_at=NULL WHERE job_id=p_job;
 INSERT INTO lr_outbox(topic,aggregate_id,payload)
  VALUES('job_finished',p_job,jsonb_build_object('jobId',p_job,
    'succeeded',p_succeeded,'generation',p_generation));
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION lr_claim_outbox(p_consumer TEXT,p_limit INTEGER DEFAULT 10,p_seconds INTEGER DEFAULT 60)
RETURNS TABLE(outbox_id BIGINT,topic TEXT,aggregate_id TEXT,payload JSONB,lease_generation BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF p_consumer !~ '^[A-Za-z0-9._:-]{1,128}$' OR p_limit NOT BETWEEN 1 AND 100
  OR p_seconds NOT BETWEEN 5 AND 600 THEN
  RAISE EXCEPTION 'invalid_outbox_claim' USING ERRCODE='check_violation'; END IF;
 RETURN QUERY WITH grabbed AS (
  SELECT o.outbox_id FROM lr_outbox o WHERE o.delivered_at IS NULL
    AND o.visible_at<=clock_timestamp()
    AND (o.leased_until IS NULL OR o.leased_until<=clock_timestamp())
  ORDER BY o.visible_at,o.outbox_id FOR UPDATE SKIP LOCKED LIMIT p_limit
 ) UPDATE lr_outbox o SET leased_by=p_consumer,
    leased_until=clock_timestamp()+make_interval(secs=>p_seconds),
    lease_generation=o.lease_generation+1,attempts=o.attempts+1
   FROM grabbed g WHERE o.outbox_id=g.outbox_id
   RETURNING o.outbox_id,o.topic,o.aggregate_id,o.payload,o.lease_generation;
END $$;

CREATE OR REPLACE FUNCTION lr_ack_outbox(p_id BIGINT,p_consumer TEXT,p_generation BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 UPDATE lr_outbox SET delivered_at=clock_timestamp(),leased_by=NULL,leased_until=NULL
  WHERE outbox_id=p_id AND leased_by=p_consumer AND lease_generation=p_generation
   AND leased_until>clock_timestamp() AND delivered_at IS NULL;
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION lr_retry_outbox(p_id BIGINT,p_consumer TEXT,p_generation BIGINT,
 p_delay_seconds INTEGER,p_error TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF p_delay_seconds NOT BETWEEN 1 AND 3600 THEN RETURN FALSE; END IF;
 UPDATE lr_outbox SET leased_until=NULL,leased_by=NULL,
  visible_at=clock_timestamp()+make_interval(secs=>p_delay_seconds),
  last_error=left(COALESCE(p_error,'unknown'),256)
  WHERE outbox_id=p_id AND leased_by=p_consumer AND lease_generation=p_generation
   AND leased_until>clock_timestamp() AND delivered_at IS NULL;
 RETURN FOUND;
END $$;
INSERT INTO lr_schema_migrations(version) VALUES(6) ON CONFLICT DO NOTHING;
COMMIT;
