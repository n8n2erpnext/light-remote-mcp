-- SCRATCH ONLY: binds the synthetic verifier's expected proposed grant and
-- owner session to a real pending A/B request before signing any fake packet.
-- This is NOT a real owner proof, production schema, or credential manager.
BEGIN;
CREATE TABLE lr_uat_origin_verifier_intent (
 request_id TEXT PRIMARY KEY REFERENCES lr_ab_requests(request_id),
 proposed_grant_id TEXT NOT NULL UNIQUE,
 owner_session_id TEXT NOT NULL REFERENCES lr_sessions(session_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
COMMIT;
