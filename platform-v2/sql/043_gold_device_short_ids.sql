-- P2-I1 CANDIDATE ONLY. NOT in migrations.lock.json; NOT auto-applied.
-- A permanently reserved public 6-character device Short ID (not a grant).
-- A device move, restart or display-name change never changes its Short ID.
-- The 5-character rotating A suffix is NOT stored or generated here.
BEGIN;
CREATE TABLE lr_gold_device_short_ids (
  short_id VARCHAR(6) PRIMARY KEY
    CHECK (short_id ~ '^[0-9A-HJKMNP-TV-Z]{6}$'),
  device_id TEXT UNIQUE REFERENCES lr_devices(device_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lr_gold_device_short_ids_device_idx
  ON lr_gold_device_short_ids(device_id) WHERE device_id IS NOT NULL;

-- Prohibit key changes and reassignment of retired codes; an FK-driven
-- device DELETE may retire device_id to NULL, but never transfer it.
CREATE FUNCTION lr_gold_short_id_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.short_id IS DISTINCT FROM NEW.short_id OR
    (OLD.device_id IS DISTINCT FROM NEW.device_id AND NEW.device_id IS NOT NULL)
 THEN RAISE EXCEPTION 'gold_device_short_id_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lr_gold_short_id_immutable_trg
 BEFORE UPDATE ON lr_gold_device_short_ids
 FOR EACH ROW EXECUTE FUNCTION lr_gold_short_id_immutable();
GRANT SELECT,INSERT ON lr_gold_device_short_ids TO lr_gold_app;
COMMIT;
