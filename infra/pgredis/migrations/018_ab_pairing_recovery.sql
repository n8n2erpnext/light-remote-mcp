-- Gold A/B approval recovery binds one request to exactly one grant.
-- The polling agent knows only a SHA256-held one-time poll capability, not the B code.
BEGIN;
ALTER TABLE lr_ab_requests
  ADD COLUMN IF NOT EXISTS approved_grant_id TEXT REFERENCES lr_ab_grants(grant_id);
ALTER TABLE lr_ab_requests
  ADD COLUMN IF NOT EXISTS actor_account_id TEXT REFERENCES lr_accounts(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_ab_requests_approved_grant_unique
  ON lr_ab_requests(approved_grant_id)
  WHERE approved_grant_id IS NOT NULL;
ALTER TABLE lr_ab_requests
  ADD CONSTRAINT lr_ab_approved_grant_only_if_approved CHECK (
    approved_grant_id IS NULL OR state='approved'
  );
INSERT INTO lr_schema_migrations(version) VALUES(18) ON CONFLICT DO NOTHING;
COMMIT;
