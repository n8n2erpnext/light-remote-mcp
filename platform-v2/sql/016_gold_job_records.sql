-- Canonical Gold Operator job metadata, independent of legacy UAT foreign keys.
-- Raw scripts, JWTs, credentials and process handles must not be persisted here.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_gold_job_records(
 job_id TEXT PRIMARY KEY CHECK(length(job_id) BETWEEN 1 AND 160),
 account_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 agent_id TEXT NOT NULL,
 operation_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('running','ok','error','timeout','interrupted')),
 started_at TIMESTAMPTZ NOT NULL,
 finished_at TIMESTAMPTZ,
 exit_code INTEGER,
 public_view JSONB NOT NULL CHECK(jsonb_typeof(public_view)='object'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_gold_job_records_account_time
 ON lr_gold_job_records(account_id,started_at DESC);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_gold_job_records TO lr_gold_app;
COMMIT;
