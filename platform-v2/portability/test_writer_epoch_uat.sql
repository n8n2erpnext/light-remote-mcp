-- rc50 synthetic PG fence assertions. Runs entirely inside one transaction,
-- including a fenced writer turnover. ROLLBACK leaves singleton row unchanged.
-- Requires the isolated uat_writer_epoch.sql schema installed into rc50 PG UAT.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
 g0 BIGINT;
 g1 BIGINT;
 g2 BIGINT;
 g3 BIGINT;
 blocked BOOLEAN;
BEGIN
 SELECT generation INTO g0 FROM lr_rc50_epoch_synthetic.writer_authority WHERE id=1;
 IF g0 IS NULL OR g0<1 THEN RAISE EXCEPTION 'missing_uat_authority_row'; END IF;
 -- Force a fenced fixture epoch if the private test schema was left active:
 IF EXISTS(SELECT 1 FROM lr_rc50_epoch_synthetic.writer_authority WHERE id=1 AND state='active') THEN
   g0:=lr_rc50_epoch_synthetic.fence_writer_uat(g0);
 END IF;
 g1:=lr_rc50_epoch_synthetic.start_writer_uat('uat_alpha_writer',g0,60);
 IF g1<>g0+1 OR NOT lr_rc50_epoch_synthetic.assert_writer_uat('uat_alpha_writer',g1) THEN
   RAISE EXCEPTION 'writer_lease_acquisition_failed'; END IF;
 IF lr_rc50_epoch_synthetic.assert_writer_uat('uat_beta_writer',g1)
    OR lr_rc50_epoch_synthetic.assert_writer_uat('uat_alpha_writer',g0)
    OR lr_rc50_epoch_synthetic.renew_writer_uat('uat_beta_writer',g1,60) THEN
   RAISE EXCEPTION 'stale_or_foreign_writer_allowed'; END IF;
 IF NOT lr_rc50_epoch_synthetic.renew_writer_uat('uat_alpha_writer',g1,60) THEN
   RAISE EXCEPTION 'same_generation_renew_failed'; END IF;
 BEGIN
   PERFORM lr_rc50_epoch_synthetic.start_writer_uat('uat_beta_writer',g1,60);
   RAISE EXCEPTION 'split_brain_acquire_allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 g2:=lr_rc50_epoch_synthetic.fence_writer_uat(g1);
 IF g2<>g1+1 OR lr_rc50_epoch_synthetic.assert_writer_uat('uat_alpha_writer',g1)
   OR lr_rc50_epoch_synthetic.renew_writer_uat('uat_alpha_writer',g1,60) THEN
   RAISE EXCEPTION 'fenced_old_writer_accepted'; END IF;
 BEGIN
   PERFORM lr_rc50_epoch_synthetic.start_writer_uat('uat_alpha_writer',g1,60);
   RAISE EXCEPTION 'stale_expected_generation_allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 g3:=lr_rc50_epoch_synthetic.start_writer_uat('uat_beta_writer',g2,60);
 IF g3<>g2+1 OR NOT lr_rc50_epoch_synthetic.assert_writer_uat('uat_beta_writer',g3)
   OR lr_rc50_epoch_synthetic.assert_writer_uat('uat_alpha_writer',g1) THEN
   RAISE EXCEPTION 'one_active_writer_turnover_failed'; END IF;
 -- Expire current lease inside this transaction only; future renew and DB
 -- writes must fail (no time-based automatic takeover).
 UPDATE lr_rc50_epoch_synthetic.writer_authority
    SET lease_until=clock_timestamp()-interval '1 second' WHERE id=1;
 IF lr_rc50_epoch_synthetic.assert_writer_uat('uat_beta_writer',g3)
   OR lr_rc50_epoch_synthetic.renew_writer_uat('uat_beta_writer',g3,60) THEN
   RAISE EXCEPTION 'expired_lease_fail_open'; END IF;
 RAISE NOTICE 'RC50_SYNTHETIC_PG_EPOCH_PASS initial=% first=% fenced=% new=%',g0,g1,g2,g3;
END $$;
ROLLBACK;
