-- Retire the rejected generic JSONB snapshot table after all canonical
-- registry writers have been switched to typed PostgreSQL tables (026-030).
-- Fail rather than destroy data if this is run against a populated legacy DB.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.lr_gold_registry_documents') IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM lr_gold_registry_documents LIMIT 1) THEN
   RAISE EXCEPTION 'gold_generic_jsonb_snapshot_not_empty_migrate_first';
  END IF;
 END IF;
END $$;
DROP TABLE IF EXISTS lr_gold_registry_documents;
COMMIT;
