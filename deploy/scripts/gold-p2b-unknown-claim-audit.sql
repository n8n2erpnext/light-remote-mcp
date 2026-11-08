-- P2-B operator audit: aggregate counts ONLY. Read-only transaction.
-- Must be run with psql -qAtX -v ON_ERROR_STOP=1; no row identifiers
-- and no receipt payloads are exposed. Never modify state here.
BEGIN READ ONLY;
WITH unknown_work AS (
 SELECT w.started_at,
   (
     w.started_at IS NULL
     AND w.queue_reason IN ('QUEUED_AGENT_SLOT','RESOURCE_LOCKED')
     AND w.disposition='operator_restart_reconcile'
     AND j.status='interrupted'
     AND NOT EXISTS (
       SELECT 1 FROM lr_gold_device_resource_claims c
       WHERE c.job_id=w.job_id AND c.account_id=w.account_id AND c.device_id=w.device_id
     )
   ) AS retained,
   EXISTS (
     SELECT 1 FROM lr_gold_device_resource_claims c
     WHERE c.job_id=w.job_id AND c.account_id=w.account_id AND c.device_id=w.device_id
   ) AS has_claim
 FROM lr_gold_personal_agent_work w
 LEFT JOIN lr_gold_job_records j
   ON j.job_id=w.job_id AND j.account_id=w.account_id AND j.device_id=w.device_id
 WHERE w.state='unknown'
), resource_claims AS (
 SELECT c.worker_state,c.process_id,
   EXISTS (
     SELECT 1 FROM lr_gold_terminal_receipt_acks a
     WHERE a.job_id=c.job_id AND a.account_id=c.account_id AND a.device_id=c.device_id
       AND (c.process_id IS NULL OR a.process_id=c.process_id)
   ) AS has_exact_ack
 FROM lr_gold_device_resource_claims c
), work_aggregate AS (
 SELECT count(*)::int AS total,
   count(*) FILTER(WHERE retained)::int AS retained,
   count(*) FILTER(WHERE NOT retained)::int AS unresolved,
   count(*) FILTER(WHERE started_at IS NOT NULL)::int AS started,
   count(*) FILTER(WHERE has_claim)::int AS with_claim
 FROM unknown_work
), claim_aggregate AS (
 SELECT count(*)::int AS total,
   count(*) FILTER(WHERE worker_state='running')::int AS running,
   count(*) FILTER(WHERE NOT has_exact_ack)::int AS no_ack,
   count(*) FILTER(WHERE process_id IS NOT NULL)::int AS with_pid,
   count(*) FILTER(WHERE has_exact_ack)::int AS exact_acks
 FROM resource_claims
)
SELECT json_build_object(
 'unknownTotal',w.total,
 'retainedPreDispatch',w.retained,
 'unresolvedUnknown',w.unresolved,
 'startedUnknown',w.started,
 'unknownWithClaims',w.with_claim,
 'foreignClaims',c.total,
 'runningClaims',c.running,
 'claimsWithoutTerminalAck',c.no_ack,
 'claimsWithProcessId',c.with_pid,
 'terminalAckMatches',c.exact_acks
)::text FROM work_aggregate w CROSS JOIN claim_aggregate c;
COMMIT;
