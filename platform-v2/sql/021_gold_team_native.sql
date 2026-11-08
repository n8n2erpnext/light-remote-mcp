-- Native Pro Team persistence: existing rc50 team/tier membership tables are authoritative.
BEGIN;
CREATE TABLE lr_gold_team_shared_devices(
  team_id TEXT NOT NULL REFERENCES lr_teams(team_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id) ON DELETE CASCADE,
  PRIMARY KEY(team_id,device_id)
);
CREATE TABLE lr_gold_team_entitlements(
  owner_account_id TEXT PRIMARY KEY REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  valid_until_ms BIGINT NOT NULL,
  monthly_member_call_budget INTEGER NOT NULL CHECK(monthly_member_call_budget BETWEEN 1 AND 1000000),
  source VARCHAR(70) NOT NULL
);
CREATE TABLE lr_gold_team_invite_codes(
  code_sha256 CHAR(64) PRIMARY KEY CHECK(code_sha256 ~ '^[a-f0-9]{64}$'),
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  member_account_id TEXT REFERENCES lr_accounts(account_id),
  member_email VARCHAR(254),
  cipher TEXT,
  expires_ms BIGINT NOT NULL,
  CHECK((member_account_id IS NOT NULL)<>(member_email IS NOT NULL))
);
CREATE TABLE lr_gold_team_notification_reads(
  account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  code_sha256 CHAR(64) NOT NULL,
  read_ms BIGINT NOT NULL,
  PRIMARY KEY(account_id,code_sha256)
);
CREATE TABLE lr_gold_team_email_invite_events(
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  member_email VARCHAR(254) NOT NULL,
  issued_ms BIGINT NOT NULL
);
CREATE INDEX lr_gold_team_email_invite_window ON lr_gold_team_email_invite_events(owner_account_id,issued_ms DESC);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_teams,lr_team_members,lr_gold_team_shared_devices,
 lr_gold_team_entitlements,lr_gold_team_invite_codes,lr_gold_team_notification_reads,lr_gold_team_email_invite_events TO lr_gold_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO lr_gold_app;
COMMIT;
