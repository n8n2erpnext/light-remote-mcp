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
-- Native M4/GoldJobLedger canonical one-UUID chain. This is a real PG FK
-- smoke test, not a statement that an Agent process was started.
BEGIN;
INSERT INTO lr_gold_personal_agent_work(
 job_id,account_id,agent_id,session_id,operation_id,state,
 started_at,device_id,resource_key,resource_mode,worker_weight)
 VALUES('0af5a9c1-8050-478a-83d1-5e26821cf101',
 'p44-owner','p44-plugin-agent',
 'gshare_0af5a9c1-8050-478a-83d1-5e26821cf101',
 'guestop-a111111111111111','running',clock_timestamp(),
 'p44-device','device:unknown','exclusive',1);
INSERT INTO lr_gold_device_resource_claims(
 job_id,account_id,device_id,resource_key,resource_mode,worker_weight)
 VALUES('0af5a9c1-8050-478a-83d1-5e26821cf101',
 'p44-owner','p44-device','device:unknown','exclusive',1);
INSERT INTO lr_gold_job_records(
 job_id,account_id,device_id,session_id,agent_id,operation_id,
 status,started_at,public_view)
 VALUES('0af5a9c1-8050-478a-83d1-5e26821cf101',
 'p44-owner','p44-device',
 'gshare_0af5a9c1-8050-478a-83d1-5e26821cf101',
 'p44-plugin-agent','guestop-a111111111111111','queued',
 clock_timestamp(),'{"guestScope":{"purpose":"pro-share-guest"},"signedGuestDelegationVerified":false}'::jsonb);
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n
 FROM lr_gold_pro_share_guest_jobs g
 JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
 JOIN lr_gold_personal_agent_work w
  ON w.job_id=g.job_id AND w.account_id=g.owner_account_id
  AND w.device_id=g.device_id
 JOIN lr_gold_device_resource_claims c
  ON c.job_id=w.job_id AND c.account_id=w.account_id
  AND c.device_id=w.device_id
 JOIN lr_gold_job_records j
  ON j.job_id=g.job_id AND j.account_id=g.owner_account_id
  AND j.device_id=g.device_id
 WHERE g.job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND g.owner_account_id='p44-owner' AND g.guest_account_id='p44-guest'
  AND c.worker_state='admitting' AND c.resource_key='device:unknown'
  AND j.status='queued' AND s.state='reserved';
 IF n<>1 THEN
  RAISE EXCEPTION 'Guest UUID did not join one owner Gold/M4 claim';
 END IF;
 n:=0;
 BEGIN
  INSERT INTO lr_gold_device_resource_claims(
   job_id,account_id,device_id,resource_key,resource_mode,worker_weight)
  VALUES('p44-nonexistent','p44-owner','p44-device',
   'device:unknown','exclusive',1);
 EXCEPTION WHEN foreign_key_violation THEN n:=1;
 END;
 IF n<>1 THEN
  RAISE EXCEPTION 'M4 resource claim without canonical work accepted';
 END IF;
END $$;
COMMIT;
SELECT 'PG044_NATIVE_GUEST_OWNER_GOLD_M4_SINGLE_UUID_AND_FK=PASS';
-- Crash-fence transition: one transaction spans four independent PG tables.
BEGIN;
UPDATE lr_gold_pro_share_guest_jobs SET state='unknown'
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND state='queued';
UPDATE lr_gold_pro_share_guest_slots SET state='unknown',
 dispatch_attempted_at=clock_timestamp()
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND state='reserved';
UPDATE lr_gold_personal_agent_work SET state='unknown'
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND account_id='p44-owner' AND state='running';
UPDATE lr_gold_job_records SET status='running',
 public_view=jsonb_set(jsonb_set(public_view,'{status}',
  '"running"'::jsonb,true),'{effectState}',
  '"unknown"'::jsonb,true)
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND account_id='p44-owner' AND status='queued';
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n
 FROM lr_gold_pro_share_guest_jobs g
 JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
 JOIN lr_gold_personal_agent_work w ON w.job_id=g.job_id
 JOIN lr_gold_job_records j ON j.job_id=g.job_id
 JOIN lr_gold_device_resource_claims c ON c.job_id=g.job_id
 WHERE g.job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND g.state='unknown' AND s.state='unknown'
  AND w.state='unknown' AND j.status='running'
  AND j.public_view->>'effectState'='unknown'
  AND c.worker_state='admitting' AND c.process_id IS NULL;
 IF n<>1 THEN RAISE EXCEPTION 'PG044/M4 crash fence not atomic'; END IF;
END $$;
COMMIT;
SELECT 'PG044_NATIVE_GUEST_QUEUE_SLOT_M4_GOLD_UNKNOWN=PASS';
-- A durable Guest command can be issued only once for exactly one Guest job.
-- This is a metadata-only synthetic fixture, not an OS command.
BEGIN;
INSERT INTO lr_gold_pro_share_guest_outbound(
 job_id,operation_id,owner_account_id,guest_account_id,device_id,
 grant_id,connection_id,command_id,execution_epoch,payload_sha256,
 fleet_payload_sha256,permission_revision,device_policy_revision,
 ticket_envelope,ticket_expires_at_ms)
 VALUES('0af5a9c1-8050-478a-83d1-5e26821cf101',
 'guestop-a111111111111111','p44-owner','p44-guest','p44-device',
 'p44-guest-grant','p44-connection',
 'cmd_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',5,
 repeat('a',64),repeat('b',64),1,7,
 '{"fixture":true}'::jsonb,1850000020000);
DO $$
DECLARE refused boolean;
BEGIN
 refused:=FALSE;
 BEGIN
  INSERT INTO lr_gold_pro_share_guest_outbound(
   job_id,operation_id,owner_account_id,guest_account_id,device_id,
   grant_id,connection_id,command_id,execution_epoch,payload_sha256,
   fleet_payload_sha256,permission_revision,device_policy_revision,
   ticket_envelope,ticket_expires_at_ms)
  VALUES('0af5a9c1-8050-478a-83d1-5e26821cf101',
   'guestop-a111111111111111','p44-owner','p44-guest','p44-device',
   'p44-guest-grant','p44-connection',
   'cmd_ffffffff-1111-2222-3333-444444444444',5,
   repeat('a',64),repeat('b',64),1,7,'{}'::jsonb,1850000020000);
 EXCEPTION WHEN unique_violation THEN refused:=TRUE;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'same Guest job got second command'; END IF;
 refused:=FALSE;
 BEGIN
  INSERT INTO lr_gold_pro_share_guest_outbound(
   job_id,operation_id,owner_account_id,guest_account_id,device_id,
   grant_id,connection_id,command_id,execution_epoch,payload_sha256,
   fleet_payload_sha256,permission_revision,device_policy_revision,
   ticket_envelope,ticket_expires_at_ms)
  VALUES('0af5a9c1-8050-478a-83d1-5e26821cf102',
   'guestop-b111111111111111','p44-owner','p44-other','p44-device',
   'p44-guest-grant','p44-connection',
   'cmd_ffffffff-1111-2222-3333-555555555555',5,
   repeat('a',64),repeat('b',64),1,7,'{}'::jsonb,1850000020000);
 EXCEPTION WHEN foreign_key_violation THEN refused:=TRUE;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'foreign Guest forged outbound job scope'; END IF;
 refused:=FALSE;
 BEGIN
  INSERT INTO lr_gold_pro_share_guest_outbound(
   job_id,operation_id,owner_account_id,guest_account_id,device_id,
   grant_id,connection_id,command_id,execution_epoch,payload_sha256,
   fleet_payload_sha256,permission_revision,device_policy_revision,
   ticket_envelope,ticket_expires_at_ms)
  VALUES('0af5a9c1-8050-478a-83d1-5e26821cf102',
   'guestop-b111111111111111','p44-owner','p44-guest','p44-device',
   'p44-guest-grant','p44-connection',
   'cmd_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',5,
   repeat('a',64),repeat('b',64),1,7,'{}'::jsonb,1850000020000);
 EXCEPTION WHEN unique_violation THEN refused:=TRUE;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'same commandId mapped to second job'; END IF;
END $$;
COMMIT;
SELECT 'PG044_NATIVE_ONE_GUEST_COMMAND_ID_AND_CROSS_ACTOR_FK=PASS';
-- Synthetic M6 terminal continuity; no OS/process launched.
-- The M6 receipt in this fixture represents a previously validated signed
-- Device receipt. Test only schema/transaction invariants.
BEGIN;
UPDATE lr_gold_device_resource_claims SET
 process_id='lp_aaaaaaaaaaaaaaaaaaaaaaaa',
 worker_state='running',launch_observed_at=clock_timestamp()
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
 AND account_id='p44-owner' AND worker_state='admitting';
UPDATE lr_gold_pro_share_guest_slots SET
 process_id='lp_aaaaaaaaaaaaaaaaaaaaaaaa',state='submitted'
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
 AND state='unknown';
INSERT INTO lr_gold_terminal_receipt_acks(
 account_id,device_id,process_id,job_id,terminal_state,finished_at_ms)
 VALUES ('p44-owner','p44-device',
 'lp_aaaaaaaaaaaaaaaaaaaaaaaa',
 '0af5a9c1-8050-478a-83d1-5e26821cf101','finished',1850000001234);
-- A forged receipt for another process is ineligible for our exact scoped JOIN.
INSERT INTO lr_gold_terminal_receipt_acks(
 account_id,device_id,process_id,job_id,terminal_state,finished_at_ms)
 VALUES('p44-owner','p44-device','lp_bbbbbbbbbbbbbbbbbbbbbbbb',
 '0af5a9c1-8050-478a-83d1-5e26821cf101','error',1850000001234);
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM lr_gold_pro_share_guest_slots s
 JOIN lr_gold_terminal_receipt_acks a
  ON a.account_id=s.owner_account_id
  AND a.device_id=s.device_id AND a.job_id=s.job_id
  AND a.process_id=s.process_id
 WHERE s.job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND s.state='submitted' AND a.terminal_state='finished';
 IF n<>1 THEN RAISE EXCEPTION 'M6 matched wrong receipt'; END IF;
END $$;
DELETE FROM lr_gold_device_resource_claims
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND account_id='p44-owner' AND device_id='p44-device'
  AND process_id='lp_aaaaaaaaaaaaaaaaaaaaaaaa'
  AND worker_state='running';
UPDATE lr_gold_personal_agent_work
 SET state='finished',finished_at=clock_timestamp(),
 disposition='guest_signed_m6_terminal'
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND account_id='p44-owner' AND state='unknown';
UPDATE lr_gold_pro_share_guest_slots
 SET state='terminal',terminal_state='finished',
 terminal_acked_at=clock_timestamp()
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND owner_account_id='p44-owner'
  AND process_id='lp_aaaaaaaaaaaaaaaaaaaaaaaa'
  AND state='submitted';
UPDATE lr_gold_pro_share_guest_jobs
 SET state='terminal',updated_at=clock_timestamp()
 WHERE job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND owner_account_id='p44-owner' AND state='unknown';
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM lr_gold_pro_share_guest_jobs g
 JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
 JOIN lr_gold_personal_agent_work w ON w.job_id=g.job_id
 WHERE g.job_id='0af5a9c1-8050-478a-83d1-5e26821cf101'
  AND g.state='terminal' AND s.state='terminal'
  AND s.terminal_state='finished' AND w.state='finished'
  AND w.disposition='guest_signed_m6_terminal'
  AND NOT EXISTS(
   SELECT 1 FROM lr_gold_device_resource_claims c
   WHERE c.job_id=g.job_id
  );
 IF n<>1 THEN RAISE EXCEPTION 'Guest M3/M4/slot terminal not synchronized'; END IF;
END $$;
COMMIT;
SELECT 'PG044_NATIVE_GUEST_M6_M3_M4_TERMINAL_CONTINUITY=PASS';
