-- Gold Remote Session authority. This is the durable context/lease ledger,
-- distinct from lr_sessions (web login sessions) and lr_agent_clients
-- (Agent credentials). No on-disk JSON business registry fallback.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_remote_sessions (
  session_id TEXT PRIMARY KEY CHECK(length(session_id) BETWEEN 12 AND 160),
  client_session_id TEXT NOT NULL,
  actor_account_id TEXT NOT NULL,
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  agent_id TEXT NOT NULL CHECK(length(agent_id) BETWEEN 1 AND 180),
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
  node_id TEXT NOT NULL CHECK(length(node_id) BETWEEN 1 AND 160),
  connection_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  grant_purpose TEXT NOT NULL CHECK(grant_purpose IN ('device','team-member')),
  label TEXT NOT NULL DEFAULT 'ChatGPT Light Remote' CHECK(length(label) BETWEEN 1 AND 120),
  workspace TEXT NOT NULL DEFAULT '' CHECK(length(workspace) <= 512),
  grace_preset TEXT NOT NULL DEFAULT '60m'
    CHECK(grace_preset IN ('15m','30m','45m','60m')),
  grace_ms INTEGER NOT NULL DEFAULT 3600000
    CHECK(grace_ms BETWEEN 900000 AND 3600000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  hold_reason TEXT CHECK(hold_reason IS NULL OR length(hold_reason) <= 80),
  reconnect_count INTEGER NOT NULL DEFAULT 0 CHECK(reconnect_count >= 0),
  FOREIGN KEY(client_session_id,actor_account_id)
    REFERENCES lr_agent_clients(client_session_id,account_id),
  FOREIGN KEY(grant_id,device_id,connection_id,owner_account_id,grant_purpose)
    REFERENCES lr_ab_grants(grant_id,device_id,connection_id,account_id,purpose),
  CHECK(expires_at >= last_seen_at)
);
-- Exactly one unclosed session per Agent/actor/device, even across workers.
-- Stale sessions must be marked closed in a locked transaction before reuse.
CREATE UNIQUE INDEX IF NOT EXISTS lr_remote_session_live_lane_unique
  ON lr_remote_sessions(actor_account_id,agent_id,device_id)
  WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS lr_remote_sessions_client_idx
  ON lr_remote_sessions(client_session_id,expires_at DESC);
CREATE INDEX IF NOT EXISTS lr_remote_sessions_expiry_idx
  ON lr_remote_sessions(expires_at) WHERE closed_at IS NULL;
INSERT INTO lr_schema_migrations(version) VALUES(20) ON CONFLICT DO NOTHING;
COMMIT;
