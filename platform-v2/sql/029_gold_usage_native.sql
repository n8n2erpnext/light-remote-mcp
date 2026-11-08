-- Canonical Usage aggregation in typed relational tables, not a JSON map.
BEGIN;
CREATE TABLE lr_gold_usage_config(
 singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(singleton_id=1),
 tracking_since_ms BIGINT NOT NULL
);
CREATE TABLE lr_gold_usage_account(
 account_id TEXT PRIMARY KEY REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
 last_tool_call_ms BIGINT
);
CREATE TABLE lr_gold_usage_month(
 account_id TEXT NOT NULL REFERENCES lr_gold_usage_account(account_id) ON DELETE CASCADE,
 month_key CHAR(7) NOT NULL CHECK(month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 tool_calls BIGINT NOT NULL DEFAULT 0 CHECK(tool_calls>=0),
 online_ms BIGINT NOT NULL DEFAULT 0 CHECK(online_ms>=0),
 PRIMARY KEY(account_id,month_key)
);
CREATE TABLE lr_gold_usage_device(
 account_id TEXT NOT NULL,
 month_key CHAR(7) NOT NULL,
 device_id TEXT NOT NULL,
 tool_calls BIGINT NOT NULL DEFAULT 0 CHECK(tool_calls>=0),
 online_ms BIGINT NOT NULL DEFAULT 0 CHECK(online_ms>=0),
 PRIMARY KEY(account_id,month_key,device_id),
 FOREIGN KEY(account_id,month_key) REFERENCES lr_gold_usage_month(account_id,month_key) ON DELETE CASCADE
);
CREATE TABLE lr_gold_usage_open_connection(
 connection_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
 device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
 opened_ms BIGINT NOT NULL,
 last_accrued_ms BIGINT NOT NULL,
 hard_expires_ms BIGINT
);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_gold_usage_config,lr_gold_usage_account,
 lr_gold_usage_month,lr_gold_usage_device,lr_gold_usage_open_connection TO lr_gold_app;
COMMIT;
