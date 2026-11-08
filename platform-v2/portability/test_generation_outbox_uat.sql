-- rc50 isolated synthetic PG command outbox UAT. ROLLBACK ALL TEST ENVELOPES.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
 g0 BIGINT; a BIGINT; fenced BIGINT; b BIGINT;
 result TEXT; first_claim RECORD; second_claim RECORD; new_claim RECORD;
BEGIN
 SELECT generation INTO g0 FROM lr_rc50_epoch_synthetic.writer_authority
  WHERE id=1 AND state='fenced';
 IF g0 IS NULL THEN RAISE EXCEPTION 'uat_writer_not_fenced_at_test_start'; END IF;
 a:=lr_rc50_epoch_synthetic.start_writer_uat('uat_outbox_alpha',g0,60);
 result:=lr_rc50_epoch_synthetic.enqueue_command_uat(
  'uat_outbox_alpha',a,'uat_cmd_alpha_0001','fake_fleet','{"command":"fake_only_1"}'::jsonb);
 IF result<>'queued' THEN RAISE EXCEPTION 'initial_enqueue_failed'; END IF;
 result:=lr_rc50_epoch_synthetic.enqueue_command_uat(
  'uat_outbox_alpha',a,'uat_cmd_alpha_0001','fake_fleet','{"command":"fake_only_1"}'::jsonb);
 IF result<>'duplicate_same_envelope' THEN
  RAISE EXCEPTION 'same_envelope_not_idempotent'; END IF;
 BEGIN
  PERFORM lr_rc50_epoch_synthetic.enqueue_command_uat(
    'uat_outbox_alpha',a,'uat_cmd_alpha_0001','fake_fleet','{"command":"different"}'::jsonb);
  RAISE EXCEPTION 'conflicting_command_id_accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 PERFORM lr_rc50_epoch_synthetic.enqueue_command_uat(
  'uat_outbox_alpha',a,'uat_cmd_alpha_0002','fake_pty','{"terminal":"synthetic_only"}'::jsonb);
 PERFORM lr_rc50_epoch_synthetic.enqueue_command_uat(
  'uat_outbox_alpha',a,'uat_cmd_alpha_0003','fake_webhook','{"provider":"fake_only"}'::jsonb);
 SELECT * INTO first_claim FROM lr_rc50_epoch_synthetic.claim_command_uat(
  'uat_outbox_alpha',a,'uat_consumer_alpha','uat_tag_fake_first',60);
 IF first_claim.out_command_id<>'uat_cmd_alpha_0001'
   OR first_claim.out_generation<>a THEN
  RAISE EXCEPTION 'first_claim_generation_or_order_wrong'; END IF;
 IF lr_rc50_epoch_synthetic.ack_command_uat('uat_outbox_alpha',a,
  first_claim.out_command_id,'uat_consumer_bad','uat_tag_fake_first')
  OR lr_rc50_epoch_synthetic.ack_command_uat('uat_outbox_alpha',a,
  first_claim.out_command_id,'uat_consumer_alpha','uat_tag_wrong_tag') THEN
  RAISE EXCEPTION 'invalid_ack_was_accepted'; END IF;
 IF NOT lr_rc50_epoch_synthetic.ack_command_uat('uat_outbox_alpha',a,
  first_claim.out_command_id,'uat_consumer_alpha','uat_tag_fake_first') THEN
  RAISE EXCEPTION 'valid_ack_was_refused'; END IF;
 IF lr_rc50_epoch_synthetic.ack_command_uat('uat_outbox_alpha',a,
  first_claim.out_command_id,'uat_consumer_alpha','uat_tag_fake_first') THEN
  RAISE EXCEPTION 'duplicate_ack_accepted'; END IF;
 SELECT * INTO second_claim FROM lr_rc50_epoch_synthetic.claim_command_uat(
  'uat_outbox_alpha',a,'uat_consumer_alpha','uat_tag_fake_second',60);
 IF second_claim.out_command_id<>'uat_cmd_alpha_0002' THEN
  RAISE EXCEPTION 'second_claim_wrong_id'; END IF;
 fenced:=lr_rc50_epoch_synthetic.fence_writer_uat(a);
 IF lr_rc50_epoch_synthetic.ack_command_uat('uat_outbox_alpha',a,
  second_claim.out_command_id,'uat_consumer_alpha','uat_tag_fake_second') THEN
  RAISE EXCEPTION 'fenced_writer_ack_accepted'; END IF;
 BEGIN
  PERFORM lr_rc50_epoch_synthetic.enqueue_command_uat(
   'uat_outbox_alpha',a,'uat_cmd_alpha_0004','fake_fleet','{}'::jsonb);
  RAISE EXCEPTION 'fenced_writer_enqueue_accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 b:=lr_rc50_epoch_synthetic.start_writer_uat('uat_outbox_beta',fenced,60);
 PERFORM lr_rc50_epoch_synthetic.enqueue_command_uat(
  'uat_outbox_beta',b,'uat_cmd_beta_0001','fake_fleet','{"command":"new_epoch_only"}'::jsonb);
 SELECT * INTO new_claim FROM lr_rc50_epoch_synthetic.claim_command_uat(
  'uat_outbox_beta',b,'uat_consumer_beta','uat_tag_fake_new',60);
 IF new_claim.out_command_id<>'uat_cmd_beta_0001' OR new_claim.out_generation<>b THEN
  RAISE EXCEPTION 'new_writer_claimed_old_generation'; END IF;
 IF (SELECT count(*) FROM lr_rc50_epoch_synthetic.command_outbox
  WHERE source_generation=a AND status IN ('queued','claimed'))<>2 THEN
  RAISE EXCEPTION 'stale_envelopes_not_quarantined'; END IF;
 IF NOT lr_rc50_epoch_synthetic.ack_command_uat('uat_outbox_beta',b,
  new_claim.out_command_id,'uat_consumer_beta','uat_tag_fake_new') THEN
  RAISE EXCEPTION 'new_generation_ack_failed'; END IF;
 UPDATE lr_rc50_epoch_synthetic.command_outbox
  SET status='claimed',claimed_by='uat_consumer_beta',
      claim_tag='uat_tag_fake_expired',acknowledged_at=NULL,
      claimed_until=clock_timestamp()-interval '1 second'
  WHERE command_id='uat_cmd_beta_0001';
 IF lr_rc50_epoch_synthetic.ack_command_uat('uat_outbox_beta',b,
  'uat_cmd_beta_0001','uat_consumer_beta','uat_tag_fake_expired') THEN
  RAISE EXCEPTION 'expired_claim_ack_accepted'; END IF;
 RAISE NOTICE 'RC50_GENERATION_OUTBOX_UAT_PASS start=% writer_a=% fenced=% writer_b=% old_quarantined=2',g0,a,fenced,b;
END $$;
ROLLBACK;
