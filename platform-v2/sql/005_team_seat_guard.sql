-- rc50-v2 isolated UAT: serialized Team-seat enforcement.
-- Owner ALWAYS occupies one seat, even without a redundant team_members row.
BEGIN;
CREATE OR REPLACE FUNCTION lr_enforce_team_seat_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 v_owner TEXT;
 v_cap SMALLINT;
 v_active_non_owner INTEGER;
BEGIN
 SELECT owner_account_id,seat_cap INTO v_owner,v_cap
  FROM lr_teams WHERE team_id=NEW.team_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'team missing' USING ERRCODE='foreign_key_violation'; END IF;
 IF NEW.state='active' AND NEW.account_id <> v_owner THEN
  SELECT count(*) INTO v_active_non_owner FROM lr_team_members
   WHERE team_id=NEW.team_id AND state='active' AND account_id<>v_owner;
  IF TG_OP='UPDATE' AND OLD.team_id=NEW.team_id AND OLD.account_id=NEW.account_id
     AND OLD.state='active' THEN
    v_active_non_owner := v_active_non_owner - 1;
  END IF;
  IF v_active_non_owner >= v_cap-1 THEN
   RAISE EXCEPTION 'team_seat_capacity_exceeded' USING ERRCODE='check_violation';
  END IF;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lr_team_seat_guard ON lr_team_members;
CREATE TRIGGER lr_team_seat_guard BEFORE INSERT OR UPDATE OF team_id,account_id,state
 ON lr_team_members FOR EACH ROW EXECUTE FUNCTION lr_enforce_team_seat_limit();

-- Prevent manual reduction of cap below present active seats.
CREATE OR REPLACE FUNCTION lr_enforce_team_seat_cap_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_members INTEGER;
BEGIN
 IF NEW.seat_cap < OLD.seat_cap OR NEW.owner_account_id<>OLD.owner_account_id THEN
  SELECT count(*) INTO v_members FROM lr_team_members
   WHERE team_id=NEW.team_id AND state='active' AND account_id<>NEW.owner_account_id;
  IF v_members+1 > NEW.seat_cap THEN
   RAISE EXCEPTION 'team_seat_cap_smaller_than_membership' USING ERRCODE='check_violation';
  END IF;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lr_team_cap_guard ON lr_teams;
CREATE TRIGGER lr_team_cap_guard BEFORE UPDATE OF seat_cap,owner_account_id
 ON lr_teams FOR EACH ROW EXECUTE FUNCTION lr_enforce_team_seat_cap_change();

INSERT INTO lr_schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
COMMIT;
