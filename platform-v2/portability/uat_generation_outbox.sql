-- Light Remote rc50 synthetic-only generation-scoped outbox, isolated PG UAT.
-- DO NOT apply to production, public schema, or historical migrations.
-- No real Agent/PTY/webhook dispatch. Envelopes contain fake UAT payloads ONLY.
-- Requires uat_writer_epoch.sql installed and separate owner-authorized fencing.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_rc50_epoch_synthetic.command_outbox (
  command_id TEXT PRIMARY KEY CHECK (command_id ~ '^uat_cmd_[A-Za-z0-9_-]{4,80}$'),
  source_generation BIGINT NOT NULL CHECK (source_generation > 0),
  source_holder TEXT NOT NULL CHECK (source_holder ~ '^uat_[A-Za-z0-9_-]{4,80}$'),
  kind TEXT NOT NULL CHECK (kind IN ('fake_fleet','fake_webhook','fake_pty')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','acked')),
  claimed_by TEXT,
  claim_tag TEXT,
  claimed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  acknowledged_at TIMESTAMPTZ,
  CONSTRAINT uat_command_claim_shape CHECK (
    (status='queued' AND claimed_by IS NULL AND claim_tag IS NULL
      AND claimed_until IS NULL AND acknowledged_at IS NULL)
    OR (status='claimed' AND claimed_by IS NOT NULL AND claim_tag IS NOT NULL
      AND claimed_until IS NOT NULL AND acknowledged_at IS NULL)
    OR (status='acked' AND claimed_by IS NOT NULL AND claim_tag IS NOT NULL
      AND claimed_until IS NOT NULL AND acknowledged_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS uat_command_generation_ready
  ON lr_rc50_epoch_synthetic.command_outbox(source_generation,created_at,command_id)
  WHERE status='queued';

CREATE OR REPLACE FUNCTION lr_rc50_epoch_synthetic.enqueue_command_uat(
 p_holder TEXT,p_generation BIGINT,p_command_id TEXT,p_kind TEXT,p_payload JSONB
) RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE existing lr_rc50_epoch_synthetic.command_outbox%ROWTYPE;
BEGIN
 IF p_command_id IS NULL OR p_command_id !~ '^uat_cmd_[A-Za-z0-9_-]{4,80}$'
   OR p_kind IS NULL OR p_kind NOT IN ('fake_fleet','fake_webhook','fake_pty')
   OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
   OR pg_column_size(p_payload)>8192 THEN
  RAISE EXCEPTION 'uat_outbox_invalid_envelope' USING ERRCODE='check_violation';
 END IF;
 -- Holds FOR SHARE until COMMIT; fence gets FOR UPDATE on same singleton.
 IF NOT lr_rc50_epoch_synthetic.assert_writer_uat(p_holder,p_generation) THEN
  RAISE EXCEPTION 'uat_outbox_writer_fenced' USING ERRCODE='check_violation';
 END IF;
 INSERT INTO lr_rc50_epoch_synthetic.command_outbox(
  command_id,source_generation,source_holder,kind,payload)
 VALUES(p_command_id,p_generation,p_holder,p_kind,p_payload)
 ON CONFLICT (command_id) DO NOTHING;
 IF FOUND THEN RETURN 'queued'; END IF;
 SELECT * INTO existing FROM lr_rc50_epoch_synthetic.command_outbox
  WHERE command_id=p_command_id;
 IF existing.source_generation=p_generation AND existing.source_holder=p_holder
   AND existing.kind=p_kind AND existing.payload=p_payload THEN
  RETURN 'duplicate_same_envelope';
 END IF;
 RAISE EXCEPTION 'uat_outbox_command_id_conflict' USING ERRCODE='unique_violation';
END $$;

CREATE OR REPLACE FUNCTION lr_rc50_epoch_synthetic.claim_command_uat(
 p_holder TEXT,p_generation BIGINT,p_consumer TEXT,p_claim_tag TEXT,
 p_lease_seconds INTEGER DEFAULT 30
) RETURNS TABLE(out_command_id TEXT,out_generation BIGINT,out_kind TEXT,out_payload JSONB)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE row_id TEXT;
BEGIN
 IF p_consumer IS NULL OR p_consumer !~ '^uat_[A-Za-z0-9_-]{4,80}$'
  OR p_claim_tag IS NULL OR p_claim_tag !~ '^uat_tag_[A-Za-z0-9_-]{4,80}$'
  OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
  RAISE EXCEPTION 'uat_outbox_claim_invalid' USING ERRCODE='check_violation';
 END IF;
 IF NOT lr_rc50_epoch_synthetic.assert_writer_uat(p_holder,p_generation) THEN
  RAISE EXCEPTION 'uat_outbox_writer_fenced' USING ERRCODE='check_violation';
 END IF;
 SELECT c.command_id INTO row_id
 FROM lr_rc50_epoch_synthetic.command_outbox c
 WHERE c.source_generation=p_generation AND c.source_holder=p_holder
   AND c.status='queued'
 ORDER BY c.created_at,c.command_id
 FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY
  UPDATE lr_rc50_epoch_synthetic.command_outbox AS c
  SET status='claimed',claimed_by=p_consumer,claim_tag=p_claim_tag,
      claimed_until=clock_timestamp()+make_interval(secs=>p_lease_seconds)
  WHERE c.command_id=row_id AND c.status='queued'
  RETURNING c.command_id,c.source_generation,c.kind,c.payload;
END $$;

CREATE OR REPLACE FUNCTION lr_rc50_epoch_synthetic.ack_command_uat(
 p_holder TEXT,p_generation BIGINT,p_command_id TEXT,p_consumer TEXT,p_claim_tag TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NOT lr_rc50_epoch_synthetic.assert_writer_uat(p_holder,p_generation) THEN
  RETURN FALSE;
 END IF;
 UPDATE lr_rc50_epoch_synthetic.command_outbox c
 SET status='acked',acknowledged_at=clock_timestamp()
 WHERE c.command_id=p_command_id AND c.source_generation=p_generation
  AND c.source_holder=p_holder AND c.status='claimed'
  AND c.claimed_by=p_consumer AND c.claim_tag=p_claim_tag
  AND c.claimed_until>clock_timestamp();
 RETURN FOUND;
END $$;
COMMIT;
