-- M4 background process lock continuity: launch != completion.
-- A verified terminal OS receipt is required before releasing resource claims.
BEGIN;
ALTER TABLE lr_gold_device_resource_claims
  ADD COLUMN process_id TEXT CHECK(process_id ~ '^lp_[A-Za-z0-9_-]{20,80}$'),
  ADD COLUMN worker_state TEXT NOT NULL DEFAULT 'admitting'
    CHECK(worker_state IN ('admitting','running','terminal_unknown')),
  ADD COLUMN launch_observed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX lr_gold_m4_device_process_lease
  ON lr_gold_device_resource_claims(device_id,process_id)
  WHERE process_id IS NOT NULL;
CREATE INDEX lr_gold_m4_process_reconciliation
  ON lr_gold_device_resource_claims(device_id,worker_state,claimed_at)
  WHERE process_id IS NOT NULL;
COMMIT;
