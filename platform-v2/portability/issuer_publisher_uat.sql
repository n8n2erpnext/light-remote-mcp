-- rc50 signing publisher/ACK UAT. ISOLATED SCRATCH POSTGRES ONLY.
-- Apply AFTER 001-013 and issuer_origin_uat.sql in throwaway Compose project.
-- Signatures are produced externally in an ephemeral Node fixture, never SQL.
-- This is not a production migration, issuer, key manager or device ACK proof.
BEGIN;
CREATE TABLE lr_uat_issuer_pin (
  issuer_id TEXT PRIMARY KEY CHECK(issuer_id='synthetic_only'),
  public_key_sha256 TEXT NOT NULL CHECK(public_key_sha256 ~ '^[a-f0-9]{64}$'),
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);
ALTER TABLE lr_uat_lease_signing_outbox
  ADD COLUMN claim_owner TEXT,
  ADD COLUMN claim_token TEXT,
  ADD COLUMN claim_seq BIGINT NOT NULL DEFAULT 0 CHECK(claim_seq>=0),
  ADD COLUMN claim_expires_at TIMESTAMPTZ,
  ADD COLUMN signature_b64url TEXT,
  ADD COLUMN signature_digest_sha256 TEXT,
  ADD COLUMN issuer_public_key_sha256 TEXT,
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD COLUMN signed_at TIMESTAMPTZ;
CREATE TABLE lr_uat_lease_delivery_ack (
  request_id TEXT PRIMARY KEY REFERENCES lr_uat_lease_signing_outbox(request_id),
  grant_id TEXT NOT NULL REFERENCES lr_ab_grants(grant_id),
  signed_digest_sha256 TEXT NOT NULL CHECK(signed_digest_sha256 ~ '^[a-f0-9]{64}$'),
  nonce_sha256 TEXT NOT NULL UNIQUE CHECK(nonce_sha256 ~ '^[a-f0-9]{64}$'),
  device_public_key_sha256 TEXT NOT NULL CHECK(device_public_key_sha256 ~ '^[a-f0-9]{64}$'),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION lr_uat_claim_signing(p_worker TEXT,p_token TEXT)
RETURNS TABLE(out_request_id TEXT,out_grant_id TEXT,out_generation BIGINT,
  out_grant_revision BIGINT,out_device_id TEXT,out_device_key_sha256 TEXT,
  out_account_id TEXT,out_agent_id TEXT,out_connection_id TEXT,
  out_grant_expires_at TIMESTAMPTZ,out_claim_seq BIGINT)
LANGUAGE plpgsql AS $lr_uat$
DECLARE now_stamp TIMESTAMPTZ := clock_timestamp();
BEGIN
 IF p_worker !~ '^uat_[A-Za-z0-9_-]{5,100}$'
    OR p_token !~ '^uat_[A-Za-z0-9_-]{10,130}$' THEN
   RAISE EXCEPTION 'uat_invalid_claim_identity';
 END IF;
 -- Superseded generations may not sign, even if original outbox is pending.
 UPDATE lr_uat_lease_signing_outbox o SET status='canceled',
     claim_token=NULL,claim_owner=NULL,claim_expires_at=NULL
 FROM lr_uat_grant_provenance p
 JOIN lr_uat_device_authority_floor f ON f.device_id=p.device_id
 WHERE o.request_id=p.request_id AND o.status='pending'
 AND p.generation < f.generation;
 RETURN QUERY
 WITH target AS (
   SELECT o.request_id
   FROM lr_uat_lease_signing_outbox o
   JOIN lr_uat_grant_provenance p ON p.request_id=o.request_id
   JOIN lr_uat_device_authority_floor f ON f.device_id=p.device_id
   JOIN lr_ab_grants g ON g.grant_id=p.grant_id
   JOIN lr_uat_device_enrolled_key ek ON ek.device_id=p.device_id
   WHERE o.status='pending'
     AND (o.claim_expires_at IS NULL OR o.claim_expires_at<=now_stamp)
     AND p.generation=f.generation
     AND p.grant_revision=f.grant_revision
     AND ek.state='active' AND ek.public_key_sha256=p.public_key_sha256
     AND g.closed_at IS NULL AND g.expires_at>now_stamp
     AND g.absolute_expires_at>now_stamp
   ORDER BY o.created_at DESC,o.request_id
   FOR UPDATE OF o, f SKIP LOCKED
   LIMIT 1
 ), claimed AS (
   UPDATE lr_uat_lease_signing_outbox o
   SET claim_owner=p_worker,claim_token=p_token,
       claim_seq=o.claim_seq+1,
       claim_expires_at=now_stamp+interval '30 seconds'
   FROM target t
   WHERE o.request_id=t.request_id AND o.status='pending'
   RETURNING o.request_id,o.grant_id,o.claim_seq
 )
 SELECT c.request_id,c.grant_id,p.generation,p.grant_revision,
        p.device_id,p.public_key_sha256,g.account_id,g.agent_id,
        g.connection_id,g.absolute_expires_at,c.claim_seq
 FROM claimed c
 JOIN lr_uat_grant_provenance p ON p.request_id=c.request_id
 JOIN lr_ab_grants g ON g.grant_id=c.grant_id;
END $lr_uat$;

CREATE OR REPLACE FUNCTION lr_uat_finalize_signing(
 p_request_id TEXT,p_claim_token TEXT,p_claim_seq BIGINT,
 p_signature_b64url TEXT,p_signature_digest TEXT,
 p_issuer_key_sha256 TEXT,p_lease_expires_at TIMESTAMPTZ
) RETURNS TEXT LANGUAGE plpgsql AS $lr_uat$
DECLARE rec RECORD;
        now_stamp TIMESTAMPTZ := clock_timestamp();
BEGIN
 SELECT o.status,o.claim_token,o.claim_seq,o.claim_expires_at,
        p.generation,p.grant_revision,p.public_key_sha256,
        f.generation AS current_generation,
        f.grant_revision AS current_revision,
        g.expires_at,g.absolute_expires_at,g.closed_at,
        ek.state AS enrolled_state,ek.public_key_sha256 AS enrolled_key,
        pin.enabled,pin.public_key_sha256 AS trusted_issuer_key
 INTO rec
 FROM lr_uat_lease_signing_outbox o
 JOIN lr_uat_grant_provenance p ON p.request_id=o.request_id
 JOIN lr_uat_device_authority_floor f ON f.device_id=p.device_id
 JOIN lr_ab_grants g ON g.grant_id=o.grant_id
 JOIN lr_uat_device_enrolled_key ek ON ek.device_id=p.device_id
 JOIN lr_uat_issuer_pin pin ON pin.issuer_id='synthetic_only'
 WHERE o.request_id=p_request_id
 FOR UPDATE OF o,f,g,ek,pin;
 IF NOT FOUND THEN RAISE EXCEPTION 'uat_signing_claim_not_found'; END IF;
 IF rec.status<>'pending' OR rec.claim_token IS DISTINCT FROM p_claim_token
    OR rec.claim_seq<>p_claim_seq OR rec.claim_expires_at<=now_stamp
    OR rec.claim_expires_at IS NULL THEN
   RAISE EXCEPTION 'uat_stale_or_duplicate_signing_claim';
 END IF;
 IF rec.generation<>rec.current_generation OR
    rec.grant_revision<>rec.current_revision OR
    rec.closed_at IS NOT NULL OR rec.expires_at<=now_stamp OR
    rec.absolute_expires_at<=now_stamp OR
    rec.enrolled_state<>'active' OR
    rec.enrolled_key<>rec.public_key_sha256 THEN
   RAISE EXCEPTION 'uat_writer_generation_or_grant_fenced';
 END IF;
 IF rec.enabled IS DISTINCT FROM TRUE OR
    rec.trusted_issuer_key<>p_issuer_key_sha256 OR
    p_issuer_key_sha256 !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'uat_issuer_signer_key_not_pinned';
 END IF;
 -- Application service MUST verify signature against immutable provenance
 -- before invoking. PostgreSQL does NOT cryptographically verify Ed25519.
 IF p_signature_b64url !~ '^[A-Za-z0-9_-]{86}$'
    OR p_signature_digest !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'uat_signature_fixture_malformed';
 END IF;
 IF p_lease_expires_at<=now_stamp OR
    p_lease_expires_at>now_stamp+interval '30 seconds' OR
    p_lease_expires_at>rec.expires_at OR
    p_lease_expires_at>rec.absolute_expires_at THEN
   RAISE EXCEPTION 'uat_lease_ttl_exceeds_grant';
 END IF;
 UPDATE lr_uat_lease_signing_outbox
 SET status='signed',signed_digest_sha256=p_signature_digest,
     signature_b64url=p_signature_b64url,
     signature_digest_sha256=p_signature_digest,
     issuer_public_key_sha256=p_issuer_key_sha256,
     lease_expires_at=p_lease_expires_at,signed_at=now_stamp,
     claim_expires_at=NULL
 WHERE request_id=p_request_id;
 RETURN 'SYNTHETIC_SIGNATURE_COMMITTED_PENDING_ACK';
END $lr_uat$;

CREATE OR REPLACE FUNCTION lr_uat_ack_signed_lease(
 p_request_id TEXT,p_grant_id TEXT,p_signed_digest TEXT,
 p_device_key_sha256 TEXT,p_nonce_sha256 TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $lr_uat$
DECLARE rec RECORD;
        previous RECORD;
        now_stamp TIMESTAMPTZ := clock_timestamp();
BEGIN
 SELECT o.status,o.grant_id,o.signed_digest_sha256,o.lease_expires_at,
        p.device_id,p.generation,p.grant_revision,
        f.generation AS floor_generation,
        f.grant_revision AS floor_revision,
        p.public_key_sha256 AS provenance_device_key,
        ek.public_key_sha256 AS enrolled_device_key,ek.state AS enrollment_state,
        g.closed_at,g.expires_at,g.absolute_expires_at
 INTO rec
 FROM lr_uat_lease_signing_outbox o
 JOIN lr_uat_grant_provenance p ON p.request_id=o.request_id
 JOIN lr_uat_device_authority_floor f ON f.device_id=p.device_id
 JOIN lr_uat_device_enrolled_key ek ON ek.device_id=p.device_id
 JOIN lr_ab_grants g ON g.grant_id=o.grant_id
 WHERE o.request_id=p_request_id
 FOR UPDATE OF o,f,g,ek;
 IF NOT FOUND THEN RAISE EXCEPTION 'uat_ack_lease_not_found'; END IF;
 IF rec.status<>'signed' OR rec.grant_id<>p_grant_id OR
    rec.signed_digest_sha256<>p_signed_digest OR
    rec.provenance_device_key<>p_device_key_sha256 OR
    rec.enrolled_device_key<>p_device_key_sha256 OR
    p_nonce_sha256 !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'uat_ack_binding_mismatch';
 END IF;
 SELECT * INTO previous FROM lr_uat_lease_delivery_ack WHERE request_id=p_request_id;
 IF FOUND THEN
   IF previous.grant_id=p_grant_id AND
      previous.signed_digest_sha256=p_signed_digest AND
      previous.device_public_key_sha256=p_device_key_sha256 AND
      previous.nonce_sha256=p_nonce_sha256 THEN
     RETURN 'ACK_DUPLICATE_NOOP';
   END IF;
   RAISE EXCEPTION 'uat_ack_conflicting_replay';
 END IF;
 IF rec.lease_expires_at<=now_stamp OR rec.enrollment_state<>'active'
    OR rec.closed_at IS NOT NULL OR rec.expires_at<=now_stamp OR
    rec.absolute_expires_at<=now_stamp OR
    rec.generation<>rec.floor_generation OR
    rec.grant_revision<>rec.floor_revision THEN
   RAISE EXCEPTION 'uat_ack_expired_or_fenced';
 END IF;
 INSERT INTO lr_uat_lease_delivery_ack(request_id,grant_id,
  signed_digest_sha256,device_public_key_sha256,nonce_sha256)
 VALUES(p_request_id,p_grant_id,p_signed_digest,p_device_key_sha256,p_nonce_sha256);
 RETURN 'ACK_INSERTED_SYNTHETIC_ONLY';
END $lr_uat$;
COMMIT;
