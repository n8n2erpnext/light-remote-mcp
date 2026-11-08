-- Gold M6 durable signed terminal receipt ACK ledger.
-- The receipt and released lease are committed in the same transaction.
BEGIN;
CREATE TABLE lr_gold_terminal_receipt_acks(
 account_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 process_id TEXT NOT NULL CHECK(process_id ~ '^lp_[A-Za-z0-9_-]{20,80}$'),
 job_id TEXT NOT NULL,
 terminal_state TEXT NOT NULL CHECK(terminal_state IN ('finished','stopped','timeout','error')),
 finished_at_ms BIGINT NOT NULL CHECK(finished_at_ms>0),
 acked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,device_id,process_id)
);
CREATE INDEX lr_gold_terminal_receipt_acks_job ON lr_gold_terminal_receipt_acks(job_id);
GRANT SELECT,INSERT ON lr_gold_terminal_receipt_acks TO lr_gold_app;
COMMIT;
