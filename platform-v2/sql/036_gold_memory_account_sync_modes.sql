-- Gold Memory Sync per-device account policy: metadata only, no Memory content.
-- Migrator role runs this once; Operator runtime has DML only.
BEGIN;
CREATE TABLE lr_gold_memory_sync_accounts(
 account_id TEXT PRIMARY KEY,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 revision BIGINT NOT NULL DEFAULT 0 CHECK(revision>=0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE lr_gold_memory_sync_devices(
 account_id TEXT NOT NULL REFERENCES lr_gold_memory_sync_accounts(account_id) ON DELETE CASCADE,
 device_id TEXT NOT NULL,
 selected BOOLEAN NOT NULL DEFAULT FALSE,
 mode TEXT NOT NULL DEFAULT 'auto' CHECK(mode IN ('auto','follow_project','manual')),
 manual_request_seq BIGINT NOT NULL DEFAULT 0 CHECK(manual_request_seq>=0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(account_id,device_id)
);
REVOKE ALL ON lr_gold_memory_sync_accounts FROM PUBLIC;
REVOKE ALL ON lr_gold_memory_sync_devices FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON lr_gold_memory_sync_accounts TO lr_gold_app;
GRANT SELECT,INSERT,UPDATE ON lr_gold_memory_sync_devices TO lr_gold_app;
COMMIT;
