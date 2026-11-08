-- Allow a real owner-requested queued cancellation to persist durably.
-- The Operator emits status='cancelled' after the job is conclusively stopped,
-- but the original job ledger status constraint omitted that terminal status.
BEGIN;
ALTER TABLE lr_gold_job_records
  DROP CONSTRAINT lr_gold_job_records_status_check;
ALTER TABLE lr_gold_job_records
  ADD CONSTRAINT lr_gold_job_records_status_check
  CHECK (status IN ('queued','running','ok','error','timeout','interrupted','cancelled'));
COMMIT;
