-- Native Device Connection registry on existing rc50 table. Historical rows
-- are preserved for A/B foreign keys while "visible" marks current registry state.
BEGIN;
ALTER TABLE lr_device_connections ADD COLUMN IF NOT EXISTS plan_cap_ms BIGINT;
ALTER TABLE lr_device_connections ADD COLUMN IF NOT EXISTS last_renewed_ms BIGINT;
ALTER TABLE lr_device_connections ADD COLUMN IF NOT EXISTS registry_visible BOOLEAN NOT NULL DEFAULT true;
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_device_connections TO lr_gold_app;
COMMIT;
