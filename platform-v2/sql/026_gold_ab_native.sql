-- Canonical A/B authority on existing RC50 lr_ab_requests/lr_ab_grants.
-- Display code is encrypted with a Gold-specific AES256 key, never plaintext.
BEGIN;
CREATE TABLE lr_gold_ab_request_metadata(
 request_id TEXT PRIMARY KEY REFERENCES lr_ab_requests(request_id) ON DELETE CASCADE,
 label VARCHAR(120) NOT NULL,
 pairing_required BOOLEAN NOT NULL DEFAULT false,
 pairing_id TEXT,
 denied_ms BIGINT,
 deny_reason VARCHAR(80)
);
CREATE TABLE lr_gold_ab_grant_metadata(
 grant_id TEXT PRIMARY KEY REFERENCES lr_ab_grants(grant_id) ON DELETE CASCADE,
 close_reason VARCHAR(80)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_ab_requests,lr_ab_grants,
 lr_gold_ab_request_metadata,lr_gold_ab_grant_metadata TO lr_gold_app;
COMMIT;
