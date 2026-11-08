\set ON_ERROR_STOP on
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan,status) VALUES
('uat_owner_01','owner@rc50-uat.invalid','pro','active'),
('uat_member_01','member@rc50-uat.invalid','free','active');
INSERT INTO lr_devices(device_id,owner_account_id,state)
VALUES('uat_device_01','uat_owner_01','online');
INSERT INTO lr_teams(team_id,owner_account_id) VALUES('uat_team_01','uat_owner_01');
INSERT INTO lr_team_members(team_id,account_id)
VALUES('uat_team_01','uat_owner_01'),('uat_team_01','uat_member_01');
INSERT INTO lr_worker_slots(device_id,slot_number)
VALUES('uat_device_01',1),('uat_device_01',2),('uat_device_01',3);
DO $$
BEGIN
 BEGIN
   INSERT INTO lr_worker_slots(device_id,slot_number) VALUES('uat_device_01',4);
   RAISE EXCEPTION 'fourth worker slot unexpectedly accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id)
VALUES('uat_job_01','uat_owner_01','uat_member_01','uat_device_01','op_uat_01');
INSERT INTO lr_usage_events(event_id,owner_account_id,actor_account_id,device_id,job_id,month_key,tool_calls)
VALUES('uat_event_01','uat_owner_01','uat_member_01','uat_device_01','uat_job_01','2026-10',1)
ON CONFLICT DO NOTHING;
INSERT INTO lr_usage_events(event_id,owner_account_id,actor_account_id,device_id,job_id,month_key,tool_calls)
VALUES('uat_event_01','uat_owner_01','uat_member_01','uat_device_01','uat_job_01','2026-10',1)
ON CONFLICT DO NOTHING;
INSERT INTO lr_usage_monthly(owner_account_id,month_key,tool_calls)
VALUES('uat_owner_01','2026-10',1)
ON CONFLICT(owner_account_id,month_key) DO UPDATE SET tool_calls=lr_usage_monthly.tool_calls+EXCLUDED.tool_calls;
DO $$
DECLARE total BIGINT;
BEGIN
 SELECT COALESCE(SUM(tool_calls),0) INTO total FROM lr_usage_events WHERE owner_account_id='uat_owner_01';
 IF total<>1 THEN RAISE EXCEPTION 'usage idempotency failed'; END IF;
 SELECT COALESCE(SUM(tool_calls),0) INTO total FROM lr_usage_monthly WHERE owner_account_id='uat_owner_01';
 IF total<>1 THEN RAISE EXCEPTION 'monthly quota aggregation failed'; END IF;
END $$;
INSERT INTO lr_billing_events(event_id,owner_account_id,provider,external_transaction_id,kind,amount_minor,currency,provider_event_id)
VALUES('uat_billing_01','uat_owner_01','paddle','txn_uat_01','payment',2000,'USD','evt_uat_01')
ON CONFLICT DO NOTHING;
INSERT INTO lr_billing_events(event_id,owner_account_id,provider,external_transaction_id,kind,amount_minor,currency,provider_event_id)
VALUES('uat_billing_02','uat_owner_01','paddle','txn_uat_01','payment',2000,'USD','evt_uat_01')
ON CONFLICT DO NOTHING;
DO $$
DECLARE total BIGINT;
BEGIN
 SELECT COUNT(*) INTO total FROM lr_billing_events WHERE provider_event_id='evt_uat_01';
 IF total<>1 THEN RAISE EXCEPTION 'webhook event idempotency failed'; END IF;
END $$;
INSERT INTO lr_outbox(topic,aggregate_id,payload)
VALUES('billing_event','uat_owner_01','{"synthetic":true}'::jsonb);
ROLLBACK;
DO $$
DECLARE c BIGINT;
BEGIN
 SELECT COUNT(*) INTO c FROM lr_accounts WHERE account_id LIKE 'uat_%';
 IF c<>0 THEN RAISE EXCEPTION 'rollback left synthetic accounts'; END IF;
 SELECT COUNT(*) INTO c FROM lr_usage_events WHERE event_id='uat_event_01';
 IF c<>0 THEN RAISE EXCEPTION 'rollback left usage'; END IF;
 SELECT COUNT(*) INTO c FROM lr_billing_events WHERE provider_event_id='evt_uat_01';
 IF c<>0 THEN RAISE EXCEPTION 'rollback left billing'; END IF;
END $$;
SELECT 'RC50_PG_SCHEMA_UAT_ROLLBACK_PASS' AS result;
