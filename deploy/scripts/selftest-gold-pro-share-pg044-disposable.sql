-- Disposable PostgreSQL17 ONLY. Synthetic rows, no customer accounts.
-- Assert PG044 native FK/CHECK/unique properties and owner/Guest isolation.
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan,status) VALUES
 ('p44-owner','owner@fixture.invalid','vip','active'),
 ('p44-guest','guest@fixture.invalid','free','active'),
 ('p44-other','other@fixture.invalid','free','active');
INSERT INTO lr_devices(device_id,owner_account_id,state)
 VALUES('p44-device','p44-owner','online');
INSERT INTO lr_device_connections(
 connection_id,device_id,account_id,plan,hard_expires_at,reconnect_grace_ms)
 VALUES('p44-connection','p44-device','p44-owner','vip',
 now()+interval '48 hours',900000);
INSERT INTO lr_ab_grants(grant_id,account_id,device_id,connection_id,
 agent_id,purpose,approved_at,last_activity_at,idle_grace_ms,expires_at,
 absolute_expires_at,closed_at)
 VALUES('p44-guest-grant','p44-guest','p44-device','p44-connection',
  'p44-plugin-agent','pro-share-guest',now(),now(),3600000,
  now()+interval '1 hour',now()+interval '24 hours',NULL);
INSERT INTO lr_agent_clients(client_session_id,account_id,agent_id,expires_at)
 VALUES('lrc_p44_guest','p44-guest','p44-plugin-agent',now()+interval '1 hour');
INSERT INTO lr_agent_bindings(client_session_id,device_id,grant_id,
 connection_id,account_id,grant_purpose)
 VALUES('lrc_p44_guest','p44-device','p44-guest-grant',
  'p44-connection','p44-guest','pro-share-guest');
INSERT INTO lr_gold_pro_share_addons(owner_account_id,state,
 valid_until_ms,monthly_guest_call_budget,source)
 VALUES('p44-owner','active',9999999999999,100,'fixture');
INSERT INTO lr_gold_pro_share_seats(owner_account_id,guest_account_id,status,
 accepted_at) VALUES('p44-owner','p44-guest','accepted',now());
INSERT INTO lr_gold_pro_share_devices(owner_account_id,device_id)
 VALUES('p44-owner','p44-device');
INSERT INTO lr_gold_pro_share_guest_jobs(
 job_id,operation_id,request_key,owner_account_id,guest_account_id,
 agent_id,client_session_id,device_id,grant_id,connection_id,operation,
 required_capabilities,permission_revision,state)
 VALUES
 ('0af5a9c1-8050-478a-83d1-5e26821cf101','guestop-a111111111111111',
  repeat('a',32),'p44-owner','p44-guest','p44-plugin-agent',
  'lrc_p44_guest','p44-device','p44-guest-grant','p44-connection',
  'process',ARRAY['filesystem'],1,'queued'),
 ('0af5a9c1-8050-478a-83d1-5e26821cf102','guestop-b111111111111111',
  repeat('b',32),'p44-owner','p44-guest','p44-plugin-agent',
  'lrc_p44_guest','p44-device','p44-guest-grant','p44-connection',
  'process',ARRAY['filesystem'],1,'queued');
INSERT INTO lr_gold_pro_share_guest_payloads(
 job_id,operation_id,guest_account_id,payload_sha256,sealed_payload)
 VALUES('0af5a9c1-8050-478a-83d1-5e26821cf101',
 'guestop-a111111111111111','p44-guest',repeat('c',64),
 '{"format":"gpi1","synthetic_fixture_only":true}'::jsonb);
INSERT INTO lr_gold_pro_share_guest_slots(
 operation_id,owner_account_id,guest_account_id,device_id,job_id,
 grant_id,connection_id,state)
 VALUES('guestop-a111111111111111','p44-owner','p44-guest',
 'p44-device','0af5a9c1-8050-478a-83d1-5e26821cf101',
 'p44-guest-grant','p44-connection','reserved');
DO $$
DECLARE rejected BOOLEAN;
BEGIN
 SELECT connection_owner_account_id='p44-owner'
   INTO rejected FROM lr_ab_grants WHERE grant_id='p44-guest-grant';
 IF rejected IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'PG044 guest connection-owner trigger missing';
 END IF;
 rejected:=FALSE;
 BEGIN
  INSERT INTO lr_gold_pro_share_guest_slots(
   operation_id,owner_account_id,guest_account_id,device_id,job_id,
   grant_id,connection_id,state)
  VALUES('guestop-b111111111111111','p44-owner','p44-guest',
   'p44-device','0af5a9c1-8050-478a-83d1-5e26821cf102',
   'p44-guest-grant','p44-connection','reserved');
 EXCEPTION WHEN unique_violation THEN rejected:=TRUE;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'two active Guest slots allowed'; END IF;
 rejected:=FALSE;
 BEGIN
  INSERT INTO lr_gold_pro_share_guest_slots(
   operation_id,owner_account_id,guest_account_id,device_id,job_id,
   grant_id,connection_id,state)
  VALUES('guestop-b111111111111111','p44-owner','p44-other',
   'p44-device','0af5a9c1-8050-478a-83d1-5e26821cf102',
   'p44-guest-grant','p44-connection','cancelled');
 EXCEPTION WHEN foreign_key_violation THEN rejected:=TRUE;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'cross-guest slot FK allowed'; END IF;
 rejected:=FALSE;
 BEGIN
  INSERT INTO lr_gold_pro_share_guest_payloads(
   job_id,operation_id,guest_account_id,payload_sha256,sealed_payload)
  VALUES('0af5a9c1-8050-478a-83d1-5e26821cf102',
   'guestop-a111111111111111','p44-guest',
   repeat('a',64),'{"synthetic":true}'::jsonb);
 EXCEPTION WHEN foreign_key_violation THEN rejected:=TRUE;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'payload cross-operation FK allowed'; END IF;
 rejected:=FALSE;
 BEGIN
  INSERT INTO lr_ab_grants(grant_id,account_id,device_id,connection_id,
   agent_id,purpose,approved_at,last_activity_at,idle_grace_ms,expires_at,
   absolute_expires_at,closed_at)
  VALUES('p44-false-direct','p44-guest','p44-device','p44-connection',
   'p44-plugin-agent','device',now(),now(),3600000,
   now()+interval '1 hour',now()+interval '24 hours',NULL);
 EXCEPTION WHEN check_violation THEN rejected:=TRUE;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'guest impersonated owner direct grant'; END IF;
 rejected:=has_table_privilege('lr_gold_app',
  'lr_gold_pro_share_guest_payloads','SELECT,INSERT,UPDATE,DELETE');
 IF rejected IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Gold app role missing scoped payload table privileges';
 END IF;
END $$;
COMMIT;
SELECT 'PG044_NATIVE_CROSS_GUEST_FK_ONE_ACTIVE_SLOT_PAYLOAD_GUARD=PASS';
