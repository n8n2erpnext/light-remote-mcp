-- No customer data or OS process. Runs ONLY after disposable PG044 fixture.
BEGIN;
-- Separate Guest already CANCELLED, but crash before M3/M4/Gold cleanup.
-- It must survive startup untouched so cancelBeforeEffect can finish.
INSERT INTO lr_gold_pro_share_guest_jobs(
 job_id,operation_id,request_key,owner_account_id,guest_account_id,
 agent_id,client_session_id,device_id,grant_id,connection_id,operation,
 required_capabilities,permission_revision,state
) VALUES('0af5a9c1-8050-478a-83d1-5e26821cf104',
 'guestop-c111111111111111',repeat('d',32),
 'p44-owner','p44-guest','p44-plugin-agent','lrc_p44_guest',
 'p44-device','p44-guest-grant','p44-connection',
 'process',ARRAY['filesystem'],1,'cancelled');
INSERT INTO lr_gold_pro_share_guest_slots(
 operation_id,owner_account_id,guest_account_id,device_id,job_id,grant_id,connection_id,state
) VALUES('guestop-c111111111111111','p44-owner','p44-guest','p44-device',
 '0af5a9c1-8050-478a-83d1-5e26821cf104','p44-guest-grant',
 'p44-connection','cancelled');
INSERT INTO lr_gold_pro_share_guest_slots(
 operation_id,owner_account_id,guest_account_id,device_id,job_id,grant_id,connection_id,state
) VALUES (
 'guestop-b111111111111111','p44-owner','p44-guest','p44-device',
 '0af5a9c1-8050-478a-83d1-5e26821cf102','p44-guest-grant','p44-connection','reserved'
);
INSERT INTO lr_gold_personal_agent_work (
 job_id,account_id,agent_id,session_id,operation_id,state,
 started_at,device_id,resource_key,resource_mode,worker_weight
) VALUES
 ('0af5a9c1-8050-478a-83d1-5e26821cf102','p44-owner','p44-plugin-agent',
 'gshare_0af5a9c1-8050-478a-83d1-5e26821cf102',
 'guestop-b111111111111111','running',clock_timestamp(),
 'p44-device','device:unknown','exclusive',1),
 ('0af5a9c1-8050-478a-83d1-5e26821cf103','p44-owner','p44-plugin-agent',
 'owner-fixture-1','ownerop-test-1234567890','running',clock_timestamp(),
 'p44-device','device:unknown','exclusive',1),
 ('0af5a9c1-8050-478a-83d1-5e26821cf104','p44-owner','p44-plugin-agent',
 'gshare_0af5a9c1-8050-478a-83d1-5e26821cf104',
 'guestop-c111111111111111','running',clock_timestamp(),
 'p44-device','device:unknown','exclusive',1);
INSERT INTO lr_gold_device_resource_claims(
 job_id,account_id,device_id,resource_key,resource_mode,worker_weight
) VALUES
 ('0af5a9c1-8050-478a-83d1-5e26821cf102','p44-owner',
 'p44-device','device:unknown','exclusive',1),
 ('0af5a9c1-8050-478a-83d1-5e26821cf103','p44-owner',
 'p44-device','device:unknown','exclusive',1),
 ('0af5a9c1-8050-478a-83d1-5e26821cf104','p44-owner',
 'p44-device','device:unknown','exclusive',1);
INSERT INTO lr_gold_job_records(
 job_id,account_id,device_id,session_id,agent_id,operation_id,
 status,started_at,public_view
) VALUES
 ('0af5a9c1-8050-478a-83d1-5e26821cf102','p44-owner','p44-device',
 'gshare_0af5a9c1-8050-478a-83d1-5e26821cf102','p44-plugin-agent',
 'guestop-b111111111111111','queued',clock_timestamp(),
 '{"status":"queued","guestScope":{"purpose":"pro-share-guest"}}'::jsonb),
 ('0af5a9c1-8050-478a-83d1-5e26821cf103','p44-owner','p44-device',
 'owner-fixture-1','p44-plugin-agent','ownerop-test-1234567890',
 'queued',clock_timestamp(),'{"status":"queued"}'::jsonb),
 ('0af5a9c1-8050-478a-83d1-5e26821cf104','p44-owner','p44-device',
 'gshare_0af5a9c1-8050-478a-83d1-5e26821cf104',
 'p44-plugin-agent','guestop-c111111111111111',
 'queued',clock_timestamp(),
 '{"status":"queued","guestScope":{"purpose":"pro-share-guest"}}'::jsonb);
COMMIT;
-- Startup recovery SQL from actual Node source executes BETWEEN these files.
