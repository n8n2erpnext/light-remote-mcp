\set ON_ERROR_STOP on
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan) VALUES
 ('uat_owner_05','owner-05@example.invalid','pro'),
 ('uat_member_05_a','member-05-a@example.invalid','free'),
 ('uat_member_05_b','member-05-b@example.invalid','free'),
 ('uat_member_05_c','member-05-c@example.invalid','free'),
 ('uat_member_05_d','member-05-d@example.invalid','free'),
 ('uat_member_05_e','member-05-e@example.invalid','free');
INSERT INTO lr_teams(team_id,owner_account_id,seat_cap) VALUES('uat_team_05','uat_owner_05',5);
-- Owner occupies one of the five seats, even without a team_members row.
INSERT INTO lr_team_members(team_id,account_id) VALUES
 ('uat_team_05','uat_member_05_a'),('uat_team_05','uat_member_05_b'),
 ('uat_team_05','uat_member_05_c'),('uat_team_05','uat_member_05_d');
DO $$
DECLARE n INTEGER;
BEGIN
 SELECT count(*) INTO n FROM lr_team_members WHERE team_id='uat_team_05' AND state='active';
 IF n<>4 THEN RAISE EXCEPTION 'expected owner + four active members'; END IF;
 BEGIN
  INSERT INTO lr_team_members(team_id,account_id) VALUES('uat_team_05','uat_member_05_e');
  RAISE EXCEPTION 'sixth seat was accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 -- Existing active member can update without consuming a new seat.
 UPDATE lr_team_members SET state='active',joined_at=now() WHERE team_id='uat_team_05' AND account_id='uat_member_05_a';
 BEGIN
  UPDATE lr_teams SET seat_cap=3 WHERE team_id='uat_team_05';
  RAISE EXCEPTION 'shrunk team capacity below live membership';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
UPDATE lr_team_members SET state='revoked' WHERE team_id='uat_team_05' AND account_id='uat_member_05_a';
INSERT INTO lr_team_members(team_id,account_id) VALUES('uat_team_05','uat_member_05_e');
DO $$
DECLARE n INTEGER;
BEGIN
 SELECT count(*) INTO n FROM lr_team_members WHERE team_id='uat_team_05' AND state='active' AND account_id<>'uat_owner_05';
 IF n<>4 THEN RAISE EXCEPTION 'revocation did not free exactly one seat'; END IF;
 BEGIN
  UPDATE lr_team_members SET state='active' WHERE team_id='uat_team_05' AND account_id='uat_member_05_a';
  RAISE EXCEPTION 're-activated a sixth seat';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM lr_teams WHERE team_id='uat_team_05') THEN RAISE EXCEPTION 'test team remained'; END IF;
 IF EXISTS(SELECT 1 FROM lr_accounts WHERE account_id LIKE 'uat_member_05_%') THEN RAISE EXCEPTION 'synthetic accounts remained'; END IF;
END $$;
SELECT 'RC50_TEAM_FIVE_SEAT_GUARD_PASS' AS result;
