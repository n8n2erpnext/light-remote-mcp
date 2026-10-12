-- rc50 portability P0: ISOLATED SYNTHETIC UAT WRITER EPOCH.
-- NOT part of immutable migrations 001..013; NEVER apply to production.
-- All objects confined to lr_rc50_epoch_synthetic. SECURITY INVOKER only.
-- This SQL illustrates a DB transaction barrier; external JSON, HTTP,
-- OAuth, Fleet and PTY side effects are NOT protected by this alone.
BEGIN;
CREATE SCHEMA IF NOT EXISTS lr_rc50_epoch_synthetic;

CREATE TABLE IF NOT EXISTS lr_rc50_epoch_synthetic.writer_authority (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  generation BIGINT NOT NULL CHECK (generation BETWEEN 1 AND 9223372036854775806),
  state TEXT NOT NULL CHECK (state IN ('fenced','active')),
  holder TEXT,
  lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT epoch_shape CHECK (
    (state='fenced' AND holder IS NULL AND lease_until IS NULL)
    OR (state='active' AND holder IS NOT NULL AND lease_until IS NOT NULL)
  )
);
INSERT INTO lr_rc50_epoch_synthetic.writer_authority(id,generation,state,holder,lease_until)
VALUES (1,1,'fenced',NULL,NULL) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION lr_rc50_epoch_synthetic.start_writer_uat(
 p_holder TEXT,p_expected BIGINT,p_lease_seconds INTEGER DEFAULT 60
) RETURNS BIGINT LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v lr_rc50_epoch_synthetic.writer_authority%ROWTYPE;
BEGIN
 IF p_holder IS NULL OR p_holder !~ '^uat_[A-Za-z0-9_-]{4,80}$'
   OR p_expected IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
  RAISE EXCEPTION 'invalid_uat_writer_claim' USING ERRCODE='check_violation';
 END IF;
 SELECT * INTO v FROM lr_rc50_epoch_synthetic.writer_authority
  WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR v.state<>'fenced' OR v.generation<>p_expected THEN
  RAISE EXCEPTION 'uat_writer_not_fenced_or_stale' USING ERRCODE='check_violation';
 END IF;
 UPDATE lr_rc50_epoch_synthetic.writer_authority
  SET generation=v.generation+1,state='active',holder=p_holder,
  lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
  updated_at=clock_timestamp() WHERE id=1;
 RETURN v.generation+1;
END $$;

-- The caller MUST call this within the SAME PostgreSQL transaction
-- as every authoritative DB mutation. The row lock is held to COMMIT,
-- serializing the mutation with any concurrent revoke/fence.
CREATE OR REPLACE FUNCTION lr_rc50_epoch_synthetic.assert_writer_uat(
 p_holder TEXT,p_generation BIGINT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v lr_rc50_epoch_synthetic.writer_authority%ROWTYPE;
BEGIN
 SELECT * INTO v FROM lr_rc50_epoch_synthetic.writer_authority
  WHERE id=1 FOR SHARE;
 RETURN FOUND AND v.state='active' AND v.holder=p_holder
  AND v.generation=p_generation AND v.lease_until>clock_timestamp();
END $$;

CREATE OR REPLACE FUNCTION lr_rc50_epoch_synthetic.renew_writer_uat(
 p_holder TEXT,p_generation BIGINT,p_lease_seconds INTEGER DEFAULT 60
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v lr_rc50_epoch_synthetic.writer_authority%ROWTYPE;
BEGIN
 IF p_lease_seconds NOT BETWEEN 5 AND 300 THEN RETURN FALSE; END IF;
 SELECT * INTO v FROM lr_rc50_epoch_synthetic.writer_authority
  WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR v.state<>'active' OR v.holder IS DISTINCT FROM p_holder
   OR v.generation<>p_generation OR v.lease_until<=clock_timestamp() THEN
  RETURN FALSE;
 END IF;
 UPDATE lr_rc50_epoch_synthetic.writer_authority
  SET lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
  updated_at=clock_timestamp() WHERE id=1;
 RETURN TRUE;
END $$;

-- Synthetic owner-approved fence: the caller is not authenticated by
-- this SQL. Production requires separately authorized owner control,
-- restricted execution and consensus over all external writer lanes.
CREATE OR REPLACE FUNCTION lr_rc50_epoch_synthetic.fence_writer_uat(
 p_expected BIGINT
) RETURNS BIGINT LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v lr_rc50_epoch_synthetic.writer_authority%ROWTYPE;
BEGIN
 SELECT * INTO v FROM lr_rc50_epoch_synthetic.writer_authority
  WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR p_expected IS NULL OR v.generation<>p_expected OR
    v.generation>=9223372036854775805 THEN
  RAISE EXCEPTION 'uat_fence_stale_generation' USING ERRCODE='check_violation';
 END IF;
 UPDATE lr_rc50_epoch_synthetic.writer_authority
  SET generation=v.generation+1,state='fenced',holder=NULL,
  lease_until=NULL,updated_at=clock_timestamp() WHERE id=1;
 RETURN v.generation+1;
END $$;
COMMIT;
