-- rc50 P0: device Ed25519 ACK RECEIVER CONTRACT. Disposable UAT only.
-- SQL CANNOT verify Ed25519 signatures: only a trusted Node verifier can.
-- No production DB role, migration, Local Wall/Agent or actual device trust.
BEGIN;
ALTER TABLE lr_uat_device_enrolled_key
  ADD COLUMN public_key_spki_b64url TEXT;
ALTER TABLE lr_uat_issuer_pin
  ADD COLUMN public_key_spki_b64url TEXT;

CREATE TABLE lr_uat_device_ack_challenge (
 request_id TEXT PRIMARY KEY REFERENCES lr_uat_lease_signing_outbox(request_id),
 grant_id TEXT NOT NULL REFERENCES lr_ab_grants(grant_id),
 nonce_sha256 TEXT NOT NULL UNIQUE CHECK (nonce_sha256 ~ '^[a-f0-9]{64}$'),
 issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ,
 ack_packet_sha256 TEXT CHECK(ack_packet_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE TABLE lr_uat_signed_device_ack_receipt (
 request_id TEXT PRIMARY KEY REFERENCES lr_uat_device_ack_challenge(request_id),
 grant_id TEXT NOT NULL REFERENCES lr_ab_grants(grant_id),
 signed_lease_digest_sha256 TEXT NOT NULL CHECK(signed_lease_digest_sha256 ~ '^[a-f0-9]{64}$'),
 signed_ack_sha256 TEXT NOT NULL UNIQUE CHECK(signed_ack_sha256 ~ '^[a-f0-9]{64}$'),
 device_signature_b64url TEXT NOT NULL CHECK(device_signature_b64url ~ '^[A-Za-z0-9_-]{86}$'),
 device_public_key_sha256 TEXT NOT NULL CHECK(device_public_key_sha256 ~ '^[a-f0-9]{64}$'),
 issuer_public_key_sha256 TEXT NOT NULL CHECK(issuer_public_key_sha256 ~ '^[a-f0-9]{64}$'),
 nonce_sha256 TEXT NOT NULL UNIQUE CHECK(nonce_sha256 ~ '^[a-f0-9]{64}$'),
 grant_generation BIGINT NOT NULL CHECK(grant_generation>0),
 grant_revision BIGINT NOT NULL CHECK(grant_revision>0),
 claim_seq BIGINT NOT NULL CHECK(claim_seq>0),
 received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION lr_uat_issue_device_ack_challenge(
 p_request_id TEXT,p_grant_id TEXT,p_nonce_sha256 TEXT
) RETURNS BIGINT LANGUAGE plpgsql AS $lr_uat$
DECLARE r RECORD;
        now_stamp TIMESTAMPTZ:=clock_timestamp();
        expiry TIMESTAMPTZ;
BEGIN
 IF p_nonce_sha256 !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'uat_invalid_ack_nonce';
 END IF;
 SELECT o.status,o.grant_id,o.lease_expires_at,o.issuer_public_key_sha256,
        p.generation,p.grant_revision,p.public_key_sha256,
        f.generation AS floor_generation,f.grant_revision AS floor_revision,
        g.closed_at,g.expires_at,g.absolute_expires_at,
        ek.state AS enrolled_state,ek.public_key_sha256 AS enrolled_key,
        pin.enabled,pin.public_key_sha256 AS pinned_issuer
 INTO r
 FROM lr_uat_lease_signing_outbox o
 JOIN lr_uat_grant_provenance p ON p.request_id=o.request_id
 JOIN lr_uat_device_authority_floor f ON f.device_id=p.device_id
 JOIN lr_ab_grants g ON g.grant_id=o.grant_id
 JOIN lr_uat_device_enrolled_key ek ON ek.device_id=p.device_id
 JOIN lr_uat_issuer_pin pin ON pin.issuer_id='synthetic_only'
 WHERE o.request_id=p_request_id
 FOR UPDATE OF o,f,g,ek,pin;
 IF NOT FOUND OR r.status<>'signed' OR r.grant_id<>p_grant_id
    OR r.generation<>r.floor_generation OR
    r.grant_revision<>r.floor_revision OR
    r.enrolled_state<>'active' OR
    r.enrolled_key<>r.public_key_sha256 OR
    r.enabled IS DISTINCT FROM TRUE OR
    r.pinned_issuer<>r.issuer_public_key_sha256 OR
    r.closed_at IS NOT NULL OR
    r.expires_at<=now_stamp OR r.absolute_expires_at<=now_stamp OR
    r.lease_expires_at<=now_stamp THEN
    RAISE EXCEPTION 'uat_challenge_grant_not_current';
 END IF;
 expiry:=LEAST(now_stamp+interval '7 seconds',r.lease_expires_at,
              r.expires_at,r.absolute_expires_at);
 IF expiry<=now_stamp THEN RAISE EXCEPTION 'uat_challenge_expired'; END IF;
 INSERT INTO lr_uat_device_ack_challenge(request_id,grant_id,nonce_sha256,expires_at)
 VALUES(p_request_id,p_grant_id,p_nonce_sha256,expiry);
 RETURN (extract(epoch FROM expiry)*1000)::BIGINT;
END $lr_uat$;

-- This function trusts that an authenticated Node verifier has verified
-- issuer signature + device signature + exact immutable signed ACK payload.
-- It DOES NOT authenticate the caller; do not expose it to client APIs.
CREATE OR REPLACE FUNCTION lr_uat_commit_signed_device_ack(
 p_request_id TEXT,p_grant_id TEXT,p_signed_digest TEXT,
 p_device_key_sha256 TEXT,p_issuer_key_sha256 TEXT,p_nonce_sha256 TEXT,
 p_generation BIGINT,p_grant_revision BIGINT,p_claim_seq BIGINT,
 p_signature_b64url TEXT,p_signed_ack_sha256 TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $lr_uat$
DECLARE c RECORD; r RECORD; previous RECORD;
        now_stamp TIMESTAMPTZ:=clock_timestamp();
        out_ack TEXT;
BEGIN
 SELECT * INTO c FROM lr_uat_device_ack_challenge
 WHERE request_id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'uat_ack_challenge_missing'; END IF;
 IF c.consumed_at IS NOT NULL THEN
   SELECT * INTO previous FROM lr_uat_signed_device_ack_receipt
    WHERE request_id=p_request_id;
   IF FOUND AND previous.grant_id=p_grant_id AND
      previous.signed_lease_digest_sha256=p_signed_digest AND
      previous.signed_ack_sha256=p_signed_ack_sha256 AND
      previous.device_public_key_sha256=p_device_key_sha256 AND
      previous.issuer_public_key_sha256=p_issuer_key_sha256 AND
      previous.nonce_sha256=p_nonce_sha256 AND
      previous.grant_generation=p_generation AND
      previous.grant_revision=p_grant_revision AND
      previous.claim_seq=p_claim_seq AND
      previous.device_signature_b64url=p_signature_b64url THEN
     RETURN 'DEVICE_ACK_SIGNATURE_DUPLICATE_NOOP';
   END IF;
   RAISE EXCEPTION 'uat_device_signed_ack_conflicting_replay';
 END IF;
 SELECT o.status,o.grant_id,o.signed_digest_sha256,o.issuer_public_key_sha256,
        o.claim_seq,o.lease_expires_at,
        p.device_id,p.generation,p.grant_revision,
        p.public_key_sha256 AS enrolled_provenance_key,
        f.generation AS floor_generation,f.grant_revision AS floor_revision,
        ek.public_key_sha256 AS enrolled_key,ek.state AS enrollment_state,
        pin.public_key_sha256 AS issuer_pin,pin.enabled,
        g.closed_at,g.expires_at,g.absolute_expires_at
 INTO r
 FROM lr_uat_lease_signing_outbox o
 JOIN lr_uat_grant_provenance p ON p.request_id=o.request_id
 JOIN lr_uat_device_authority_floor f ON f.device_id=p.device_id
 JOIN lr_uat_device_enrolled_key ek ON ek.device_id=p.device_id
 JOIN lr_uat_issuer_pin pin ON pin.issuer_id='synthetic_only'
 JOIN lr_ab_grants g ON g.grant_id=o.grant_id
 WHERE o.request_id=p_request_id
 FOR UPDATE OF o,f,ek,pin,g;
 IF NOT FOUND OR r.status<>'signed' OR
    c.grant_id<>p_grant_id OR r.grant_id<>p_grant_id OR
    c.nonce_sha256<>p_nonce_sha256 OR
    c.expires_at<=now_stamp OR r.lease_expires_at<=now_stamp OR
    r.signed_digest_sha256<>p_signed_digest OR
    r.issuer_public_key_sha256<>p_issuer_key_sha256 OR
    r.issuer_pin<>p_issuer_key_sha256 OR
    r.enabled IS DISTINCT FROM TRUE OR
    r.enrolled_key<>p_device_key_sha256 OR
    r.enrolled_provenance_key<>p_device_key_sha256 OR
    r.enrollment_state<>'active' OR
    r.generation<>p_generation OR
    r.grant_revision<>p_grant_revision OR r.claim_seq<>p_claim_seq OR
    r.floor_generation<>p_generation OR r.floor_revision<>p_grant_revision OR
    r.closed_at IS NOT NULL OR r.expires_at<=now_stamp OR
    r.absolute_expires_at<=now_stamp THEN
   RAISE EXCEPTION 'uat_signed_ack_state_fenced_or_unbound';
 END IF;
 IF p_signature_b64url !~ '^[A-Za-z0-9_-]{86}$' OR
    p_signed_ack_sha256 !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'uat_device_signature_shape_invalid';
 END IF;
 -- Existing ACK primitive and signed proof receipt are in ONE transaction.
 out_ack:=lr_uat_ack_signed_lease(p_request_id,p_grant_id,
    p_signed_digest,p_device_key_sha256,p_nonce_sha256);
 IF out_ack<>'ACK_INSERTED_SYNTHETIC_ONLY' THEN
   RAISE EXCEPTION 'uat_unexpected_preexisting_legacy_ack';
 END IF;
 INSERT INTO lr_uat_signed_device_ack_receipt(request_id,grant_id,
   signed_lease_digest_sha256,signed_ack_sha256,device_signature_b64url,
   device_public_key_sha256,issuer_public_key_sha256,nonce_sha256,
   grant_generation,grant_revision,claim_seq)
 VALUES(p_request_id,p_grant_id,p_signed_digest,p_signed_ack_sha256,
        p_signature_b64url,p_device_key_sha256,p_issuer_key_sha256,
        p_nonce_sha256,p_generation,p_grant_revision,p_claim_seq);
 UPDATE lr_uat_device_ack_challenge
 SET consumed_at=now_stamp,ack_packet_sha256=p_signed_ack_sha256
 WHERE request_id=p_request_id;
 RETURN 'SIGNED_DEVICE_ACK_RECEIPT_COMMITTED_SYNTHETIC_ONLY';
END $lr_uat$;
COMMIT;
