-- rc50 synthetic owner+channel evidence -> grant single transaction.
-- DISPOSABLE POSTGRES ONLY; PostgreSQL does not verify Ed25519.
-- Requires previously applied original 001-013 + issuer_origin_uat.sql.
BEGIN;
CREATE TABLE lr_uat_trusted_origin_verifier_pins (
 device_id TEXT PRIMARY KEY REFERENCES lr_devices(device_id),
 wall_verifier_sha256 TEXT NOT NULL CHECK(wall_verifier_sha256 ~ '^[a-f0-9]{64}$'),
 channel_verifier_sha256 TEXT NOT NULL CHECK(channel_verifier_sha256 ~ '^[a-f0-9]{64}$'),
 state TEXT NOT NULL CHECK(state IN('active','revoked'))
);
CREATE TABLE lr_uat_signed_owner_channel_ledger (
 request_id TEXT PRIMARY KEY REFERENCES lr_ab_requests(request_id),
 grant_id TEXT NOT NULL UNIQUE REFERENCES lr_ab_grants(grant_id)
   DEFERRABLE INITIALLY DEFERRED,
 owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
 owner_session_id TEXT NOT NULL REFERENCES lr_sessions(session_id),
 device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
 connection_id TEXT NOT NULL REFERENCES lr_device_connections(connection_id),
 agent_id TEXT NOT NULL,
 enrolled_key_sha256 TEXT NOT NULL CHECK(enrolled_key_sha256 ~ '^[a-f0-9]{64}$'),
 wall_verifier_sha256 TEXT NOT NULL CHECK(wall_verifier_sha256 ~ '^[a-f0-9]{64}$'),
 channel_verifier_sha256 TEXT NOT NULL CHECK(channel_verifier_sha256 ~ '^[a-f0-9]{64}$'),
 owner_decision_nonce_sha256 TEXT NOT NULL UNIQUE CHECK(owner_decision_nonce_sha256 ~ '^[a-f0-9]{64}$'),
 wall_proof_sha256 TEXT NOT NULL UNIQUE CHECK(wall_proof_sha256 ~ '^[a-f0-9]{64}$'),
 signed_channel_packet_sha256 TEXT NOT NULL UNIQUE CHECK(signed_channel_packet_sha256 ~ '^[a-f0-9]{64}$'),
 request_created_at TIMESTAMPTZ NOT NULL,
 request_expires_at TIMESTAMPTZ NOT NULL,
 approved_at TIMESTAMPTZ NOT NULL,
 channel_approved_at TIMESTAMPTZ NOT NULL,
 committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- p_* evidence fields are provided by a UAT caller that independently
-- verified both signed packets. This routine does NOT validate cryptography.
-- SECURITY INVOKER; do not grant it to any real/client roles.
CREATE OR REPLACE FUNCTION lr_uat_commit_owner_channel_origin(
 p_request_id TEXT,p_grant_id TEXT,p_owner_session_id TEXT,
 p_owner_account_id TEXT,p_device_id TEXT,p_connection_id TEXT,
 p_agent_id TEXT,p_enrolled_key_sha256 TEXT,
 p_wall_verifier_sha256 TEXT,p_channel_verifier_sha256 TEXT,
 p_nonce_sha256 TEXT,p_wall_proof_sha256 TEXT,p_channel_ack_sha256 TEXT,
 p_request_created_at TIMESTAMPTZ,p_request_expires_at TIMESTAMPTZ,
 p_approved_at TIMESTAMPTZ,p_channel_approved_at TIMESTAMPTZ
) RETURNS TEXT LANGUAGE plpgsql AS $lr_uat$
DECLARE r RECORD;
        at_now TIMESTAMPTZ := clock_timestamp();
        created_grant TEXT;
BEGIN
 IF p_nonce_sha256 !~ '^[a-f0-9]{64}$' OR
    p_wall_proof_sha256 !~ '^[a-f0-9]{64}$' OR
    p_channel_ack_sha256 !~ '^[a-f0-9]{64}$' OR
    p_enrolled_key_sha256 !~ '^[a-f0-9]{64}$' OR
    p_wall_verifier_sha256 !~ '^[a-f0-9]{64}$' OR
    p_channel_verifier_sha256 !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'uat_owner_channel_invalid_hash_shape';
 END IF;
 SELECT req.state AS request_state, req.consumed_at,
   req.account_id, req.device_id, req.connection_id, req.agent_id,
   req.purpose,req.created_at,req.expires_at,
   sess.account_id AS session_account,
   sess.created_at AS session_created,
   sess.expires_at AS session_expires,sess.revoked_at AS session_revoked,
   dev.owner_account_id AS device_owner,dev.state AS device_state,
   conn.account_id AS connection_account,conn.device_id AS connection_device,
   conn.closed_at AS connection_closed,conn.hard_expires_at,
   enrolled.public_key_sha256 AS enrolled_key,
   enrolled.state AS enrolled_state,
   pin.wall_verifier_sha256 AS wall_pin,
   pin.channel_verifier_sha256 AS channel_pin,
   pin.state AS pin_state
 INTO r
 FROM lr_ab_requests req
 JOIN lr_sessions sess ON sess.session_id=p_owner_session_id
 JOIN lr_devices dev ON dev.device_id=req.device_id
 JOIN lr_device_connections conn ON conn.connection_id=req.connection_id
 JOIN lr_uat_device_enrolled_key enrolled ON enrolled.device_id=req.device_id
 JOIN lr_uat_trusted_origin_verifier_pins pin ON pin.device_id=req.device_id
 WHERE req.request_id=p_request_id
 FOR UPDATE OF req,sess,dev,conn,enrolled,pin;
 IF NOT FOUND THEN RAISE EXCEPTION 'uat_origin_missing_trusted_rows'; END IF;
 IF r.request_state<>'pending' OR r.consumed_at IS NOT NULL THEN
   RAISE EXCEPTION 'uat_owner_channel_request_not_pending';
 END IF;
 IF r.account_id<>p_owner_account_id OR
    r.session_account<>p_owner_account_id OR
    r.device_owner<>p_owner_account_id OR
    r.connection_account<>p_owner_account_id OR
    r.device_id<>p_device_id OR
    r.connection_device<>p_device_id OR
    r.connection_id<>p_connection_id OR
    r.agent_id IS NULL OR r.agent_id<>p_agent_id OR
    r.purpose<>'device' OR r.device_state='revoked' OR
    r.connection_closed IS NOT NULL OR r.hard_expires_at<=at_now OR
    r.enrolled_state<>'active' OR
    r.enrolled_key<>p_enrolled_key_sha256 OR
    r.pin_state<>'active' OR
    r.wall_pin<>p_wall_verifier_sha256 OR
    r.channel_pin<>p_channel_verifier_sha256 THEN
   RAISE EXCEPTION 'uat_owner_channel_identity_or_key_mismatch';
 END IF;
 IF p_request_created_at IS DISTINCT FROM r.created_at OR
    p_request_expires_at IS DISTINCT FROM r.expires_at THEN
   RAISE EXCEPTION 'uat_owner_channel_request_window_not_bound';
 END IF;
 IF p_channel_approved_at>p_approved_at OR
    p_approved_at-p_channel_approved_at>interval '30 seconds' OR
    p_approved_at<r.created_at OR p_approved_at>=r.expires_at OR
    p_approved_at>at_now OR r.expires_at<=at_now OR
    r.session_created>p_approved_at OR
    r.session_expires<=p_approved_at OR r.session_expires<=at_now OR
    r.session_revoked IS NOT NULL THEN
   RAISE EXCEPTION 'uat_owner_channel_time_or_session_invalid';
 END IF;
 IF EXISTS(SELECT 1 FROM lr_uat_signed_owner_channel_ledger
    WHERE owner_decision_nonce_sha256=p_nonce_sha256) THEN
   RAISE EXCEPTION 'uat_owner_channel_nonce_replayed';
 END IF;
 -- The UNIQUE constraint additionally handles concurrent nonce collisions.
 -- Request lock, unique nonce/proof claims, origin evidence, grant creation
 -- and epoch bump all take place in this ONE PostgreSQL transaction.
 INSERT INTO lr_uat_signed_owner_channel_ledger(
   request_id,grant_id,owner_account_id,owner_session_id,device_id,
   connection_id,agent_id,enrolled_key_sha256,wall_verifier_sha256,
   channel_verifier_sha256,owner_decision_nonce_sha256,
   wall_proof_sha256,signed_channel_packet_sha256,
   request_created_at,request_expires_at,approved_at,channel_approved_at)
 VALUES(
   p_request_id,p_grant_id,p_owner_account_id,p_owner_session_id,
   p_device_id,p_connection_id,p_agent_id,p_enrolled_key_sha256,
   p_wall_verifier_sha256,p_channel_verifier_sha256,p_nonce_sha256,
   p_wall_proof_sha256,p_channel_ack_sha256,
   p_request_created_at,p_request_expires_at,
   p_approved_at,p_channel_approved_at);
 INSERT INTO lr_uat_owner_approval_evidence(
   request_id,owner_account_id,owner_session_id,approved_at,opaque_evidence_sha256)
 VALUES(p_request_id,p_owner_account_id,p_owner_session_id,
   p_approved_at,p_wall_proof_sha256);
 UPDATE lr_ab_requests SET state='approved' WHERE request_id=p_request_id;
 created_grant:=lr_uat_issue_direct_owner_grant(p_request_id,p_grant_id);
 IF created_grant<>'ORIGIN_COMMITTED_SIGNING_PENDING' THEN
    RAISE EXCEPTION 'uat_unexpected_issuer_result';
 END IF;
 RETURN 'SYNTHETIC_OWNER_CHANNEL_ATOMIC_GRANT_PENDING_SIGNING';
END $lr_uat$;
COMMIT;
