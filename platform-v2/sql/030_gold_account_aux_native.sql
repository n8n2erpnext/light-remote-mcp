-- Native Account/Auth auxiliary state, all typed SQL columns.
-- Existing lr_sessions persists access token hashes; no snapshot JSONB.
BEGIN;
ALTER TABLE lr_sessions ADD COLUMN IF NOT EXISTS last_seen_ms BIGINT;
CREATE TABLE lr_gold_account_one_time_tokens(
 token_sha256 CHAR(64) PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('password_reset','magic_login')),
 account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
 created_ms BIGINT NOT NULL,
 expires_ms BIGINT NOT NULL CHECK(expires_ms>created_ms)
);
CREATE TABLE lr_gold_account_upgrade_requests(
 request_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
 plan TEXT NOT NULL CHECK(plan IN ('pro','vip')),
 status TEXT NOT NULL,
 created_ms BIGINT NOT NULL,
 resolved_ms BIGINT,
 resolution TEXT
);
CREATE TABLE lr_gold_pending_registrations(
 pending_id TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 provider TEXT NOT NULL,
 google_sub TEXT,
 created_ms BIGINT NOT NULL,
 expires_ms BIGINT NOT NULL,
 verification_token_sha256 TEXT,
 verification_pin_hash TEXT,
 challenge_expires_ms BIGINT,
 send_count INTEGER NOT NULL DEFAULT 0,
 pin_attempts INTEGER NOT NULL DEFAULT 0,
 challenge_locked BOOLEAN NOT NULL DEFAULT false,
 last_sent_ms BIGINT,
 resend_available_ms BIGINT
);
CREATE TABLE lr_gold_google_signup_intents(
 token_sha256 CHAR(64) PRIMARY KEY,
 google_sub TEXT NOT NULL,
 email TEXT NOT NULL,
 created_ms BIGINT NOT NULL,
 expires_ms BIGINT NOT NULL
);
CREATE TABLE lr_gold_account_groups(
 group_id TEXT PRIMARY KEY,
 name VARCHAR(50) NOT NULL,
 protected BOOLEAN NOT NULL DEFAULT false,
 created_ms BIGINT NOT NULL
);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_sessions,lr_gold_account_one_time_tokens,
 lr_gold_account_upgrade_requests,lr_gold_pending_registrations,
 lr_gold_google_signup_intents,lr_gold_account_groups TO lr_gold_app;
COMMIT;
