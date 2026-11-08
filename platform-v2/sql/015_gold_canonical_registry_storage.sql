-- Light Remote Gold canonical registry storage; replaces JSON-file databases.
-- JSONB is PostgreSQL table data, never a filesystem JSON fallback.
BEGIN;
-- Canonical Account identities now live in PostgreSQL registry rows. The API
-- verifies ownership before inserting notification read receipts.
ALTER TABLE lr_notification_reads DROP CONSTRAINT IF EXISTS lr_notification_reads_account_id_fkey;
CREATE TABLE IF NOT EXISTS lr_gold_registry_documents(
  domain TEXT PRIMARY KEY CHECK(domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
  revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_gold_registry_documents TO lr_gold_app;
COMMIT;
