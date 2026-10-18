\set ON_ERROR_STOP on
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan) VALUES
 ('uat_owner_03','owner-03@example.invalid','pro'),
 ('uat_member_03','member-03@example.invalid','free');
INSERT INTO lr_devices(device_id,owner_account_id,state) VALUES('uat_device_03','uat_owner_03','online');
INSERT INTO lr_sessions(session_id,account_id,token_sha256,expires_at)
 VALUES('uat_session_03','uat_owner_03',repeat('1',64),now()+interval '1 hour');
INSERT INTO lr_oauth_one_time(token_sha256,purpose,account_id,expires_at)
 VALUES(repeat('2',64),'authorization_code','uat_owner_03',now()+interval '2 minutes');
INSERT INTO lr_device_connections(connection_id,device_id,account_id,plan,hard_expires_at,reconnect_grace_ms)
 VALUES('uat_connection_03','uat_device_03','uat_owner_03','pro',now()+interval '12 hours',1800000);
INSERT INTO lr_ab_requests(request_id,account_id,device_id,connection_id,purpose,poll_sha256,expires_at)
 VALUES('uat_ab_request_03','uat_owner_03','uat_device_03','uat_connection_03','device',repeat('3',64),now()+interval '5 minutes');
INSERT INTO lr_ab_grants(grant_id,account_id,device_id,connection_id,agent_id,purpose,approved_at,last_activity_at,idle_grace_ms,expires_at,absolute_expires_at)
 VALUES('uat_ab_grant_03','uat_owner_03','uat_device_03','uat_connection_03','uat_agent','device',now(),now(),1800000,now()+interval '12 hours',now()+interval '24 hours');
INSERT INTO lr_agent_clients(client_session_id,account_id,agent_id,expires_at)
 VALUES('uat_agentclient_03','uat_owner_03','uat_agent',now()+interval '12 hours');
INSERT INTO lr_agent_bindings(client_session_id,account_id,device_id,grant_id,connection_id)
 VALUES('uat_agentclient_03','uat_owner_03','uat_device_03','uat_ab_grant_03','uat_connection_03');
INSERT INTO lr_enrollment_challenges(challenge_id,request_account_id,code_sha256,public_key_sha256,expires_at)
 VALUES('uat_enroll_03','uat_owner_03',repeat('4',64),repeat('5',64),now()+interval '10 minutes');
INSERT INTO lr_license_keys(license_id,key_sha256,key_last4,plan,duration_ms,max_redemptions)
 VALUES('uat_license_03',repeat('6',64),'A234','pro',2592000000,1);
INSERT INTO lr_license_redemptions(license_id,account_id) VALUES('uat_license_03','uat_member_03');
INSERT INTO lr_notifications(notification_id,category,title,body,audience_type,audience_value,published_by)
 VALUES('uat_notification_03','maintenance','Synthetic test','No actual notification dispatched.','account','uat_owner_03','uat_owner_03');
INSERT INTO lr_notification_reads(notification_id,account_id) VALUES('uat_notification_03','uat_owner_03');
INSERT INTO lr_audit_events(event_id,actor_account_id,owner_account_id,kind,resource_type,resource_id)
 VALUES('uat_audit_03','uat_owner_03','uat_owner_03','uat_contract','device','uat_device_03');
DO $$
DECLARE n INTEGER;
BEGIN
 SELECT count(*) INTO n FROM lr_ab_grants WHERE grant_id='uat_ab_grant_03';
 IF n<>1 THEN RAISE EXCEPTION 'missing AB grant'; END IF;
 SELECT count(*) INTO n FROM lr_agent_bindings WHERE client_session_id='uat_agentclient_03';
 IF n<>1 THEN RAISE EXCEPTION 'agent binding lost'; END IF;
 SELECT count(*) INTO n FROM lr_license_redemptions WHERE license_id='uat_license_03';
 IF n<>1 THEN RAISE EXCEPTION 'license redemption lost'; END IF;
END $$;
DO $$
BEGIN
  BEGIN
    INSERT INTO lr_ab_grants(grant_id,account_id,device_id,connection_id,purpose,approved_at,last_activity_at,idle_grace_ms,expires_at,absolute_expires_at)
      VALUES('uat_grant_bad_03','uat_owner_03','uat_device_03','uat_connection_03','device',now(),now(),1800000,now()+interval '25 hours',now()+interval '25 hours');
    RAISE EXCEPTION '25-hour AB grant was unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO lr_license_redemptions(license_id,account_id) VALUES('uat_license_03','uat_member_03');
    RAISE EXCEPTION 'duplicate license redemption unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO lr_oauth_one_time(token_sha256,purpose,account_id,expires_at)
      VALUES(repeat('2',64),'authorization_code','uat_owner_03',now()+interval '2 minutes');
    RAISE EXCEPTION 'reused OAuth hash accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
ROLLBACK;
DO $$
DECLARE n BIGINT;
BEGIN
 SELECT count(*) INTO n FROM lr_accounts WHERE account_id LIKE 'uat_%_03';
 IF n<>0 THEN RAISE EXCEPTION 'synthetic accounts retained'; END IF;
 SELECT count(*) INTO n FROM lr_ab_grants WHERE grant_id LIKE 'uat_%_03';
 IF n<>0 THEN RAISE EXCEPTION 'synthetic grants retained'; END IF;
 SELECT count(*) INTO n FROM lr_oauth_one_time WHERE token_sha256=repeat('2',64);
 IF n<>0 THEN RAISE EXCEPTION 'synthetic OAuth token retained'; END IF;
 SELECT count(*) INTO n FROM lr_license_redemptions WHERE license_id='uat_license_03';
 IF n<>0 THEN RAISE EXCEPTION 'synthetic license redemption retained'; END IF;
 SELECT count(*) INTO n FROM lr_audit_events WHERE event_id='uat_audit_03';
 IF n<>0 THEN RAISE EXCEPTION 'synthetic audit event retained'; END IF;
END $$;
SELECT 'RC50_AUTH_DEVICE_UAT_ROLLBACK_PASS' AS result;
