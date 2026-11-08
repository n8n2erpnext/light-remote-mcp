-- Gold Support Outbox: one SQL row per ticket delivery. The submitted
-- ticket payload is an intentionally flexible HTTP/ERPNext document, not a
-- snapshot of all Support service state.
BEGIN;
CREATE TABLE lr_gold_support_outbox(
 event_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
 account_email TEXT NOT NULL,
 account_plan TEXT NOT NULL,
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 status TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 created_ms BIGINT NOT NULL,
 next_attempt_ms BIGINT NOT NULL,
 delivered_ms BIGINT,
 remote_status INTEGER,
 result_name TEXT,
 status_check_attempts INTEGER NOT NULL DEFAULT 0,
 next_status_check_ms BIGINT,
 last_error TEXT
);
CREATE INDEX lr_gold_support_due_idx ON lr_gold_support_outbox(status,next_attempt_ms);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_gold_support_outbox TO lr_gold_app;
COMMIT;
