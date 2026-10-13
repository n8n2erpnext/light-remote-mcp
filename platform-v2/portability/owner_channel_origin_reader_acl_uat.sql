-- rc50 P0 fixture-only: narrowly scoped authenticated trusted-context reader.
-- Apply in disposable PG after 001-013, origin+intents; before owner proofs.
-- No real owner/session data, no production signer credentials.
BEGIN;
CREATE ROLE lr_uat_origin_context_owner NOLOGIN NOINHERIT;
CREATE ROLE lr_uat_origin_reader_login LOGIN NOINHERIT;
GRANT USAGE ON SCHEMA public TO lr_uat_origin_context_owner,lr_uat_origin_reader_login;
GRANT SELECT ON public.lr_ab_requests,public.lr_sessions,public.lr_devices,
 public.lr_device_connections,public.lr_uat_device_enrolled_key,
 public.lr_uat_trusted_origin_verifier_pins,
 public.lr_uat_signed_owner_channel_ledger,
 public.lr_uat_origin_verifier_intent TO lr_uat_origin_context_owner;

CREATE FUNCTION public.lr_uat_get_owner_channel_context(
 p_request_id text,p_nonce_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE answer jsonb;
BEGIN
 IF p_request_id !~ '^uat_[A-Za-z0-9_]{4,90}$' OR
    p_nonce_sha256 !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'uat_context_invalid_lookup';
 END IF;
 SELECT jsonb_build_object(
   'requestId',r.request_id,'grantId',i.proposed_grant_id,
   'accountId',r.account_id,'deviceId',r.device_id,'agentId',r.agent_id,
   'connectionId',r.connection_id,'ownerSessionId',i.owner_session_id,
   'deviceKeySha256',ek.public_key_sha256,
   'wallVerifierSha256',pins.wall_verifier_sha256,
   'channelVerifierSha256',pins.channel_verifier_sha256,
   'requestCreatedAtMs',(extract(epoch FROM r.created_at)*1000)::bigint,
   'requestExpiresAtMs',(extract(epoch FROM r.expires_at)*1000)::bigint,
   'requestState',r.state,
   'ownerSessionActive',(ss.revoked_at IS NULL AND ss.expires_at>now()
                         AND ss.account_id=r.account_id),
   'enrollmentActive',(ek.state='active' AND d.owner_account_id=r.account_id),
   'connectionActive',(c.closed_at IS NULL AND c.hard_expires_at>now()
                       AND c.account_id=r.account_id AND c.device_id=r.device_id),
   'pinsActive',(pins.state='active'),
   'nonceUnused',(NOT EXISTS(
     SELECT 1 FROM public.lr_uat_signed_owner_channel_ledger old
     WHERE old.owner_decision_nonce_sha256=p_nonce_sha256))
 ) INTO answer
 FROM public.lr_ab_requests r
 JOIN public.lr_uat_origin_verifier_intent i USING(request_id)
 JOIN public.lr_sessions ss ON ss.session_id=i.owner_session_id
 JOIN public.lr_devices d ON d.device_id=r.device_id
 JOIN public.lr_device_connections c ON c.connection_id=r.connection_id
 JOIN public.lr_uat_device_enrolled_key ek ON ek.device_id=r.device_id
 JOIN public.lr_uat_trusted_origin_verifier_pins pins ON pins.device_id=r.device_id
 WHERE r.request_id=p_request_id;
 IF answer IS NULL THEN RAISE EXCEPTION 'uat_context_request_not_found'; END IF;
 RETURN answer;
END $$;
ALTER FUNCTION public.lr_uat_get_owner_channel_context(text,text)
 OWNER TO lr_uat_origin_context_owner;
ALTER FUNCTION public.lr_uat_get_owner_channel_context(text,text)
 SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lr_uat_get_owner_channel_context(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lr_uat_get_owner_channel_context(text,text)
 TO lr_uat_origin_reader_login;
-- Reader has exactly one function entrypoint; no table SELECT or mutations.
-- The function owner cannot login and has SELECT only.
COMMIT;
