-- Paddle-first relational model: provider result is genuinely polymorphic,
-- stored per event/refund as JSONB, NOT a whole-state JSONB snapshot.
BEGIN;
CREATE TABLE lr_gold_paddle_events(
 event_id TEXT PRIMARY KEY,
 event_type TEXT NOT NULL,
 processed_ms BIGINT NOT NULL,
 result JSONB NOT NULL CHECK(jsonb_typeof(result)='object')
);
CREATE TABLE lr_gold_paddle_subscriptions(
 subscription_id TEXT PRIMARY KEY,
 account_id TEXT REFERENCES lr_accounts(account_id) ON DELETE RESTRICT,
 status TEXT,
 event_type TEXT,
 updated_ms BIGINT NOT NULL
);
CREATE TABLE lr_gold_paddle_refunds(
 adjustment_id TEXT PRIMARY KEY,
 transaction_id TEXT,
 account_id TEXT REFERENCES lr_accounts(account_id) ON DELETE RESTRICT,
 subscription_id TEXT,
 status TEXT,
 requested_by TEXT,
 reason TEXT,
 requested_ms BIGINT,
 updated_ms BIGINT,
 result JSONB CHECK(result IS NULL OR jsonb_typeof(result)='object')
);
CREATE INDEX lr_gold_paddle_refunds_transaction_idx ON lr_gold_paddle_refunds(transaction_id,updated_ms DESC);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_gold_paddle_events,lr_gold_paddle_subscriptions,lr_gold_paddle_refunds TO lr_gold_app;
COMMIT;
