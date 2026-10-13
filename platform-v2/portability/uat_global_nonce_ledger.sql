-- rc50 P0 / STRICT SYNTHETIC PG UAT ONLY, NOT a production migration.
-- Proves a single PostgreSQL transaction can serialize nonce+writer-epoch
-- claims across independent sessions. NO signature validation or real grant.
BEGIN;
CREATE TABLE lr_uat_replay_authority (
 account_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 writer_epoch BIGINT NOT NULL DEFAULT 1 CHECK(writer_epoch > 0),
 claim_generation BIGINT NOT NULL DEFAULT 0 CHECK(claim_generation >= 0),
 fenced BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY (account_id,device_id)
);
CREATE TABLE lr_uat_replay_producer (
 producer_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 key_sha256 TEXT NOT NULL CHECK(key_sha256 ~ '^[a-f0-9]{64}$'),
 state TEXT NOT NULL CHECK(state IN ('active','revoked')),
 FOREIGN KEY (account_id,device_id)
  REFERENCES lr_uat_replay_authority(account_id,device_id)
);
CREATE TABLE lr_uat_global_nonce_ledger (
 producer_id TEXT NOT NULL REFERENCES lr_uat_replay_producer(producer_id),
 nonce_hex TEXT NOT NULL CHECK(nonce_hex ~ '^[a-f0-9]{32}$'),
 request_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 writer_epoch BIGINT NOT NULL CHECK(writer_epoch>0),
 claim_generation BIGINT NOT NULL CHECK(claim_generation>0),
 message_sha256 TEXT NOT NULL CHECK(message_sha256 ~ '^[a-f0-9]{64}$'),
 signed_at TIMESTAMPTZ NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(producer_id,nonce_hex),
 UNIQUE(request_id),
 UNIQUE(account_id,device_id,claim_generation),
 FOREIGN KEY(account_id,device_id)
  REFERENCES lr_uat_replay_authority(account_id,device_id)
);
-- SECURITY INVOKER, NO client grants. No HMAC/Ed25519 is validated here.
CREATE FUNCTION lr_uat_record_global_nonce(
 p_producer_id TEXT,p_account_id TEXT,p_device_id TEXT,
 p_key_sha256 TEXT,p_nonce_hex TEXT,p_request_id TEXT,
 p_message_sha256 TEXT,p_writer_epoch BIGINT,p_signed_at TIMESTAMPTZ
) RETURNS BIGINT LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,public,pg_temp
AS $uat$
DECLARE a RECORD;
        new_gen BIGINT;
        instant TIMESTAMPTZ := clock_timestamp();
BEGIN
 IF p_key_sha256 !~ '^[a-f0-9]{64}$' OR
    p_message_sha256 !~ '^[a-f0-9]{64}$' OR
    p_nonce_hex !~ '^[a-f0-9]{32}$' OR
    p_request_id !~ '^uat_[A-Za-z0-9_-]{4,90}$' OR
    p_writer_epoch IS NULL OR p_writer_epoch<=0 THEN
  RAISE EXCEPTION 'uat_global_nonce_shape_invalid';
 END IF;
 IF p_signed_at IS NULL OR p_signed_at>instant OR
    p_signed_at<instant-interval '30 seconds' THEN
  RAISE EXCEPTION 'uat_global_nonce_window_invalid';
 END IF;
 -- SERIALIZATION POINT: one authority row per account/device. This row
 -- guarantees monotonic generations and correct epoch on one PG primary.
 SELECT a0.writer_epoch,a0.claim_generation,a0.fenced,
        p.state,p.key_sha256,p.account_id AS producer_account,
        p.device_id AS producer_device
 INTO a
 FROM lr_uat_replay_authority a0
 JOIN lr_uat_replay_producer p
   ON p.account_id=a0.account_id AND p.device_id=a0.device_id
 WHERE a0.account_id=p_account_id AND a0.device_id=p_device_id
   AND p.producer_id=p_producer_id
 FOR UPDATE OF a0,p;
 IF NOT FOUND THEN RAISE EXCEPTION 'uat_global_nonce_missing_scope'; END IF;
 IF a.fenced OR a.writer_epoch<>p_writer_epoch OR
    a.state<>'active' OR a.key_sha256<>p_key_sha256 OR
    a.producer_account<>p_account_id OR
    a.producer_device<>p_device_id THEN
  RAISE EXCEPTION 'uat_global_nonce_epoch_or_producer_denied';
 END IF;
 UPDATE lr_uat_replay_authority
    SET claim_generation=claim_generation+1
  WHERE account_id=p_account_id AND device_id=p_device_id
 RETURNING claim_generation INTO new_gen;
 IF NOT FOUND THEN RAISE EXCEPTION 'uat_global_nonce_authority_lost'; END IF;
 -- Unique producer/nonce and request constraints reject replay even across
 -- unrelated processes. On violation PostgreSQL rolls back this transaction,
 -- including the above generation increment.
 INSERT INTO lr_uat_global_nonce_ledger(
  producer_id,nonce_hex,request_id,account_id,device_id,
  writer_epoch,claim_generation,message_sha256,signed_at)
 VALUES(p_producer_id,p_nonce_hex,p_request_id,p_account_id,p_device_id,
  p_writer_epoch,new_gen,p_message_sha256,p_signed_at);
 RETURN new_gen;
END $uat$;
-- These objects are deliberately inaccessible to default PUBLIC users.
REVOKE ALL ON TABLE lr_uat_replay_authority,
 lr_uat_replay_producer,lr_uat_global_nonce_ledger FROM PUBLIC;
REVOKE ALL ON FUNCTION lr_uat_record_global_nonce(
 TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TIMESTAMPTZ) FROM PUBLIC;
COMMIT;
