-- Light Remote rc50 P0: ISOLATED PG UAT ONLY, NOT a production migration.
-- Intent: prove one DB transaction traces an A/B approved request to exactly
-- one direct-owner grant, issuer epoch revision and PENDING signing-outbox row.
-- This SQL DOES NOT authenticate a human owner or cryptographically sign.
-- Run only after original 001..013 migrations on a disposable private PG.
BEGIN;
CREATE TABLE lr_uat_owner_approval_evidence (
  request_id TEXT PRIMARY KEY REFERENCES lr_ab_requests(request_id),
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  owner_session_id TEXT NOT NULL REFERENCES lr_sessions(session_id),
  approved_at TIMESTAMPTZ NOT NULL,
  opaque_evidence_sha256 TEXT NOT NULL UNIQUE
    CHECK(opaque_evidence_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE TABLE lr_uat_device_enrolled_key (
  device_id TEXT PRIMARY KEY REFERENCES lr_devices(device_id),
  public_key_sha256 TEXT NOT NULL
    CHECK(public_key_sha256 ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL CHECK (state IN ('active','revoked'))
);
CREATE TABLE lr_uat_device_authority_floor (
  device_id TEXT PRIMARY KEY REFERENCES lr_devices(device_id),
  generation BIGINT NOT NULL DEFAULT 0 CHECK(generation>=0),
  grant_revision BIGINT NOT NULL DEFAULT 0 CHECK(grant_revision>=0)
);
CREATE TABLE lr_uat_grant_provenance (
  request_id TEXT PRIMARY KEY REFERENCES lr_ab_requests(request_id),
  grant_id TEXT NOT NULL UNIQUE REFERENCES lr_ab_grants(grant_id),
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
  public_key_sha256 TEXT NOT NULL CHECK(public_key_sha256 ~ '^[0-9a-f]{64}$'),
  generation BIGINT NOT NULL CHECK(generation>0),
  grant_revision BIGINT NOT NULL CHECK(grant_revision>0),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE lr_uat_lease_signing_outbox (
  request_id TEXT PRIMARY KEY REFERENCES lr_uat_grant_provenance(request_id),
  grant_id TEXT NOT NULL UNIQUE REFERENCES lr_ab_grants(grant_id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','signed','canceled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  signed_digest_sha256 TEXT CHECK(
    signed_digest_sha256 IS NULL OR signed_digest_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK(status <> 'signed' OR signed_digest_sha256 IS NOT NULL)
);
CREATE OR REPLACE FUNCTION lr_uat_issue_direct_owner_grant(
  p_request_id TEXT,p_grant_id TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $lr_uat$
DECLARE r RECORD;
        next_gen BIGINT;
        next_rev BIGINT;
        absolute_exp TIMESTAMPTZ;
        local_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- This prototype reads ALREADY VERIFIED mock owner evidence from storage.
  -- Production owner Wall consent, session verification and keys must be
  -- enforced by a separate trusted writer BEFORE this function is callable.
  SELECT
    req.request_id,req.account_id,req.device_id,req.connection_id,
    req.agent_id,req.purpose,req.state AS request_state,
    req.created_at,req.expires_at,req.consumed_at,
    ev.owner_account_id AS evidence_owner,ev.approved_at,
    sess.account_id AS session_actor,sess.expires_at AS session_expires,
    sess.created_at AS session_created,sess.revoked_at AS session_revoked,
    dev.owner_account_id AS device_owner,dev.state AS device_state,
    con.account_id AS connection_actor,con.device_id AS connected_device,
    con.closed_at AS connection_closed,con.hard_expires_at AS connection_expiry,
    enrolled.public_key_sha256,enrolled.state AS enrollment_state
  INTO r
  FROM lr_ab_requests req
  JOIN lr_uat_owner_approval_evidence ev ON ev.request_id=req.request_id
  JOIN lr_sessions sess ON sess.session_id=ev.owner_session_id
  JOIN lr_devices dev ON dev.device_id=req.device_id
  JOIN lr_device_connections con ON con.connection_id=req.connection_id
  JOIN lr_uat_device_enrolled_key enrolled ON enrolled.device_id=req.device_id
  WHERE req.request_id=p_request_id
  FOR UPDATE OF req,ev,sess,dev,con,enrolled;
  IF NOT FOUND THEN RAISE EXCEPTION 'uat_no_verified_approval_chain'; END IF;
  IF r.request_state<>'approved' OR r.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'uat_request_not_freshly_approved';
  END IF;
  IF r.purpose<>'device' OR r.agent_id IS NULL OR
     r.account_id<>r.device_owner OR
     r.evidence_owner<>r.device_owner OR
     r.session_actor<>r.device_owner OR
     r.connection_actor<>r.device_owner OR
     r.connected_device<>r.device_id OR
     r.device_state='revoked' OR r.enrollment_state<>'active' THEN
    RAISE EXCEPTION 'uat_owner_device_binding_failed';
  END IF;
  IF r.approved_at<r.created_at OR r.approved_at>=r.expires_at OR
     r.approved_at>local_now OR
     r.session_created>r.approved_at OR r.session_expires<=r.approved_at OR
     r.session_revoked IS NOT NULL OR
     r.connection_closed IS NOT NULL OR r.connection_expiry<=local_now THEN
    RAISE EXCEPTION 'uat_approval_or_connection_expired';
  END IF;
  IF EXISTS(SELECT 1 FROM lr_uat_grant_provenance
            WHERE request_id=p_request_id OR grant_id=p_grant_id) THEN
    RAISE EXCEPTION 'uat_issuer_duplicate_request_or_grant';
  END IF;
  absolute_exp:=LEAST(r.approved_at+interval '24 hours',r.connection_expiry);
  IF absolute_exp<=local_now THEN
    RAISE EXCEPTION 'uat_grant_already_expired';
  END IF;
  -- The UPDATE row lock serializes per-device generation/revision issuance.
  -- Missing authority state fails closed; no caller-chosen epoch or revision.
  UPDATE lr_uat_device_authority_floor
  SET generation=generation+1,grant_revision=grant_revision+1
  WHERE device_id=r.device_id
  RETURNING generation,grant_revision INTO next_gen,next_rev;
  IF NOT FOUND THEN RAISE EXCEPTION 'uat_authority_floor_missing'; END IF;
  INSERT INTO lr_ab_grants(grant_id,account_id,device_id,connection_id,
    agent_id,purpose,approved_at,last_activity_at,idle_grace_ms,
    expires_at,absolute_expires_at)
  VALUES(p_grant_id,r.account_id,r.device_id,r.connection_id,
    r.agent_id,'device',r.approved_at,local_now,900000,
    LEAST(absolute_exp,local_now+interval '1 hour'),absolute_exp);
  INSERT INTO lr_uat_grant_provenance(request_id,grant_id,
    owner_account_id,device_id,public_key_sha256,generation,grant_revision)
  VALUES(p_request_id,p_grant_id,r.device_owner,r.device_id,
    r.public_key_sha256,next_gen,next_rev);
  INSERT INTO lr_uat_lease_signing_outbox(request_id,grant_id,status)
  VALUES(p_request_id,p_grant_id,'pending');
  UPDATE lr_ab_requests SET consumed_at=local_now
   WHERE request_id=p_request_id;
  -- No signature/key is exposed in this result. Signer must separately read
  -- fenced immutable provenance and publish signed leases idempotently.
  RETURN 'ORIGIN_COMMITTED_SIGNING_PENDING';
END $lr_uat$;
COMMIT;
