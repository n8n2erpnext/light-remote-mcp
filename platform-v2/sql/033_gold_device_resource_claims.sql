-- Gold M4 typed device-scoped resource claims, no JSON or inferred Team rights.
BEGIN;
ALTER TABLE lr_gold_personal_agent_work
  ADD COLUMN device_id TEXT,
  ADD COLUMN resource_key TEXT,
  ADD COLUMN resource_mode TEXT CHECK (resource_mode IN ('shared','exclusive')),
  ADD COLUMN worker_weight SMALLINT CHECK(worker_weight BETWEEN 0 AND 2),
  ADD COLUMN queue_reason TEXT CHECK(queue_reason IN ('QUEUED_AGENT_SLOT','RESOURCE_LOCKED','QUEUED_WORKER_CAPACITY'));
CREATE INDEX lr_gold_m4_device_pending ON lr_gold_personal_agent_work(device_id,state,queued_at)
  WHERE state='queued';
CREATE TABLE lr_gold_device_resource_claims(
  job_id TEXT PRIMARY KEY REFERENCES lr_gold_personal_agent_work(job_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  resource_key TEXT NOT NULL CHECK (length(resource_key) BETWEEN 1 AND 480),
  resource_mode TEXT NOT NULL CHECK (resource_mode IN ('shared','exclusive')),
  worker_weight SMALLINT NOT NULL CHECK(worker_weight BETWEEN 0 AND 2),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lr_gold_m4_active_device ON lr_gold_device_resource_claims(device_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_gold_device_resource_claims TO lr_gold_app;
COMMIT;
