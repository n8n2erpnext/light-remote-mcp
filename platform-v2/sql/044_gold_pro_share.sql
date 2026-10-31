-- P2-I4 SOURCE CANDIDATE ONLY. Not in migrations.lock.json.
-- Owner + exactly one Free (or other eligible) guest. Independent of Pro Team.
-- Do NOT apply to Gold UAT or production before integrated release sign-off.
BEGIN;
CREATE TABLE lr_gold_pro_share_addons (
  owner_account_id TEXT PRIMARY KEY REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('trial','active','paused','revoked')),
  valid_until_ms BIGINT NOT NULL CHECK(valid_until_ms > 0),
  monthly_guest_call_budget INTEGER NOT NULL CHECK(monthly_guest_call_budget BETWEEN 1 AND 1000000),
  source VARCHAR(70) NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK(revision >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE lr_gold_pro_share_seats (
  owner_account_id TEXT PRIMARY KEY REFERENCES lr_gold_pro_share_addons(owner_account_id) ON DELETE CASCADE,
  guest_account_id TEXT REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  invited_email VARCHAR(254),
  invite_hash CHAR(64) CHECK(invite_hash ~ '^[a-f0-9]{64}$'),
  invite_expires_ms BIGINT,
  status TEXT NOT NULL DEFAULT 'empty' CHECK(status IN ('empty','invited','accepted')),
  accepted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(guest_account_id IS NULL OR guest_account_id <> owner_account_id),
  CHECK(
    (status = 'empty' AND guest_account_id IS NULL AND invite_hash IS NULL AND invited_email IS NULL AND invite_expires_ms IS NULL)
    OR (status = 'invited' AND guest_account_id IS NULL AND invite_hash IS NOT NULL AND invited_email IS NOT NULL AND invite_expires_ms > 0)
    OR (status = 'accepted' AND guest_account_id IS NOT NULL AND invite_hash IS NULL AND invited_email IS NULL AND invite_expires_ms IS NULL)
  )
);
CREATE UNIQUE INDEX lr_gold_pro_share_guest_seat_active
  ON lr_gold_pro_share_seats(guest_account_id) WHERE status = 'accepted';
CREATE TABLE lr_gold_pro_share_devices (
  owner_account_id TEXT NOT NULL REFERENCES lr_gold_pro_share_addons(owner_account_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id) ON DELETE CASCADE,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_account_id,device_id)
);
CREATE INDEX lr_gold_pro_share_devices_device_idx ON lr_gold_pro_share_devices(device_id);
CREATE TABLE lr_gold_pro_share_usage_events (
  owner_account_id TEXT NOT NULL REFERENCES lr_gold_pro_share_addons(owner_account_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 16 AND 160),
  guest_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
  agent_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  period_utc INTEGER NOT NULL CHECK(period_utc BETWEEN 202001 AND 999912),
  units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 10000),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_account_id,operation_id)
);
CREATE INDEX lr_gold_pro_share_usage_period_idx
  ON lr_gold_pro_share_usage_events(owner_account_id,period_utc);
-- No public/guest SQL privileges; only trusted Operator Gold app role can write.
GRANT SELECT,INSERT,UPDATE,DELETE ON
 lr_gold_pro_share_addons,lr_gold_pro_share_seats,
 lr_gold_pro_share_devices,lr_gold_pro_share_usage_events TO lr_gold_app;
COMMIT;
