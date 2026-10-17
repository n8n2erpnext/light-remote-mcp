-- Gold normalized Core identity/device extension.
-- Expand the immutable RC.50 synthetic relational model, no JSON file fallback.
BEGIN;
ALTER TABLE lr_accounts ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE lr_accounts ADD COLUMN IF NOT EXISTS google_sub TEXT;
ALTER TABLE lr_accounts ADD COLUMN IF NOT EXISTS group_id TEXT NOT NULL DEFAULT 'grp_default';
ALTER TABLE lr_accounts ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE lr_accounts ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE lr_accounts ADD COLUMN IF NOT EXISTS password_enabled BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS lr_accounts_google_sub_unique ON lr_accounts(google_sub) WHERE google_sub IS NOT NULL;
ALTER TABLE lr_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE lr_sessions ADD COLUMN IF NOT EXISTS revoked_reason TEXT;
ALTER TABLE lr_devices ADD COLUMN IF NOT EXISTS node_id TEXT;
ALTER TABLE lr_devices ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE lr_devices ADD COLUMN IF NOT EXISTS public_identity_key TEXT;
ALTER TABLE lr_devices ADD COLUMN IF NOT EXISTS policy_profile TEXT NOT NULL DEFAULT 'default';
ALTER TABLE lr_devices ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE lr_devices ADD COLUMN IF NOT EXISTS architecture TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE lr_devices ADD COLUMN IF NOT EXISTS agent_version TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE lr_devices ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS lr_devices_node_id_unique ON lr_devices(node_id) WHERE node_id IS NOT NULL;
-- A/B requests are scoped to a particular owner-controlled connection;
-- attempt counters block high-rate code guessing even with valid channel proof.
ALTER TABLE lr_ab_requests ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lr_ab_requests ADD CONSTRAINT lr_ab_request_attempts_limit CHECK(failed_attempts BETWEEN 0 AND 5);
-- Durable Team device sharing and separately scoped team-member grants.
-- Keep connection owner bound to lr_ab_grants.account_id. Actor rights live
-- in this additional table, verified against active Team membership on use.
CREATE TABLE IF NOT EXISTS lr_team_devices (
  team_id TEXT NOT NULL REFERENCES lr_teams(team_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id) ON DELETE CASCADE,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,device_id)
);
CREATE TABLE IF NOT EXISTS lr_ab_team_actor_grants (
  grant_id TEXT PRIMARY KEY REFERENCES lr_ab_grants(grant_id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES lr_teams(team_id) ON DELETE CASCADE,
  actor_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(grant_id,actor_account_id,device_id),
  FOREIGN KEY(team_id,actor_account_id) REFERENCES lr_team_members(team_id,account_id)
);
-- A verified payment event is immutable. This is an idempotency index, not
-- permission to grant an entitlement before signature/account checks.
CREATE INDEX IF NOT EXISTS lr_billing_provider_owner_idx ON lr_billing_events(provider,owner_account_id,recorded_at DESC);
INSERT INTO lr_schema_migrations(version) VALUES(17) ON CONFLICT DO NOTHING;
COMMIT;
