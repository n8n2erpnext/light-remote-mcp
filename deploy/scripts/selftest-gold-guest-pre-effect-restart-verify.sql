DO $$
DECLARE n INTEGER;
BEGIN
 SELECT count(*) INTO n FROM lr_gold_pro_share_guest_jobs g
 JOIN lr_gold_pro_share_guest_slots s ON s.job_id=g.job_id
 JOIN lr_gold_personal_agent_work w ON w.job_id=g.job_id
 JOIN lr_gold_device_resource_claims c ON c.job_id=g.job_id
 JOIN lr_gold_job_records j ON j.job_id=g.job_id
 WHERE g.job_id='0af5a9c1-8050-478a-83d1-5e26821cf102'
  AND g.state='queued' AND s.state='reserved'
  AND w.state='running' AND w.disposition IS NULL
  AND c.worker_state='admitting' AND c.process_id IS NULL
  AND j.status='queued' AND j.public_view->>'status'='queued';
 IF n<>1 THEN RAISE EXCEPTION 'Guest safe pre-effect reservation was lost on restart'; END IF;
 SELECT count(*) INTO n FROM lr_gold_personal_agent_work w
 JOIN lr_gold_device_resource_claims c ON c.job_id=w.job_id
 JOIN lr_gold_job_records j ON j.job_id=w.job_id
 WHERE w.job_id='0af5a9c1-8050-478a-83d1-5e26821cf103'
  AND w.state='unknown' AND w.disposition='operator_restart_reconcile'
  AND c.worker_state='terminal_unknown' AND c.process_id IS NULL
  AND j.status='interrupted' AND j.public_view->>'status'='interrupted';
 IF n<>1 THEN RAISE EXCEPTION 'Legacy owner restart no longer fences unknown'; END IF;
END $$;
SELECT 'PG044_NATIVE_PRE_EFFECT_GUEST_RESTART_OWNER_SEPARATION=PASS';
