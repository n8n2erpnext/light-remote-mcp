-- Gold-only Team Agent binding: RC50 migration 004 intentionally forbids
-- using owner-scoped lr_agent_bindings for member grants. Preserve that FK.
-- This separate relational table binds verified member sessions to the exact
-- Team grant and owner connection, with current membership checked on use.
BEGIN;
-- Optional pairing request IDs must refer to the exact approved grant.
CREATE UNIQUE INDEX IF NOT EXISTS lr_ab_pairing_request_grant_pair_unique
  ON lr_ab_requests(request_id,approved_grant_id);
CREATE TABLE IF NOT EXISTS lr_agent_team_bindings (
  client_session_id TEXT NOT NULL,
  actor_account_id TEXT NOT NULL,
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  device_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  grant_purpose TEXT NOT NULL DEFAULT 'team-member'
    CHECK(grant_purpose='team-member'),
  pairing_request_id TEXT REFERENCES lr_ab_requests(request_id),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(client_session_id,device_id),
  FOREIGN KEY(client_session_id,actor_account_id)
    REFERENCES lr_agent_clients(client_session_id,account_id),
  FOREIGN KEY(grant_id,actor_account_id,device_id)
    REFERENCES lr_ab_team_actor_grants(grant_id,actor_account_id,device_id),
  FOREIGN KEY(grant_id,device_id,connection_id,owner_account_id,grant_purpose)
    REFERENCES lr_ab_grants(grant_id,device_id,connection_id,account_id,purpose),
  FOREIGN KEY(pairing_request_id,grant_id)
    REFERENCES lr_ab_requests(request_id,approved_grant_id)
);
CREATE INDEX IF NOT EXISTS lr_agent_team_bindings_actor_device_idx
  ON lr_agent_team_bindings(actor_account_id,device_id);
CREATE INDEX IF NOT EXISTS lr_agent_team_bindings_grant_idx
  ON lr_agent_team_bindings(grant_id);
INSERT INTO lr_schema_migrations(version) VALUES(19) ON CONFLICT DO NOTHING;
COMMIT;
