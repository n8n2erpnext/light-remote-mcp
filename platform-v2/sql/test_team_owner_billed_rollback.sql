\set ON_ERROR_STOP on
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan) VALUES
 ('uat_team_owner_11','team-owner-11@example.invalid','pro'),
 ('uat_team_member_11','team-member-11@example.invalid','free');
INSERT INTO lr_devices(device_id,owner_account_id,state)
 VALUES('uat_team_device_11','uat_team_owner_11','online');
INSERT INTO lr_teams(team_id,owner_account_id,seat_cap)
 VALUES('uat_team_11','uat_team_owner_11',5);
INSERT INTO lr_team_members(team_id,account_id,state)
 VALUES('uat_team_11','uat_team_member_11','active');
INSERT INTO lr_entitlements(entitlement_id,owner_account_id,kind,source,valid_until)
 VALUES('uat_ent_11','uat_team_owner_11','pro_team','uat-fixture',now()+interval '2 hours');
INSERT INTO lr_device_connections(connection_id,device_id,account_id,plan,hard_expires_at,reconnect_grace_ms)
 VALUES('uat_conn_11','uat_team_device_11','uat_team_owner_11','pro',now()+interval '2 hours',1800000);
INSERT INTO lr_agent_clients(client_session_id,account_id,agent_id,expires_at)
 VALUES('uat_client_11','uat_team_member_11','uat_agent_11',now()+interval '2 hours');
INSERT INTO lr_ab_grants(grant_id,account_id,device_id,connection_id,agent_id,purpose,
 approved_at,last_activity_at,idle_grace_ms,expires_at,absolute_expires_at)
 VALUES('uat_team_ab_11','uat_team_member_11','uat_team_device_11','uat_conn_11',
 'uat_agent_11','team-member',now(),now(),1800000,
 now()+interval '1 hour',now()+interval '2 hours');
INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id)
 VALUES('uat_team_job_11','uat_team_owner_11','uat_team_member_11','uat_team_device_11','uat_op_11');
INSERT INTO lr_team_member_budgets(owner_account_id,month_key,call_limit)
 VALUES('uat_team_owner_11','2026-10',2);
DO $$
DECLARE n BIGINT;msg TEXT;
BEGIN
 IF NOT lr_charge_team_member_uat('uat_team_ev_11_1','uat_team_owner_11','uat_team_member_11',
  'uat_team_device_11','uat_team_job_11','uat_client_11','uat_team_ab_11','2026-10',1)
 THEN RAISE EXCEPTION 'first valid member charge denied'; END IF;
 IF NOT lr_charge_team_member_uat('uat_team_ev_11_2','uat_team_owner_11','uat_team_member_11',
  'uat_team_device_11','uat_team_job_11','uat_client_11','uat_team_ab_11','2026-10',1)
 THEN RAISE EXCEPTION 'second valid member charge denied'; END IF;
 IF lr_charge_team_member_uat('uat_team_ev_11_1','uat_team_owner_11','uat_team_member_11',
  'uat_team_device_11','uat_team_job_11','uat_client_11','uat_team_ab_11','2026-10',1)
 THEN RAISE EXCEPTION 'duplicate Team event billed twice'; END IF;
 SELECT tool_calls INTO n FROM lr_usage_monthly
  WHERE owner_account_id='uat_team_owner_11' AND month_key='2026-10';
 IF n<>2 THEN RAISE EXCEPTION 'owner was not charged for 2 member calls'; END IF;
 SELECT tool_calls INTO n FROM lr_team_member_monthly
  WHERE owner_account_id='uat_team_owner_11' AND month_key='2026-10';
 IF n<>2 THEN RAISE EXCEPTION 'member budget did not aggregate under owner'; END IF;
 SELECT count(*) INTO n FROM lr_usage_events WHERE owner_account_id='uat_team_owner_11'
   AND actor_account_id='uat_team_member_11' AND job_id='uat_team_job_11';
 IF n<>2 THEN RAISE EXCEPTION 'member usage ledger not traceable'; END IF;
 BEGIN
  PERFORM lr_charge_team_member_uat('uat_team_ev_11_3','uat_team_owner_11','uat_team_member_11',
   'uat_team_device_11','uat_team_job_11','uat_client_11','uat_team_ab_11','2026-10',1);
  RAISE EXCEPTION 'third member call exceeded budget';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'team_member_monthly_budget_exceeded' THEN RAISE EXCEPTION 'wrong budget error: %',msg; END IF;
 END;
 BEGIN
  PERFORM lr_charge_team_member_uat('uat_team_ev_11_1','uat_team_owner_11','uat_team_member_11',
   'uat_team_device_11','uat_team_job_11','uat_client_11','uat_team_ab_11','2026-10',2);
  RAISE EXCEPTION 'changed Team event accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'team_event_payload_mismatch' THEN RAISE EXCEPTION 'wrong replay error: %',msg; END IF;
 END;
END $$;
UPDATE lr_team_member_budgets SET call_limit=5 WHERE owner_account_id='uat_team_owner_11';
-- Revoke A/B grant: new member billable action must fail closed.
UPDATE lr_ab_grants SET closed_at=clock_timestamp() WHERE grant_id='uat_team_ab_11';
DO $$
DECLARE msg TEXT;
BEGIN
 BEGIN
  PERFORM lr_charge_team_member_uat('uat_team_ev_11_closed','uat_team_owner_11','uat_team_member_11',
   'uat_team_device_11','uat_team_job_11','uat_client_11','uat_team_ab_11','2026-10',1);
  RAISE EXCEPTION 'closed A/B grant allowed Team call';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'team_member_ab_approval_required' THEN RAISE EXCEPTION 'wrong A/B error: %',msg; END IF;
 END;
END $$;
UPDATE lr_ab_grants SET closed_at=NULL WHERE grant_id='uat_team_ab_11';
UPDATE lr_team_members SET state='revoked' WHERE team_id='uat_team_11' AND account_id='uat_team_member_11';
DO $$
DECLARE msg TEXT;
BEGIN
 BEGIN
  PERFORM lr_charge_team_member_uat('uat_team_ev_11_revoked','uat_team_owner_11','uat_team_member_11',
   'uat_team_device_11','uat_team_job_11','uat_client_11','uat_team_ab_11','2026-10',1);
  RAISE EXCEPTION 'revoked Team member billed owner';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'team_membership_required' THEN RAISE EXCEPTION 'wrong membership error: %',msg; END IF;
 END;
END $$;
UPDATE lr_team_members SET state='active' WHERE team_id='uat_team_11' AND account_id='uat_team_member_11';
UPDATE lr_agent_clients SET closed_at=clock_timestamp() WHERE client_session_id='uat_client_11';
DO $$
DECLARE msg TEXT;
BEGIN
 BEGIN
  PERFORM lr_charge_team_member_uat('uat_team_ev_11_session','uat_team_owner_11','uat_team_member_11',
   'uat_team_device_11','uat_team_job_11','uat_client_11','uat_team_ab_11','2026-10',1);
  RAISE EXCEPTION 'closed agent session billed owner';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'team_agent_session_unverified' THEN RAISE EXCEPTION 'wrong client error: %',msg; END IF;
 END;
END $$;
UPDATE lr_agent_clients SET closed_at=NULL WHERE client_session_id='uat_client_11';
UPDATE lr_ab_grants SET expires_at=clock_timestamp()-interval '1 second'
 WHERE grant_id='uat_team_ab_11';
DO $$
DECLARE msg TEXT;
BEGIN
 BEGIN
  PERFORM lr_charge_team_member_uat('uat_team_ev_11_expired','uat_team_owner_11','uat_team_member_11',
   'uat_team_device_11','uat_team_job_11','uat_client_11','uat_team_ab_11','2026-10',1);
  RAISE EXCEPTION 'expired AB grant accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'team_member_ab_approval_required' THEN RAISE EXCEPTION 'wrong expired grant error: %',msg; END IF;
 END;
END $$;
UPDATE lr_ab_grants SET expires_at=clock_timestamp()+interval '1 hour' WHERE grant_id='uat_team_ab_11';
UPDATE lr_entitlements SET revoked_at=clock_timestamp() WHERE entitlement_id='uat_ent_11';
DO $$
DECLARE msg TEXT;
BEGIN
 BEGIN
  PERFORM lr_charge_team_member_uat('uat_team_ev_11_no_addon','uat_team_owner_11','uat_team_member_11',
   'uat_team_device_11','uat_team_job_11','uat_client_11','uat_team_ab_11','2026-10',1);
  RAISE EXCEPTION 'revoked Team entitlement accepted';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'team_addon_required' THEN RAISE EXCEPTION 'wrong entitlement error: %',msg; END IF;
 END;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM lr_accounts WHERE account_id LIKE 'uat_team_%_11')
 OR EXISTS(SELECT 1 FROM lr_usage_events WHERE event_id LIKE 'uat_team_ev_11_%')
 OR EXISTS(SELECT 1 FROM lr_team_member_budgets WHERE owner_account_id='uat_team_owner_11')
 OR EXISTS(SELECT 1 FROM lr_team_member_monthly WHERE owner_account_id='uat_team_owner_11')
 THEN RAISE EXCEPTION 'synthetic Team fixture persisted'; END IF;
END $$;
SELECT 'RC50_TEAM_OWNER_BILLING_AB_ROLLBACK_PASS' AS result;
