-- Light Remote rc.50 isolated UAT database. Does NOT touch legacy JSON/SQLite.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_schema_migrations (
  version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lr_accounts (
  account_id TEXT PRIMARY KEY CHECK(length(account_id) BETWEEN 1 AND 128),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 5 AND 254),
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','pro','vip')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','dormant','admin_disabled')),
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lr_accounts_email_ci ON lr_accounts(lower(email));
CREATE TABLE IF NOT EXISTS lr_sessions (
  session_id TEXT PRIMARY KEY CHECK(length(session_id) BETWEEN 10 AND 160),
  account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  token_sha256 TEXT NOT NULL UNIQUE CHECK(token_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_sessions_account_expiry ON lr_sessions(account_id,expires_at);
CREATE TABLE IF NOT EXISTS lr_devices (
  device_id TEXT PRIMARY KEY CHECK(length(device_id) BETWEEN 1 AND 160),
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  state TEXT NOT NULL DEFAULT 'registered' CHECK(state IN ('registered','online','offline','revoked')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_devices_owner_idx ON lr_devices(owner_account_id);
CREATE TABLE IF NOT EXISTS lr_teams (
  team_id TEXT PRIMARY KEY CHECK(length(team_id) BETWEEN 1 AND 160),
  owner_account_id TEXT NOT NULL UNIQUE REFERENCES lr_accounts(account_id),
  seat_cap SMALLINT NOT NULL DEFAULT 5 CHECK(seat_cap BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lr_team_members (
  team_id TEXT NOT NULL REFERENCES lr_teams(team_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,account_id)
);
CREATE TABLE IF NOT EXISTS lr_entitlements (
  entitlement_id TEXT PRIMARY KEY CHECK(length(entitlement_id) BETWEEN 1 AND 160),
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  kind TEXT NOT NULL CHECK(kind IN ('personal_pro','pro_team','vip','trial')),
  source TEXT NOT NULL CHECK(length(source) BETWEEN 1 AND 100),
  source_ref TEXT,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK(valid_until IS NULL OR valid_until>effective_at)
);
CREATE INDEX IF NOT EXISTS lr_entitlements_owner_idx ON lr_entitlements(owner_account_id,effective_at DESC);
CREATE TABLE IF NOT EXISTS lr_team_invites (
  invite_sha256 TEXT PRIMARY KEY CHECK(invite_sha256 ~ '^[0-9a-f]{64}$'),
  team_id TEXT NOT NULL REFERENCES lr_teams(team_id),
  recipient_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by TEXT REFERENCES lr_accounts(account_id),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((accepted_by IS NULL)=(accepted_at IS NULL))
);
CREATE TABLE IF NOT EXISTS lr_worker_slots (
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id) ON DELETE CASCADE,
  slot_number SMALLINT NOT NULL CHECK(slot_number BETWEEN 1 AND 3),
  generation BIGINT NOT NULL DEFAULT 0,
  job_id TEXT,
  lease_token_sha256 TEXT CHECK(lease_token_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ,
  PRIMARY KEY(device_id,slot_number)
);
CREATE TABLE IF NOT EXISTS lr_jobs (
  job_id TEXT PRIMARY KEY CHECK(length(job_id) BETWEEN 1 AND 160),
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  actor_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
  operation_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','canceled','lease_expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE(owner_account_id,actor_account_id,device_id,operation_id)
);
CREATE INDEX IF NOT EXISTS lr_jobs_owner_created_idx ON lr_jobs(owner_account_id,created_at DESC);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_worker_slots_job_fk' AND conrelid = 'lr_worker_slots'::regclass) THEN
    ALTER TABLE lr_worker_slots ADD CONSTRAINT lr_worker_slots_job_fk
      FOREIGN KEY (job_id) REFERENCES lr_jobs(job_id) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS lr_usage_events (
  event_id TEXT PRIMARY KEY CHECK(length(event_id) BETWEEN 1 AND 160),
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  actor_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  device_id TEXT REFERENCES lr_devices(device_id),
  job_id TEXT REFERENCES lr_jobs(job_id),
  month_key CHAR(7) NOT NULL CHECK(month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  tool_calls INTEGER NOT NULL CHECK(tool_calls >= 0),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_usage_owner_month ON lr_usage_events(owner_account_id,month_key);
CREATE UNIQUE INDEX IF NOT EXISTS lr_usage_job_once ON lr_usage_events(job_id) WHERE job_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS lr_billing_events (
  event_id TEXT PRIMARY KEY CHECK(length(event_id) BETWEEN 1 AND 160),
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  provider TEXT NOT NULL CHECK(provider IN ('paddle','manual')),
  external_transaction_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('payment','refund','subscription_update','entitlement_grant','entitlement_revoke')),
  amount_minor BIGINT CHECK(amount_minor >= 0),
  currency CHAR(3),
  provider_event_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lr_billing_provider_event_unique ON lr_billing_events(provider,provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lr_billing_owner_idx ON lr_billing_events(owner_account_id,recorded_at DESC);
CREATE TABLE IF NOT EXISTS lr_outbox (
  outbox_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  visible_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS lr_outbox_pending_idx ON lr_outbox(visible_at,outbox_id) WHERE delivered_at IS NULL;
INSERT INTO lr_schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
