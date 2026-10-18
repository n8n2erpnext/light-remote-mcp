-- Native core Account and Device schema extending the RC50 canonical tables.
-- Do not store whole account or device snapshots in JSONB.
BEGIN;
ALTER TABLE lr_accounts
  ADD COLUMN IF NOT EXISTS password_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_sub TEXT,
  ADD COLUMN IF NOT EXISTS group_id TEXT,
  ADD COLUMN IF NOT EXISTS main_device_id TEXT,
  ADD COLUMN IF NOT EXISTS last_login_ms BIGINT,
  ADD COLUMN IF NOT EXISTS status_reason TEXT,
  ADD COLUMN IF NOT EXISTS dormant_ms BIGINT,
  ADD COLUMN IF NOT EXISTS disabled_ms BIGINT,
  ADD COLUMN IF NOT EXISTS disabled_by TEXT,
  ADD COLUMN IF NOT EXISTS disable_reason TEXT,
  ADD COLUMN IF NOT EXISTS reactivated_ms BIGINT,
  ADD COLUMN IF NOT EXISTS last_device_added_ms BIGINT,
  ADD COLUMN IF NOT EXISTS dormancy_anchor_ms BIGINT,
  ADD COLUMN IF NOT EXISTS dormancy_notice14_ms BIGINT,
  ADD COLUMN IF NOT EXISTS dormancy_notice3_ms BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS lr_accounts_google_sub_unique ON lr_accounts(google_sub) WHERE google_sub IS NOT NULL;
CREATE TABLE IF NOT EXISTS lr_gold_account_entitlements(
  account_id TEXT PRIMARY KEY REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  entitlement_id TEXT,
  plan TEXT NOT NULL CHECK(plan IN ('free','pro','vip')),
  source TEXT NOT NULL,
  source_ref TEXT,
  valid_from_ms BIGINT NOT NULL,
  valid_until_ms BIGINT,
  granted_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS lr_gold_fleet_provisioning(
 account_id TEXT PRIMARY KEY REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
 device_id TEXT,
 state TEXT NOT NULL,
 reason TEXT,
 module_version TEXT,
 agent_version TEXT,
 minimum_supported_version TEXT,
 latest_version TEXT,
 update_required BOOLEAN NOT NULL DEFAULT false,
 port INTEGER CHECK(port BETWEEN 1 AND 65535),
 started_ms BIGINT NOT NULL,
 updated_ms BIGINT NOT NULL,
 online_ms BIGINT
);
ALTER TABLE lr_devices
  ADD COLUMN IF NOT EXISTS node_id TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT,
  ADD COLUMN IF NOT EXISTS architecture TEXT,
  ADD COLUMN IF NOT EXISTS agent_version TEXT,
  ADD COLUMN IF NOT EXISTS first_seen_ms BIGINT,
  ADD COLUMN IF NOT EXISTS last_seen_ms BIGINT,
  ADD COLUMN IF NOT EXISTS offline_ms BIGINT,
  ADD COLUMN IF NOT EXISTS revoked_ms BIGINT,
  ADD COLUMN IF NOT EXISTS public_identity_key TEXT,
  ADD COLUMN IF NOT EXISTS capabilities TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS policy_profile TEXT,
  ADD COLUMN IF NOT EXISTS update_state TEXT,
  ADD COLUMN IF NOT EXISTS update_current_version TEXT,
  ADD COLUMN IF NOT EXISTS update_target_version TEXT,
  ADD COLUMN IF NOT EXISTS update_helper_version TEXT,
  ADD COLUMN IF NOT EXISTS update_code TEXT,
  ADD COLUMN IF NOT EXISTS update_ms BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS lr_devices_node_unique ON lr_devices(node_id) WHERE node_id IS NOT NULL;
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_accounts,lr_gold_account_entitlements,lr_gold_fleet_provisioning,lr_devices TO lr_gold_app;
COMMIT;
