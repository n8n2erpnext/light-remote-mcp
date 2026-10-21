-- Gold-only canonical personal Agent admission. No Team cross-account activation.
-- Separate immutable job identity from execution slot; queue does not consume an Agent slot.
BEGIN;
CREATE TABLE lr_gold_personal_agent_work (
  job_id TEXT PRIMARY KEY CHECK (length(job_id) BETWEEN 16 AND 160),
  account_id TEXT NOT NULL CHECK (length(account_id) BETWEEN 1 AND 128),
  agent_id TEXT NOT NULL CHECK (length(agent_id) BETWEEN 16 AND 128),
  session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 128),
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 16 AND 128),
  state TEXT NOT NULL CHECK (state IN ('queued','running','finished','unknown')),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  disposition TEXT,
  CONSTRAINT lr_gold_personal_agent_owner_operation UNIQUE (account_id,operation_id)
);
CREATE INDEX lr_gold_personal_agent_queue ON lr_gold_personal_agent_work
  (account_id,state,queued_at,job_id);
CREATE INDEX lr_gold_personal_agent_actor ON lr_gold_personal_agent_work
  (account_id,agent_id,state);
-- A queued job has been reserved under G4 but has not executed.
ALTER TABLE lr_gold_job_records
  DROP CONSTRAINT IF EXISTS lr_gold_job_records_status_check;
ALTER TABLE lr_gold_job_records
  ADD CONSTRAINT lr_gold_job_records_status_check
  CHECK (status IN ('queued','running','ok','error','timeout','interrupted'));
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_gold_personal_agent_work TO lr_gold_app;
COMMIT;
