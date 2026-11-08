-- Scalable month totals: event-level idempotency + transactional aggregate.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_usage_monthly (
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  month_key CHAR(7) NOT NULL CHECK(month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  tool_calls BIGINT NOT NULL DEFAULT 0 CHECK(tool_calls >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_account_id,month_key)
);
-- Controlled reconciliation: events remain authoritative. Re-running on UAT is safe.
INSERT INTO lr_usage_monthly(owner_account_id,month_key,tool_calls)
 SELECT owner_account_id,month_key,SUM(tool_calls) FROM lr_usage_events
 GROUP BY owner_account_id,month_key
 ON CONFLICT (owner_account_id,month_key)
 DO UPDATE SET tool_calls=EXCLUDED.tool_calls,updated_at=now();
INSERT INTO lr_schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
COMMIT;
