-- Gold-only Support Outbox: durable PostgreSQL rows, no JSON snapshot.
-- A delivery lease is a scoped, expiring fence. Remote ERPNext idempotency
-- additionally depends on ERPNext honoring stable payload.event_id.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_support_outbox (
 event_id TEXT PRIMARY KEY CHECK(event_id ~ '^lr[.]support[.][0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 account_id TEXT NOT NULL,
 account_email TEXT NOT NULL,
 account_plan TEXT NOT NULL CHECK(account_plan IN ('pro','vip')),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 next_attempt_at TIMESTAMPTZ,
 delivered_at TIMESTAMPTZ,
 remote_status TEXT,
 result_name TEXT,
 status_check_attempts INTEGER NOT NULL DEFAULT 0,
 next_status_check_at TIMESTAMPTZ,
 last_error TEXT,
 lease_token UUID,
 lease_until TIMESTAMPTZ,
 lease_kind TEXT CHECK(lease_kind IS NULL OR lease_kind IN ('delivery','status')),
 CONSTRAINT lr_support_lease_consistent CHECK (
  (lease_token IS NULL AND lease_until IS NULL AND lease_kind IS NULL)
  OR (lease_token IS NOT NULL AND lease_until IS NOT NULL AND lease_kind IS NOT NULL)),
 CONSTRAINT lr_support_payload_id_consistent CHECK((payload ? 'event_id') AND payload->>'event_id'=event_id)
);
CREATE INDEX IF NOT EXISTS lr_support_outbox_due ON lr_support_outbox(next_attempt_at,created_at)
 WHERE status='queued';
CREATE INDEX IF NOT EXISTS lr_support_outbox_status_due ON lr_support_outbox(next_status_check_at,delivered_at)
 WHERE status='sent' AND result_name IS NULL;
CREATE INDEX IF NOT EXISTS lr_support_outbox_owner ON lr_support_outbox(account_id,created_at DESC);
INSERT INTO lr_schema_migrations(version) VALUES(16) ON CONFLICT DO NOTHING;
COMMIT;
