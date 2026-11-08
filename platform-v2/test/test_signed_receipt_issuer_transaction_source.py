#!/usr/bin/env python3
"""Static guards for disposable PG signed receipt staging/issuer transaction."""
from pathlib import Path
import ast
import unittest
ROOT=Path(__file__).resolve().parents[1]/'portability'
SQL=(ROOT/'uat_signed_receipt_issuer_transaction.sql').read_text()
HARNESS=(ROOT/'verify_signed_receipt_issuer_pg_uat.py').read_text()
FAKE=(ROOT/'synthetic-signed-receipt-stage-fixture.mjs').read_text()
BASE=(ROOT/'uat_global_nonce_ledger.sql').read_text()
class SignedIssuerSource(unittest.TestCase):
 def test_01_source_valid(self):ast.parse(HARNESS)
 def test_02_no_real_crypto_claim(self):
  self.assertIn('SQL cannot validate Ed25519',SQL)
  self.assertIn('This does NOT invoke the previously',HARNESS)
  self.assertNotIn('CREATE EXTENSION',SQL)
 def test_03_no_production_artifacts(self):
  self.assertIn("--confirm-synthetic-only",HARNESS)
  self.assertIn("lr-uat-move-[0-9a-f]{10}",HARNESS)
  self.assertIn("'--volumes','--remove-orphans'",HARNESS)
  self.assertIn('production=false',HARNESS)
  self.assertNotIn('operator-host/',HARNESS)
 def test_04_distinct_roles(self):
  self.assertIn('CREATE ROLE lr_uat_receipt_stage_role NOLOGIN NOINHERIT',SQL)
  self.assertIn('CREATE ROLE lr_uat_receipt_issuer_role NOLOGIN NOINHERIT',SQL)
  self.assertIn('CREATE ROLE lr_uat_receipt_tx_owner NOLOGIN NOINHERIT',SQL)
 def test_05_no_public_writer_access(self):
  self.assertIn('REVOKE ALL ON FUNCTION lr_uat_commit_staged_receipt(TEXT) FROM PUBLIC',SQL)
  self.assertIn('TO lr_uat_receipt_issuer_role',SQL)
  self.assertIn('GRANT INSERT ON lr_uat_receipt_verified_stage TO lr_uat_receipt_stage_role',SQL)
  self.assertNotIn('GRANT INSERT ON lr_uat_receipt_grant TO lr_uat_receipt_issuer_role',SQL)
 def test_06_fixed_search_path_secdef(self):
  self.assertIn('SECURITY DEFINER',SQL)
  self.assertIn('SET search_path=pg_catalog,public,pg_temp',SQL)
  self.assertIn('ALTER FUNCTION lr_uat_commit_staged_receipt(TEXT)',SQL)
  self.assertIn('OWNER TO lr_uat_receipt_tx_owner',SQL)
 def test_07_signed_origin_fake_test_fixture(self):
  self.assertIn('makeSyntheticOwnerChannelDbProof(req,at,null,true)',FAKE)
  self.assertIn('signSyntheticVerifiedOriginReceipt(',FAKE)
  self.assertIn('verifySyntheticVerifierIssuerReceipt(receipt,pinned,at)',FAKE)
  self.assertIn("LR_RC50_UAT_ONLY",FAKE)
  self.assertNotIn('privateKey:keys.privateKey,production',FAKE)
 def test_08_single_global_nonce_and_receipt_id(self):
  self.assertIn('receipt_id TEXT PRIMARY KEY',SQL)
  self.assertIn('receipt_sha256 TEXT NOT NULL UNIQUE',SQL)
  self.assertIn('PRIMARY KEY(producer_id,nonce_hex)',BASE)
  self.assertIn('lr_uat_record_global_nonce(',SQL)
  self.assertIn('IF n<>s.expected_generation',SQL)
 def test_09_provenance_grant_outbox_atomic(self):
  for mark in ['INSERT INTO lr_uat_receipt_grant(',
      'INSERT INTO lr_uat_receipt_provenance(',
      'INSERT INTO lr_uat_receipt_outbox(',
      "SET state='approved'",'SET claimed_at=now_at']:
   self.assertIn(mark,SQL)
  self.assertIn('physical_execution_authorized=FALSE',SQL)
 def test_10_epoch_and_trust_checks(self):
  for mark in ["s.claimed_at IS NOT NULL","s.request_state<>'pending'",
       "s.owner_session_active IS NOT TRUE","s.device_active IS NOT TRUE",
       "s.verifier_state<>'active'","s.verifier_key_epoch<>s.trusted_key_epoch",
       "s.verifier_key_sha256<>s.trusted_key_pin",
       "s.grant_id<>s.expected_grant","s.wall_proof_sha256<>s.trusted_wall",
       "s.channel_ack_sha256<>s.trusted_channel"]:
   self.assertIn(mark,SQL)
 def test_11_short_ttl_and_database_locks(self):
  self.assertIn("s.expires_at>s.signed_at+interval '10 seconds'",SQL)
  self.assertIn('FOR UPDATE OF st,r FOR SHARE OF k',SQL)
  self.assertIn('FOR UPDATE OF a0,p',BASE)
 def test_12_test_concurrency_and_rollback(self):
  self.assertIn('ThreadPoolExecutor(max_workers=2)',HARNESS)
  self.assertIn('ROLLBACK;',HARNESS)
  self.assertIn('outbox_failure_did_not_rollback_all',HARNESS)
  self.assertIn('concurrent_double_issue',HARNESS)
 def test_13_revocations_and_replays(self):
  for mark in ['uat_receipt_verifier_key_revoked',
   'uat_receipt_owner_or_request_revoked',
   'uat_receipt_expired','uat_global_nonce_epoch_or_producer_denied',
   'duplicate key value violates unique constraint']:
   self.assertIn(mark,HARNESS)
 def test_14_admitted_scope_limit(self):
  self.assertIn('Only the fake verifier role may stage',HARNESS)
  self.assertIn('NO real approvals',FAKE)
  self.assertIn('NO production migration',SQL) if 'NO production migration' in SQL else self.assertIn('NOT a product migration',SQL)
if __name__=='__main__':unittest.main(verbosity=2)
