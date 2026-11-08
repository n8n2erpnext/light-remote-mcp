-- Additive Gold execution fencing after migration 040. Independent PostgreSQL
-- authority shared by ALL Operator processes; no Redis/in-memory epoch state.
BEGIN;
CREATE TABLE lr_gold_device_execution_epochs (
  device_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  epoch BIGINT NOT NULL CHECK(epoch > 0),
  agent_instance_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  inventory_at TIMESTAMPTZ,
  inventory_sha256 TEXT CHECK(inventory_sha256 IS NULL OR inventory_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE TABLE lr_gold_execution_command_issuance (
  command_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  epoch BIGINT NOT NULL CHECK(epoch > 0),
  payload_sha256 TEXT NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lr_gold_execution_commands_device ON lr_gold_execution_command_issuance(device_id,epoch);
-- Bounded signed process snapshots can contain up to 64 x 128 metadata rows.
-- No scripts, stdout, filesystem contents or credentials enter this ledger.
CREATE TABLE lr_gold_device_execution_inventory_pages (
  device_id TEXT NOT NULL,
  epoch BIGINT NOT NULL,
  snapshot_id TEXT NOT NULL CHECK(snapshot_id ~ '^[0-9a-f]{32}$'),
  page_index INTEGER NOT NULL CHECK(page_index BETWEEN 0 AND 63),
  page_count INTEGER NOT NULL CHECK(page_count BETWEEN 1 AND 64),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(device_id,epoch,snapshot_id,page_index)
);
-- An Agent must obtain an authoritative start authorization before its local
-- write-ahead reservation and first OS effect. Duplicate starts fail closed.
CREATE TABLE lr_gold_execution_effect_starts (
  command_id TEXT PRIMARY KEY REFERENCES lr_gold_execution_command_issuance(command_id),
  device_id TEXT NOT NULL,
  epoch BIGINT NOT NULL CHECK(epoch > 0),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT,INSERT,UPDATE ON lr_gold_device_execution_epochs TO lr_gold_app;
GRANT SELECT,INSERT ON lr_gold_execution_command_issuance TO lr_gold_app;
GRANT SELECT,INSERT ON lr_gold_device_execution_inventory_pages TO lr_gold_app;
GRANT SELECT,INSERT ON lr_gold_execution_effect_starts TO lr_gold_app;
COMMIT;
