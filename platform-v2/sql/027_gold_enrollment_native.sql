-- Gold native Enrollment authority. Every field is typed; signer private key
-- stays a protected key file, never a JSONB blob or plaintext database row.
BEGIN;
CREATE TABLE lr_gold_enrollment_pending(
 enrollment_id TEXT PRIMARY KEY,
 state TEXT NOT NULL,
 created_ms BIGINT NOT NULL,
 expires_ms BIGINT NOT NULL,
 poll_token_sha256 CHAR(64) NOT NULL,
 code_salt CHAR(32) NOT NULL DEFAULT '',
 code_sha256 TEXT NOT NULL,
 public_key_sha256 CHAR(64) NOT NULL,
 public_identity_key TEXT NOT NULL,
 requested_capabilities TEXT[] NOT NULL DEFAULT '{}'::text[],
 requested_policy VARCHAR(80) NOT NULL,
 display_name VARCHAR(120) NOT NULL,
 platform VARCHAR(40) NOT NULL,
 architecture VARCHAR(40) NOT NULL,
 agent_version VARCHAR(40) NOT NULL,
 fingerprint_summary VARCHAR(200),
 source_hash VARCHAR(64),
 approved_ms BIGINT,
 device_id TEXT,
 account_id TEXT,
 certificate_id TEXT,
 expired_ms BIGINT,
 replaced_ms BIGINT
);
CREATE TABLE lr_gold_enrollment_bindings(
 device_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
 public_key_sha256 CHAR(64) NOT NULL,
 public_identity_key TEXT NOT NULL,
 grantable_capabilities TEXT[] NOT NULL DEFAULT '{}'::text[],
 approved_capabilities TEXT[] NOT NULL DEFAULT '{}'::text[],
 policy_profile VARCHAR(80) NOT NULL,
 policy_revision INTEGER NOT NULL DEFAULT 1,
 policy_updated_ms BIGINT NOT NULL,
 display_name VARCHAR(120) NOT NULL,
 platform VARCHAR(40) NOT NULL,
 architecture VARCHAR(40) NOT NULL,
 agent_version VARCHAR(40) NOT NULL,
 fingerprint_summary VARCHAR(200),
 certificate_id TEXT NOT NULL,
 issued_ms BIGINT NOT NULL,
 not_after_ms BIGINT NOT NULL,
 certificate_signature TEXT NOT NULL,
 revoked_ms BIGINT,
 revoke_reason VARCHAR(120)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_gold_enrollment_pending,lr_gold_enrollment_bindings TO lr_gold_app;
COMMIT;
