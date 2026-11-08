#!/usr/bin/env python3
"""Source-only guards for global nonce ledger, distinct from actual PG UAT."""
from pathlib import Path
import ast
import unittest
P=Path(__file__).resolve().parents[1]/'portability'
SQL=(P/'uat_global_nonce_ledger.sql').read_text()
HARNESS=(P/'verify_global_nonce_ledger_pg_uat.py').read_text()
class GlobalNonceContract(unittest.TestCase):
 def test_01_source_parses(self):
  ast.parse(HARNESS)
 def test_02_unique_nonce_and_request(self):
  self.assertIn('PRIMARY KEY(producer_id,nonce_hex)',SQL)
  self.assertIn('UNIQUE(request_id)',SQL)
  self.assertIn('UNIQUE(account_id,device_id,claim_generation)',SQL)
 def test_03_one_authority_row_is_serialization_point(self):
  self.assertIn('FOR UPDATE OF a0,p',SQL)
  self.assertIn('claim_generation=claim_generation+1',SQL)
  self.assertIn('RETURNING claim_generation INTO new_gen',SQL)
 def test_04_fenced_writer_and_key_pins(self):
  self.assertIn('a.fenced OR a.writer_epoch<>p_writer_epoch',SQL)
  self.assertIn("a.state<>'active'",SQL)
  self.assertIn('a.key_sha256<>p_key_sha256',SQL)
  self.assertIn('a.producer_account<>p_account_id',SQL)
 def test_05_timestamp_and_nonce_constraints(self):
  self.assertIn("p_signed_at<instant-interval '30 seconds'",SQL)
  self.assertIn("'^[a-f0-9]{32}$'",SQL)
  self.assertIn("'^[a-f0-9]{64}$'",SQL)
 def test_06_no_grant_or_signature_authority(self):
  for phrase in ['INSERT INTO lr_ab_grants','UPDATE lr_ab_requests',
       'pgcrypto','SECURITY DEFINER','CREATE EXTENSION']:
   self.assertNotIn(phrase,SQL)
  self.assertIn('NO signature validation or real grant',SQL)
  self.assertIn('SECURITY INVOKER',SQL)
 def test_07_public_privileges_revoked(self):
  self.assertIn('REVOKE ALL ON TABLE lr_uat_replay_authority',SQL)
  self.assertIn('REVOKE ALL ON FUNCTION lr_uat_record_global_nonce(',SQL)
  self.assertNotIn('GRANT EXECUTE',SQL)
 def test_08_explicit_synthetic_fixture_project(self):
  self.assertIn("--confirm-synthetic-only",HARNESS)
  self.assertIn("lr-uat-move-[0-9a-f]{10}",HARNESS)
  self.assertIn("u.check_isolation(pg)",HARNESS)
  self.assertIn("'--volumes','--remove-orphans'",HARNESS)
 def test_09_cross_session_concurrency(self):
  self.assertIn('ThreadPoolExecutor(max_workers=2)',HARNESS)
  self.assertIn("concurrent_double_nonce_win",HARNESS)
  self.assertIn("race_generation_over_advanced",HARNESS)
 def test_10_faults_and_rollback(self):
  for marker in ['transaction_rollback_left_nonce','rolled_back_nonce_never_reusable',
                 'uat_global_nonce_epoch_or_producer_denied',
                 'uat_global_nonce_window_invalid','duplicate key value violates unique constraint']:
   self.assertIn(marker,HARNESS)
 def test_11_principals_and_scope(self):
  self.assertIn('lr_uat_global_nonce_observer',HARNESS)
  self.assertIn('permission denied',HARNESS)
  self.assertIn("producer_id TEXT NOT NULL REFERENCES lr_uat_replay_producer",SQL)
 def test_12_status_nonproduction(self):
  self.assertIn('production=false issuer_wiring=false',HARNESS)
  self.assertNotIn('platform-v2/services/',HARNESS)
  self.assertNotIn('operator-host/',HARNESS)
if __name__=='__main__':
 unittest.main(verbosity=2)
