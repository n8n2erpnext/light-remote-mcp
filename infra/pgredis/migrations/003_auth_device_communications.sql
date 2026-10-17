-- rc.50 isolated UAT only. Future persistent auth, device and communication entities.
-- Legacy operator and OAuth facade are NOT connected to these tables.
BEGIN;

CREATE TABLE IF NOT EXISTS lr_oauth_one_time (
  token_sha256 TEXT PRIMARY KEY CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  purpose TEXT NOT NULL CHECK (purpose IN ('authorization_code','refresh','resume','magic','email_verify','password_reset')),
  account_id TEXT REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  client_id TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (expires_at > issued_at),
  CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);
CREATE INDEX IF NOT EXISTS lr_oauth_expiry_idx ON lr_oauth_one_time(purpose,expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS lr_device_connections (
  connection_id TEXT PRIMARY KEY CHECK (length(connection_id) BETWEEN 1 AND 160),
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
  account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  plan TEXT NOT NULL CHECK(plan IN ('free','pro','vip')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hard_expires_at TIMESTAMPTZ NOT NULL,
  reconnect_grace_ms INTEGER NOT NULL CHECK(reconnect_grace_ms BETWEEN 900000 AND 3600000),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  CHECK(hard_expires_at > connected_at)
);
CREATE INDEX IF NOT EXISTS lr_connections_device_active_idx ON lr_device_connections(device_id,hard_expires_at DESC) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS lr_connections_account_idx ON lr_device_connections(account_id,hard_expires_at DESC);
-- Cross-tenant connection grants require the account to match the connection account.
CREATE UNIQUE INDEX IF NOT EXISTS lr_connections_bound_idx ON lr_device_connections(connection_id,device_id,account_id);

CREATE TABLE IF NOT EXISTS lr_ab_requests (
  request_id TEXT PRIMARY KEY CHECK(length(request_id) BETWEEN 1 AND 160),
  account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
  connection_id TEXT NOT NULL REFERENCES lr_device_connections(connection_id),
  agent_id TEXT,
  purpose TEXT NOT NULL CHECK(purpose IN ('device','team-member')),
  poll_sha256 TEXT NOT NULL UNIQUE CHECK(poll_sha256 ~ '^[0-9a-f]{64}$'),
  display_code_ciphertext BYTEA,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','denied','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK(expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX IF NOT EXISTS lr_ab_requests_pending_idx ON lr_ab_requests(device_id,expires_at) WHERE state='pending';

CREATE TABLE IF NOT EXISTS lr_ab_grants (
  grant_id TEXT PRIMARY KEY CHECK(length(grant_id) BETWEEN 1 AND 160),
  account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
  connection_id TEXT NOT NULL,
  agent_id TEXT,
  purpose TEXT NOT NULL CHECK(purpose IN ('device','team-member')),
  approved_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  idle_grace_ms INTEGER NOT NULL CHECK(idle_grace_ms BETWEEN 900000 AND 86400000),
  expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  FOREIGN KEY(connection_id,device_id,account_id) REFERENCES lr_device_connections(connection_id,device_id,account_id),
  CHECK(absolute_expires_at <= approved_at + interval '24 hours'),
  CHECK(absolute_expires_at > approved_at),
  CHECK(expires_at <= absolute_expires_at)
);
CREATE INDEX IF NOT EXISTS lr_ab_grants_active_idx ON lr_ab_grants(account_id,device_id,expires_at) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS lr_agent_clients (
  client_session_id TEXT PRIMARY KEY CHECK(length(client_session_id) BETWEEN 1 AND 180),
  account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  agent_id TEXT NOT NULL CHECK(length(agent_id) BETWEEN 1 AND 180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  default_device_id TEXT REFERENCES lr_devices(device_id)
);
CREATE INDEX IF NOT EXISTS lr_agent_clients_active_idx ON lr_agent_clients(account_id,agent_id,expires_at) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS lr_agent_bindings (
  client_session_id TEXT NOT NULL REFERENCES lr_agent_clients(client_session_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
  grant_id TEXT NOT NULL REFERENCES lr_ab_grants(grant_id),
  connection_id TEXT NOT NULL REFERENCES lr_device_connections(connection_id),
  pairing_request_id TEXT,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(client_session_id,device_id)
);

CREATE TABLE IF NOT EXISTS lr_enrollment_challenges (
  challenge_id TEXT PRIMARY KEY CHECK(length(challenge_id) BETWEEN 1 AND 160),
  request_account_id TEXT REFERENCES lr_accounts(account_id),
  code_sha256 TEXT NOT NULL UNIQUE CHECK(code_sha256 ~ '^[0-9a-f]{64}$'),
  public_key_sha256 TEXT NOT NULL CHECK(public_key_sha256 ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','expired','consumed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK(expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS lr_enrollment_pending_idx ON lr_enrollment_challenges(expires_at) WHERE state='pending';

CREATE TABLE IF NOT EXISTS lr_license_keys (
  license_id TEXT PRIMARY KEY CHECK(length(license_id) BETWEEN 1 AND 160),
  key_sha256 TEXT NOT NULL UNIQUE CHECK(key_sha256 ~ '^[0-9a-f]{64}$'),
  key_last4 CHAR(4) NOT NULL,
  plan TEXT NOT NULL CHECK(plan IN ('pro','vip')),
  duration_ms BIGINT NOT NULL CHECK(duration_ms BETWEEN 86400000 AND 315360000000),
  max_redemptions INTEGER NOT NULL CHECK(max_redemptions BETWEEN 1 AND 1000),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  label TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS lr_license_redemptions (
  license_id TEXT NOT NULL REFERENCES lr_license_keys(license_id),
  account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(license_id,account_id)
);

CREATE TABLE IF NOT EXISTS lr_notifications (
  notification_id TEXT PRIMARY KEY CHECK(length(notification_id) BETWEEN 1 AND 160),
  category TEXT NOT NULL CHECK(category IN ('update','feature','promotion','maintenance','security','account')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 140),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 2 AND 2000),
  link TEXT NOT NULL DEFAULT '/account/inbox' CHECK(left(link,1)='/' AND left(link,2)<>'//'),
  audience_type TEXT NOT NULL DEFAULT 'all' CHECK(audience_type IN ('all','account','plan','group')),
  audience_value TEXT,
  published_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  CHECK((audience_type='all' AND audience_value IS NULL) OR (audience_type<>'all' AND audience_value IS NOT NULL)),
  CHECK(expires_at IS NULL OR expires_at > scheduled_at)
);
CREATE INDEX IF NOT EXISTS lr_notifications_schedule_idx ON lr_notifications(scheduled_at) WHERE canceled_at IS NULL;
CREATE TABLE IF NOT EXISTS lr_notification_reads (
  notification_id TEXT NOT NULL REFERENCES lr_notifications(notification_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(notification_id,account_id)
);

CREATE TABLE IF NOT EXISTS lr_audit_events (
  event_id TEXT PRIMARY KEY CHECK(length(event_id) BETWEEN 1 AND 160),
  actor_account_id TEXT REFERENCES lr_accounts(account_id),
  owner_account_id TEXT REFERENCES lr_accounts(account_id),
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 100),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_audit_owner_created_idx ON lr_audit_events(owner_account_id,created_at DESC);

INSERT INTO lr_schema_migrations(version) VALUES(3) ON CONFLICT DO NOTHING;
COMMIT;
