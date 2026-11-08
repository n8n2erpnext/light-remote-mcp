-- rc50 P0 ONLY in ephemeral synthetic PostgreSQL.
-- Narrow the trust boundary of owner/channel origin commit, NOT crypto proof.
-- Apply AFTER 001-013 + issuer_origin_uat.sql + owner_channel_origin_transaction_uat.sql.
BEGIN;
CREATE ROLE lr_uat_origin_function_owner NOLOGIN NOINHERIT;
CREATE ROLE lr_uat_origin_verifier NOLOGIN NOINHERIT;
CREATE ROLE lr_uat_origin_untrusted NOLOGIN NOINHERIT;
-- One synthetic SCRAM-authenticated LOGIN may SET ROLE verifier but never
-- inherits grants automatically. Its randomized password is installed by
-- the private Python runner and never stored in Git or emitted in output.
CREATE ROLE lr_uat_origin_service_login LOGIN NOINHERIT;
GRANT lr_uat_origin_verifier TO lr_uat_origin_service_login
  WITH INHERIT FALSE, SET TRUE;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO
  lr_uat_origin_function_owner,lr_uat_origin_verifier,lr_uat_origin_untrusted;

-- The NOLOGIN owner can read only the columns/tables required by its
-- entrypoint and the older issuer invoked *inside* its transaction.
GRANT SELECT ON
  lr_ab_requests,lr_sessions,lr_devices,lr_device_connections,
  lr_uat_device_enrolled_key,lr_uat_trusted_origin_verifier_pins,
  lr_uat_signed_owner_channel_ledger,lr_uat_owner_approval_evidence,
  lr_uat_device_authority_floor,lr_uat_grant_provenance,
  lr_ab_grants,lr_uat_lease_signing_outbox
 TO lr_uat_origin_function_owner;

-- SELECT ... FOR UPDATE needs UPDATE privilege, even for a read-only row lock.
-- Narrow it to columns used for locking and the two actual state mutations.
GRANT UPDATE(state,consumed_at) ON lr_ab_requests
 TO lr_uat_origin_function_owner;
GRANT UPDATE(session_id) ON lr_sessions TO lr_uat_origin_function_owner;
GRANT UPDATE(device_id) ON lr_devices TO lr_uat_origin_function_owner;
GRANT UPDATE(connection_id) ON lr_device_connections TO lr_uat_origin_function_owner;
GRANT UPDATE(device_id) ON lr_uat_device_enrolled_key TO lr_uat_origin_function_owner;
GRANT UPDATE(device_id) ON lr_uat_trusted_origin_verifier_pins TO lr_uat_origin_function_owner;
GRANT UPDATE(request_id) ON lr_uat_owner_approval_evidence TO lr_uat_origin_function_owner;
GRANT UPDATE(generation,grant_revision) ON lr_uat_device_authority_floor
 TO lr_uat_origin_function_owner;
GRANT INSERT ON
  lr_uat_signed_owner_channel_ledger,lr_uat_owner_approval_evidence,
  lr_uat_grant_provenance,lr_uat_lease_signing_outbox,lr_ab_grants
 TO lr_uat_origin_function_owner;

-- The older issuer is SECURITY INVOKER: function owner requires EXECUTE but
-- *untrusted client and verifier MUST NOT* get this direct bypass.
GRANT EXECUTE ON FUNCTION public.lr_uat_issue_direct_owner_grant(text,text)
 TO lr_uat_origin_function_owner;

-- Explicit, schema-qualified callable entrypoint with protected definer.
-- pg_temp MUST be last to stop a caller-created temp table shadowing the
-- relations read by the routine.
ALTER FUNCTION public.lr_uat_commit_owner_channel_origin(
 text,text,text,text,text,text,text,text,text,text,text,text,text,
 timestamptz,timestamptz,timestamptz,timestamptz)
 OWNER TO lr_uat_origin_function_owner;
ALTER FUNCTION public.lr_uat_commit_owner_channel_origin(
 text,text,text,text,text,text,text,text,text,text,text,text,text,
 timestamptz,timestamptz,timestamptz,timestamptz)
 SECURITY DEFINER;
ALTER FUNCTION public.lr_uat_commit_owner_channel_origin(
 text,text,text,text,text,text,text,text,text,text,text,text,text,
 timestamptz,timestamptz,timestamptz,timestamptz)
 SET search_path=pg_catalog,public,pg_temp;

REVOKE ALL ON FUNCTION public.lr_uat_commit_owner_channel_origin(
 text,text,text,text,text,text,text,text,text,text,text,text,text,
 timestamptz,timestamptz,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lr_uat_commit_owner_channel_origin(
 text,text,text,text,text,text,text,text,text,text,text,text,text,
 timestamptz,timestamptz,timestamptz,timestamptz)
 TO lr_uat_origin_verifier;

-- All test-only principals are NOLOGIN. Neither verifier nor untrusted may
-- SELECT/UPDATE trusted pins, alter owner sessions, INSERT provenance,
-- mint a grant via legacy issuer, or change the writer floor directly.
-- They are exercised via SET ROLE from a scratch DB superuser. THIS DOES
-- NOT authenticate a real TLS verifier service or verify Ed25519 in SQL.
COMMIT;
