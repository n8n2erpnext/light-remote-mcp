#!/usr/bin/env python3
"""Source-only invariants: fake signed verifier->issuer receipt is NOT issuer."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
MOD=(ROOT/'portability/synthetic-verifier-issuer-receipt.mjs').read_text()
TEST=(ROOT/'test/test_synthetic_verifier_issuer_receipt.mjs').read_text()
class SignedReceiptSource(unittest.TestCase):
 def test_01_domain_separated_version(self):
  self.assertIn('LIGHT_REMOTE_RC50_FAKE_VERIFIER_ISSUER_RECEIPT_V1',MOD)
  self.assertIn("const FIELDS=",MOD)
  self.assertIn('Object.fromEntries(',MOD)
 def test_02_reverify_source_before_private_sign(self):
  self.assertIn('verifySyntheticOwnerChannelEnvelope(envelope,trusted,nowMs)',MOD)
  self.assertIn("RECEIPT_SOURCE_SIGNATURE_NOT_VERIFIED",MOD)
  self.assertIn("crypto.sign(null,canon(p),privateKey)",MOD)
 def test_03_pinned_independent_issuer_public_key(self):
  self.assertIn("fakeVerifierKeyPin(key)!==context.verifierKeySha256",MOD)
  self.assertIn("context.verifierState!=='active'",MOD)
  self.assertIn("p.verifierKeyEpoch!==context.verifierKeyEpoch",MOD)
  self.assertIn("crypto.verify(null,canon(p),key,",MOD)
 def test_04_clock_and_writer_authority(self):
  self.assertIn('UAT_WINDOW=10000',MOD)
  self.assertIn('p.issuedAtMs>nowMs||nowMs>=p.expiresAtMs',MOD)
  self.assertIn('expectedWriterEpoch:',MOD)
  self.assertIn('expectedGrantGeneration:',MOD)
  self.assertIn("context.writerFenced!==false",MOD)
 def test_05_no_real_grant_or_physical_effect(self):
  self.assertIn('grantCommitted:false',MOD)
  self.assertIn('productionIssuerAuthorized:false',MOD)
  self.assertIn('physicalExecutionAuthorized:false',MOD)
  for term in ['lr_uat_commit_owner_channel_origin','INSERT INTO lr_ab_grants',
       'docker.sock','writeFileSync','spawnSync','execSync']:
   self.assertNotIn(term,MOD)
 def test_06_keys_only_fake_in_test(self):
  self.assertIn("generateKeyPairSync('ed25519')",TEST)
  self.assertIn("RECEIPT_FAKE_PRIVATE_KEY_REQUIRED",MOD)
  self.assertIn('privateKey:keys.privateKey',TEST)
 def test_07_replay_still_requires_pg_consumption(self):
  self.assertIn('PostgreSQL single-use NOT wired',TEST)
  self.assertNotIn('consume(',MOD)
  self.assertNotIn('singleUse:true',MOD)
 def test_08_negative_forgery_and_revocation(self):
  for phrase in ['signed wall or channel tampering','altered receipt body',
   'revoked/rotated verifier key','stale writer epoch',
   'revoked owner session or consumed request','receipt expires quickly']:
   self.assertIn(phrase,TEST)
 def test_09_source_stays_unwired(self):
  self.assertNotIn('from \'./synthetic-verifier-issuer-receipt.mjs\'',
   (ROOT/'portability/synthetic-origin-verifier-http-service.mjs').read_text())
  self.assertNotIn('from \'./synthetic-verifier-issuer-receipt.mjs\'',
   (ROOT/'portability/synthetic-owner-channel-verifier-pg.mjs').read_text())
if __name__=='__main__':
 unittest.main(verbosity=2)
