-- Independent Light Remote Gold: canonical Site CMS + analytics stores.
-- Immutable extension to RC50 migrations 001-013. No legacy file store.
BEGIN;
ALTER TABLE lr_notifications ADD COLUMN IF NOT EXISTS canceled_by TEXT;
CREATE TABLE IF NOT EXISTS lr_site_announcements(
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 8 AND 100),
  payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lr_site_analytics_daily(
  day DATE PRIMARY KEY,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metrics)='object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- App role never owns/migrates schema and cannot alter the migration ledger.
GRANT USAGE ON SCHEMA public TO lr_gold_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lr_gold_app;
REVOKE INSERT, UPDATE, DELETE ON lr_schema_migrations FROM lr_gold_app;
GRANT SELECT ON lr_schema_migrations TO lr_gold_app;
COMMIT;
