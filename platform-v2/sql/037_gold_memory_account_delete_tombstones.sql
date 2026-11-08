-- Durable account-wide deletion metadata ONLY; no memory payloads.
BEGIN;
CREATE TABLE lr_gold_memory_delete_requests(
 account_id TEXT NOT NULL,scope_id TEXT NOT NULL,home_device_id TEXT NOT NULL,
 home_epoch INTEGER NOT NULL CHECK(home_epoch>0),generation INTEGER NOT NULL CHECK(generation=1),
 scope_name TEXT NOT NULL,
 issued_at BIGINT NOT NULL CHECK(issued_at>0),
 home_public_key TEXT NOT NULL,home_signature TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(account_id,scope_id)
);
CREATE TABLE lr_gold_memory_delete_targets(
 account_id TEXT NOT NULL,scope_id TEXT NOT NULL,device_id TEXT NOT NULL,
 acknowledged_at TIMESTAMPTZ NULL,PRIMARY KEY(account_id,scope_id,device_id),
 FOREIGN KEY(account_id,scope_id) REFERENCES lr_gold_memory_delete_requests(account_id,scope_id)
);
CREATE INDEX lr_gold_memory_delete_pending ON lr_gold_memory_delete_targets(account_id,device_id,acknowledged_at);
REVOKE ALL ON lr_gold_memory_delete_requests FROM PUBLIC;
REVOKE ALL ON lr_gold_memory_delete_targets FROM PUBLIC;
GRANT SELECT,INSERT ON lr_gold_memory_delete_requests TO lr_gold_app;
GRANT SELECT,INSERT,UPDATE ON lr_gold_memory_delete_targets TO lr_gold_app;
COMMIT;
