-- Gold source candidate: exactly-one-Owner authority and durable handoff.
-- NOT in signed migrations.lock.json. DO NOT APPLY TO GOLD UAT / PRODUCTION.
-- Test on disposable Gold A/B V2 LXD only after explicit release gating.
BEGIN;
CREATE TABLE lr_gold_owner_authority (
 singleton_id SMALLINT PRIMARY KEY CHECK (singleton_id=1),
 owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE RESTRICT,
 revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE lr_gold_owner_handoffs (
 owner_revision BIGINT PRIMARY KEY CHECK (owner_revision > 0),
 from_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE RESTRICT,
 to_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE RESTRICT,
 transferred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (from_account_id <> to_account_id)
);
COMMIT;
