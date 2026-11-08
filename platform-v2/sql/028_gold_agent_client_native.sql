-- Native Agent Client and bound Device entries on existing RC50 tables.
-- JSONB is scoped to optional per-binding working context (variable shape).
BEGIN;
ALTER TABLE lr_agent_bindings ADD COLUMN IF NOT EXISTS working_context JSONB;
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_agent_clients,lr_agent_bindings TO lr_gold_app;
COMMIT;
