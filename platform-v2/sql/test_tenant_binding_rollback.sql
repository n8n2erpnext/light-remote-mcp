\set ON_ERROR_STOP on
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan) VALUES
 ('uat_owner_04','owner-04@example.invalid','pro'),
 ('uat_member_04','member-04@example.invalid','free');
INSERT INTO lr_devices(device_id,owner_account_id,state) VALUES('uat_device_04','uat_owner_04','online');
INSERT INTO lr_device_connections(connection_id,device_id,account_id,plan,hard_expires_at,reconnect_grace_ms)
 VALUES('uat_connection_04','uat_device_04','uat_owner_04','pro',now()+interval '12 hours',1800000);
-- Member is a valid actor for an independently authorized team-member grant.
INSERT INTO lr_ab_grants(grant_id,account_id,device_id,connection_id,agent_id,purpose,approved_at,last_activity_at,idle_grace_ms,expires_at,absolute_expires_at)
 VALUES
 ('uat_owner_grant_04','uat_owner_04','uat_device_04','uat_connection_04','uat_agent','device',now(),now(),1800000,now()+interval '1 hour',now()+interval '12 hours'),
 ('uat_member_grant_04','uat_member_04','uat_device_04','uat_connection_04','uat_member_agent','team-member',now(),now(),1800000,now()+interval '1 hour',now()+interval '12 hours');
INSERT INTO lr_agent_clients(client_session_id,account_id,agent_id,expires_at) VALUES
 ('uat_owner_client_04','uat_owner_04','uat_agent',now()+interval '6 hours'),
 ('uat_member_client_04','uat_member_04','uat_member_agent',now()+interval '6 hours');
INSERT INTO lr_agent_bindings(client_session_id,account_id,device_id,grant_id,connection_id)
 VALUES('uat_owner_client_04','uat_owner_04','uat_device_04','uat_owner_grant_04','uat_connection_04');
DO $$
BEGIN
 BEGIN
  INSERT INTO lr_device_connections(connection_id,device_id,account_id,plan,hard_expires_at,reconnect_grace_ms)
   VALUES('uat_wrong_owner_04','uat_device_04','uat_member_04','free',now()+interval '1 hour',1800000);
  RAISE EXCEPTION 'cross-owner device lease accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO lr_agent_bindings(client_session_id,account_id,device_id,grant_id,connection_id)
   VALUES('uat_member_client_04','uat_member_04','uat_device_04','uat_owner_grant_04','uat_connection_04');
  RAISE EXCEPTION 'cross-account agent grant accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO lr_agent_bindings(client_session_id,account_id,device_id,grant_id,connection_id)
   VALUES('uat_member_client_04','uat_member_04','uat_device_04','uat_member_grant_04','uat_connection_04');
  RAISE EXCEPTION 'team-member grant authorized as a direct agent grant';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO lr_ab_requests(request_id,account_id,device_id,connection_id,purpose,poll_sha256,expires_at)
   VALUES('uat_request_wrong_device_04','uat_member_04','uat_missing_device_04','uat_connection_04','team-member',repeat('7',64),now()+interval '5 minutes');
  RAISE EXCEPTION 'mismatched request device accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM lr_accounts WHERE account_id IN ('uat_owner_04','uat_member_04'))
  THEN RAISE EXCEPTION 'synthetic tenant fixture not rolled back'; END IF;
END $$;
SELECT 'RC50_TENANT_BOUNDARY_UAT_PASS' AS result;
