-- UAT-only: prevent a Free event using the paid/generic metering path.
BEGIN;
CREATE OR REPLACE FUNCTION lr_guard_free_event_uat()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_plan TEXT; v_family TEXT;
BEGIN
 SELECT plan INTO v_plan FROM lr_accounts WHERE account_id=NEW.owner_account_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'unknown_usage_owner' USING ERRCODE='check_violation'; END IF;
 IF v_plan='free' THEN
  IF NEW.free_family_id IS NULL OR NEW.actor_account_id<>NEW.owner_account_id THEN
   RAISE EXCEPTION 'free_requires_family_meter' USING ERRCODE='check_violation'; END IF;
  SELECT f.family_id INTO v_family FROM lr_free_family_devices f
   JOIN lr_devices d ON d.device_id=f.device_id
   WHERE f.device_id=NEW.device_id AND d.owner_account_id=NEW.owner_account_id;
  IF NOT FOUND OR v_family<>NEW.free_family_id THEN
   RAISE EXCEPTION 'free_family_device_mismatch' USING ERRCODE='check_violation'; END IF;
 ELSE
  IF NEW.free_family_id IS NOT NULL THEN
   RAISE EXCEPTION 'paid_usage_cannot_claim_free_family' USING ERRCODE='check_violation'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lr_guard_free_event ON lr_usage_events;
CREATE TRIGGER lr_guard_free_event
 BEFORE INSERT ON lr_usage_events FOR EACH ROW
 EXECUTE FUNCTION lr_guard_free_event_uat();
REVOKE EXECUTE ON FUNCTION lr_guard_free_event_uat() FROM PUBLIC;
INSERT INTO lr_schema_migrations(version) VALUES(10) ON CONFLICT DO NOTHING;
COMMIT;
