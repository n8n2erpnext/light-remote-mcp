\set ON_ERROR_STOP on
DO $$
DECLARE n INTEGER;
BEGIN
 SELECT count(*) INTO n
 FROM pg_proc p
 JOIN pg_namespace ns ON ns.oid=p.pronamespace
 CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
 WHERE ns.nspname='public'
 AND p.proname IN ('lr_claim_worker_slot','lr_renew_worker_lease',
   'lr_finish_worker_job','lr_claim_outbox','lr_ack_outbox','lr_retry_outbox')
 AND acl.grantee=0 AND acl.privilege_type='EXECUTE';
 IF n>0 THEN RAISE EXCEPTION 'worker/outbox functions exposed to PUBLIC'; END IF;
 SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='public' AND p.proname IN ('lr_claim_worker_slot',
  'lr_renew_worker_lease','lr_finish_worker_job','lr_claim_outbox',
  'lr_ack_outbox','lr_retry_outbox') AND p.prosecdef=TRUE;
 IF n>0 THEN RAISE EXCEPTION 'worker/outbox SECURITY DEFINER is forbidden'; END IF;
END $$;
SELECT 'RC50_WORKER_OUTBOX_FUNCTION_ACL_PASS' AS result;
