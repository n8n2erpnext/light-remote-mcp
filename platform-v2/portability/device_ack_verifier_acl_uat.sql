-- rc50 P0 SECURITY BOUNDARY EXPERIMENT: ONLY IN DISPOSABLE POSTGRES UAT.
-- Do NOT apply in production. This tests permissions, NOT Ed25519 authenticity.
-- Input receiver function still trusts a prior, protected verifier service.
BEGIN;
CREATE ROLE lr_uat_ack_function_owner NOLOGIN NOINHERIT;
CREATE ROLE lr_uat_ack_verifier NOLOGIN NOINHERIT;
CREATE ROLE lr_uat_ack_untrusted NOLOGIN NOINHERIT;

-- Existing migration functions default to PUBLIC EXECUTE unless revoked.
-- Close that default for every scratch public-schema function.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO
 lr_uat_ack_function_owner,lr_uat_ack_verifier,lr_uat_ack_untrusted;

-- Function owner has NOLOGIN and cannot be SET ROLE by the external verifier.
-- It gets only table-level access required for one preverified ACK commit.
GRANT SELECT ON
 lr_uat_device_ack_challenge,
 lr_uat_signed_device_ack_receipt,
 lr_uat_lease_signing_outbox,
 lr_uat_grant_provenance,
 lr_uat_device_authority_floor,
 lr_uat_device_enrolled_key,
 lr_uat_issuer_pin,
 lr_ab_grants,
 lr_uat_lease_delivery_ack
TO lr_uat_ack_function_owner;
GRANT UPDATE(consumed_at,ack_packet_sha256) ON
 lr_uat_device_ack_challenge TO lr_uat_ack_function_owner;
-- PostgreSQL requires an UPDATE privilege to SELECT ... FOR UPDATE.
-- Grant one column per locked row type to the NOLOGIN owner, not the verifier.
GRANT UPDATE(request_id) ON lr_uat_lease_signing_outbox
 TO lr_uat_ack_function_owner;
GRANT UPDATE(device_id) ON lr_uat_device_authority_floor
 TO lr_uat_ack_function_owner;
GRANT UPDATE(device_id) ON lr_uat_device_enrolled_key
 TO lr_uat_ack_function_owner;
GRANT UPDATE(issuer_id) ON lr_uat_issuer_pin
 TO lr_uat_ack_function_owner;
GRANT UPDATE(grant_id) ON lr_ab_grants
 TO lr_uat_ack_function_owner;
GRANT INSERT ON lr_uat_signed_device_ack_receipt,
 lr_uat_lease_delivery_ack TO lr_uat_ack_function_owner;
-- The older helper may be called ONLY by the private function-owner role.
GRANT EXECUTE ON FUNCTION public.lr_uat_ack_signed_lease(
 text,text,text,text,text) TO lr_uat_ack_function_owner;

-- Only this narrow scratch procedure runs with elevated table rights.
-- search_path is fixed: public CREATE is denied for verifier/untrusted.
ALTER FUNCTION public.lr_uat_commit_signed_device_ack(
 text,text,text,text,text,text,bigint,bigint,bigint,text,text)
 OWNER TO lr_uat_ack_function_owner;
ALTER FUNCTION public.lr_uat_commit_signed_device_ack(
 text,text,text,text,text,text,bigint,bigint,bigint,text,text)
 SECURITY DEFINER;
ALTER FUNCTION public.lr_uat_commit_signed_device_ack(
 text,text,text,text,text,text,bigint,bigint,bigint,text,text)
 SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.lr_uat_commit_signed_device_ack(
 text,text,text,text,text,text,bigint,bigint,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lr_uat_commit_signed_device_ack(
 text,text,text,text,text,text,bigint,bigint,bigint,text,text)
 TO lr_uat_ack_verifier;

-- A direct client role and verifier get NO table write, no legacy unsigned
-- ACK function, no grant issuance, no publisher function and no ACL delegation.
COMMIT;
