-- rc50 synthetic-only PostgreSQL transaction UAT, NOT a product migration.
-- Prerequisite: uat_global_nonce_ledger.sql (same disposable PG primary).
-- A trusted fake verifier role may stage a Node-verified receipt; the issuer
-- role can ONLY execute the protected transaction, NEVER insert evidence.
-- SQL cannot validate Ed25519. A compromised staging role can forge proof.
BEGIN;
CREATE ROLE lr_uat_receipt_stage_role NOLOGIN NOINHERIT;
CREATE ROLE lr_uat_receipt_issuer_role NOLOGIN NOINHERIT;
CREATE ROLE lr_uat_receipt_tx_owner NOLOGIN NOINHERIT;

CREATE TABLE lr_uat_receipt_verifier_pin (
 verifier_id TEXT PRIMARY KEY,
 key_epoch BIGINT NOT NULL CHECK(key_epoch>0),
 public_key_sha256 TEXT NOT NULL CHECK(public_key_sha256~'^[a-f0-9]{64}$'),
 state TEXT NOT NULL CHECK(state IN ('active','revoked'))
);
CREATE TABLE lr_uat_receipt_request (
 request_id TEXT PRIMARY KEY,
 grant_id TEXT NOT NULL UNIQUE,
 account_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 owner_session_sha256 TEXT NOT NULL CHECK(owner_session_sha256~'^[a-f0-9]{64}$'),
 enrolled_key_sha256 TEXT NOT NULL CHECK(enrolled_key_sha256~'^[a-f0-9]{64}$'),
 wall_proof_sha256 TEXT NOT NULL CHECK(wall_proof_sha256~'^[a-f0-9]{64}$'),
 channel_ack_sha256 TEXT NOT NULL CHECK(channel_ack_sha256~'^[a-f0-9]{64}$'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','revoked')),
 owner_session_active BOOLEAN NOT NULL DEFAULT TRUE,
 device_active BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY(account_id,device_id)
  REFERENCES lr_uat_replay_authority(account_id,device_id)
);
CREATE TABLE lr_uat_receipt_verified_stage (
 receipt_id TEXT PRIMARY KEY CHECK(receipt_id~'^[a-f0-9]{32}$'),
 receipt_sha256 TEXT NOT NULL UNIQUE CHECK(receipt_sha256~'^[a-f0-9]{64}$'),
 verifier_id TEXT NOT NULL REFERENCES lr_uat_receipt_verifier_pin(verifier_id),
 verifier_key_epoch BIGINT NOT NULL CHECK(verifier_key_epoch>0),
 verifier_key_sha256 TEXT NOT NULL CHECK(verifier_key_sha256~'^[a-f0-9]{64}$'),
 request_id TEXT NOT NULL REFERENCES lr_uat_receipt_request(request_id),
 grant_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 owner_session_sha256 TEXT NOT NULL CHECK(owner_session_sha256~'^[a-f0-9]{64}$'),
 enrolled_key_sha256 TEXT NOT NULL CHECK(enrolled_key_sha256~'^[a-f0-9]{64}$'),
 wall_proof_sha256 TEXT NOT NULL CHECK(wall_proof_sha256~'^[a-f0-9]{64}$'),
 channel_ack_sha256 TEXT NOT NULL CHECK(channel_ack_sha256~'^[a-f0-9]{64}$'),
 producer_id TEXT NOT NULL,
 producer_key_sha256 TEXT NOT NULL CHECK(producer_key_sha256~'^[a-f0-9]{64}$'),
 nonce_hex TEXT NOT NULL CHECK(nonce_hex~'^[a-f0-9]{32}$'),
 message_sha256 TEXT NOT NULL CHECK(message_sha256~'^[a-f0-9]{64}$'),
 expected_writer_epoch BIGINT NOT NULL CHECK(expected_writer_epoch>0),
 expected_generation BIGINT NOT NULL CHECK(expected_generation>0),
 signed_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 claimed_at TIMESTAMPTZ
);
CREATE TABLE lr_uat_receipt_grant (
 grant_id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE REFERENCES lr_uat_receipt_request(request_id),
 receipt_id TEXT NOT NULL UNIQUE REFERENCES lr_uat_receipt_verified_stage(receipt_id),
 account_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 writer_epoch BIGINT NOT NULL,
 generation BIGINT NOT NULL,
 physical_execution_authorized BOOLEAN NOT NULL DEFAULT FALSE
  CHECK(physical_execution_authorized=FALSE),
 committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE lr_uat_receipt_provenance (
 receipt_id TEXT PRIMARY KEY REFERENCES lr_uat_receipt_verified_stage(receipt_id),
 grant_id TEXT NOT NULL UNIQUE REFERENCES lr_uat_receipt_grant(grant_id),
 receipt_sha256 TEXT NOT NULL,
 wall_proof_sha256 TEXT NOT NULL,
 channel_ack_sha256 TEXT NOT NULL
);
CREATE TABLE lr_uat_receipt_outbox (
 grant_id TEXT PRIMARY KEY REFERENCES lr_uat_receipt_grant(grant_id),
 receipt_id TEXT NOT NULL UNIQUE,
 writer_epoch BIGINT NOT NULL,
 generation BIGINT NOT NULL,
 physical_execution_authorized BOOLEAN NOT NULL DEFAULT FALSE
  CHECK(physical_execution_authorized=FALSE),
 delivered BOOLEAN NOT NULL DEFAULT FALSE CHECK(delivered=FALSE)
);
CREATE FUNCTION lr_uat_commit_staged_receipt(p_receipt_id TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $fn$
DECLARE s RECORD;
        n BIGINT;
        now_at TIMESTAMPTZ := clock_timestamp();
BEGIN
 IF p_receipt_id !~ '^[a-f0-9]{32}$' THEN
  RAISE EXCEPTION 'uat_receipt_id_shape_invalid';
 END IF;
 SELECT st.*,r.state AS request_state,r.grant_id AS expected_grant,
    r.account_id AS trusted_account,r.device_id AS trusted_device,
    r.owner_session_sha256 AS trusted_session,
    r.enrolled_key_sha256 AS trusted_enrollment,
    r.wall_proof_sha256 AS trusted_wall,
    r.channel_ack_sha256 AS trusted_channel,
    r.owner_session_active,r.device_active,
    k.state AS verifier_state,k.key_epoch AS trusted_key_epoch,
    k.public_key_sha256 AS trusted_key_pin
 INTO s FROM lr_uat_receipt_verified_stage st
 JOIN lr_uat_receipt_request r ON r.request_id=st.request_id
 JOIN lr_uat_receipt_verifier_pin k ON k.verifier_id=st.verifier_id
 WHERE st.receipt_id=p_receipt_id
 FOR UPDATE OF st,r FOR SHARE OF k;
 IF NOT FOUND THEN RAISE EXCEPTION 'uat_receipt_missing'; END IF;
 IF s.claimed_at IS NOT NULL OR s.request_state<>'pending' OR
    s.owner_session_active IS NOT TRUE OR s.device_active IS NOT TRUE THEN
  RAISE EXCEPTION 'uat_receipt_owner_or_request_revoked';
 END IF;
 IF s.verifier_state<>'active' OR
    s.verifier_key_epoch<>s.trusted_key_epoch OR
    s.verifier_key_sha256<>s.trusted_key_pin THEN
  RAISE EXCEPTION 'uat_receipt_verifier_key_revoked';
 END IF;
 IF s.grant_id<>s.expected_grant OR
    s.account_id<>s.trusted_account OR
    s.device_id<>s.trusted_device OR
    s.owner_session_sha256<>s.trusted_session OR
    s.enrolled_key_sha256<>s.trusted_enrollment OR
    s.wall_proof_sha256<>s.trusted_wall OR
    s.channel_ack_sha256<>s.trusted_channel THEN
  RAISE EXCEPTION 'uat_receipt_signed_authority_mismatch';
 END IF;
 IF s.signed_at>now_at OR s.signed_at<now_at-interval '10 seconds' OR
    s.expires_at<=now_at OR
    s.expires_at>s.signed_at+interval '10 seconds' THEN
  RAISE EXCEPTION 'uat_receipt_expired';
 END IF;
 -- SAME PostgreSQL transaction: claim nonce / monotonic epoch,
 -- grant+provenance+outbox and receipt consumption.
 n:=lr_uat_record_global_nonce(
   s.producer_id,s.account_id,s.device_id,s.producer_key_sha256,
   s.nonce_hex,s.request_id,s.message_sha256,
   s.expected_writer_epoch,s.signed_at);
 IF n<>s.expected_generation THEN
  RAISE EXCEPTION 'uat_receipt_next_generation_mismatch';
 END IF;
 INSERT INTO lr_uat_receipt_grant(
  grant_id,request_id,receipt_id,account_id,device_id,
  writer_epoch,generation)
 VALUES(s.grant_id,s.request_id,s.receipt_id,s.account_id,
  s.device_id,s.expected_writer_epoch,n);
 INSERT INTO lr_uat_receipt_provenance(
  receipt_id,grant_id,receipt_sha256,wall_proof_sha256,channel_ack_sha256)
 VALUES(s.receipt_id,s.grant_id,s.receipt_sha256,
  s.wall_proof_sha256,s.channel_ack_sha256);
 INSERT INTO lr_uat_receipt_outbox(
  grant_id,receipt_id,writer_epoch,generation)
 VALUES(s.grant_id,s.receipt_id,s.expected_writer_epoch,n);
 UPDATE lr_uat_receipt_request SET state='approved'
  WHERE request_id=s.request_id;
 UPDATE lr_uat_receipt_verified_stage SET claimed_at=now_at
  WHERE receipt_id=s.receipt_id AND claimed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'uat_receipt_consume_lost'; END IF;
 RETURN n;
END $fn$;
REVOKE ALL ON TABLE lr_uat_receipt_verifier_pin,lr_uat_receipt_request,
 lr_uat_receipt_verified_stage,lr_uat_receipt_grant,
 lr_uat_receipt_provenance,lr_uat_receipt_outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION lr_uat_commit_staged_receipt(TEXT) FROM PUBLIC;
-- Only the offline fake verification identity can STAGE. It cannot issue.
GRANT INSERT ON lr_uat_receipt_verified_stage TO lr_uat_receipt_stage_role;
-- Dedicated restricted owner has only object grants needed by wrapper.
GRANT SELECT ON lr_uat_receipt_verified_stage,lr_uat_receipt_request,
 lr_uat_receipt_verifier_pin,lr_uat_replay_authority,
 lr_uat_replay_producer TO lr_uat_receipt_tx_owner;
-- PostgreSQL row-lock SELECT FOR SHARE also needs UPDATE privileges.
-- This restricted SECDEF owner is NOLOGIN; issuer gets EXECUTE only.
GRANT UPDATE ON lr_uat_receipt_verified_stage,lr_uat_receipt_request,
 lr_uat_receipt_verifier_pin,lr_uat_replay_authority,
 lr_uat_replay_producer TO lr_uat_receipt_tx_owner;
GRANT INSERT ON lr_uat_global_nonce_ledger,lr_uat_receipt_grant,
 lr_uat_receipt_provenance,lr_uat_receipt_outbox TO lr_uat_receipt_tx_owner;
GRANT EXECUTE ON FUNCTION lr_uat_record_global_nonce(
 TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TIMESTAMPTZ)
 TO lr_uat_receipt_tx_owner;
ALTER FUNCTION lr_uat_commit_staged_receipt(TEXT)
 OWNER TO lr_uat_receipt_tx_owner;
GRANT EXECUTE ON FUNCTION lr_uat_commit_staged_receipt(TEXT)
 TO lr_uat_receipt_issuer_role;
COMMIT;
