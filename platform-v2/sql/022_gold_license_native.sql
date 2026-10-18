-- Native License Keys: no JSONB snapshots for key inventory/redemptions.
BEGIN;
CREATE TABLE lr_gold_license_keys(
  license_id TEXT PRIMARY KEY,
  key_sha256 CHAR(64) NOT NULL UNIQUE CHECK(key_sha256 ~ '^[a-f0-9]{64}$'),
  last4 CHAR(4) NOT NULL,
  plan TEXT NOT NULL CHECK(plan IN ('pro','vip')),
  duration_ms BIGINT NOT NULL CHECK(duration_ms>0),
  max_redemptions INTEGER NOT NULL CHECK(max_redemptions BETWEEN 1 AND 1000),
  issued_ms BIGINT NOT NULL,
  expires_ms BIGINT,
  revoked_ms BIGINT,
  revoke_reason VARCHAR(120),
  label VARCHAR(120) NOT NULL DEFAULT ''
);
CREATE TABLE lr_gold_license_redemptions(
  license_id TEXT NOT NULL REFERENCES lr_gold_license_keys(license_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES lr_accounts(account_id) ON DELETE RESTRICT,
  redeemed_ms BIGINT NOT NULL,
  PRIMARY KEY(license_id,account_id)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_gold_license_keys,lr_gold_license_redemptions TO lr_gold_app;
COMMIT;
