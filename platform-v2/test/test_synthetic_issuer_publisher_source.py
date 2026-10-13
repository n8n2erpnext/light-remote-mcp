#!/usr/bin/env python3
"""Read-only guards: fake signer / claim fence / ack durability, NOT production."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
P=ROOT/'portability'
SQL=(P/'issuer_publisher_uat.sql').read_text()
PY=(P/'verify_issuer_publisher_pg_uat.py').read_text()
NODE=(P/'synthetic-outbox-lease-publisher.mjs').read_text()
TEST=(P/'test_synthetic_outbox_lease_publisher.mjs').read_text()
AGENT=(ROOT.parent/'device-agent/operator-agent.mjs').read_text()
WALL=(ROOT.parent/'device-agent/local-wall.mjs').read_text()

class PublisherSourceGuard(unittest.TestCase):
 def test_not_imported_by_real_wall_or_agent(self):
  self.assertNotIn('synthetic-outbox-lease-publisher',AGENT)
  self.assertNotIn('synthetic-outbox-lease-publisher',WALL)
  self.assertIn('PRIVATE SYNTHETIC fixture signer',NODE)
  self.assertIn('ISOLATED SCRATCH POSTGRES ONLY',SQL)
 def test_all_claims_scoped_and_concurrency_locked(self):
  for mark in ["FOR UPDATE OF o, f SKIP LOCKED","claim_seq=o.claim_seq+1",
      "claim_expires_at=now_stamp+interval '30 seconds'",
      "p.generation=f.generation","p.grant_revision=f.grant_revision"]:
   self.assertIn(mark,SQL)
 def test_obsolete_outboxes_canceled_without_signature(self):
  self.assertIn("SET status='canceled'",SQL)
  self.assertIn('p.generation < f.generation',SQL)
  self.assertIn("old_generations_not_canceled",PY)
 def test_fence_before_finalization(self):
  for mark in ["rec.claim_token IS DISTINCT FROM p_claim_token",
       "rec.claim_seq<>p_claim_seq","rec.claim_expires_at<=now_stamp",
       "rec.generation<>rec.current_generation",
       "rec.grant_revision<>rec.current_revision",
       "rec.enrolled_state<>'active'",
       "rec.trusted_issuer_key<>p_issuer_key_sha256"]:
   self.assertIn(mark,SQL)
 def test_publisher_pins_signer_and_short_lease(self):
  self.assertIn("lr_uat_issuer_pin",SQL)
  self.assertIn("p_lease_expires_at>now_stamp+interval '30 seconds'",SQL)
  self.assertIn("lr_uat_finalize_signing",SQL)
 def test_signing_outside_database_and_cryptographically_verified_in_node(self):
  for mark in ["crypto.sign(null,canon(payload),privateKey)",
      "crypto.verify(null,canon(packet.payload),publicKey",
      "crypto.generateKeyPairSync('ed25519')",
      "LR_RC50_UAT_ONLY"]:
   self.assertIn(mark,NODE)
  for no in ["create role","create user","security definer","pgcrypto",
             "private_key","exec_program"]:
   self.assertNotIn(no,SQL.lower())
 def test_ack_one_to_one_and_binding(self):
  for mark in ["request_id TEXT PRIMARY KEY REFERENCES",
      "nonce_sha256 TEXT NOT NULL UNIQUE",
      "rec.signed_digest_sha256<>p_signed_digest",
      "rec.enrolled_device_key<>p_device_key_sha256",
      "rec.generation<>rec.floor_generation",
      "RETURN 'ACK_DUPLICATE_NOOP'","RAISE EXCEPTION 'uat_ack_conflicting_replay'"]:
   self.assertIn(mark,SQL)
 def test_only_isolated_synthetic_compose_projects(self):
  for mark in ["--confirm-synthetic-only","u.BASE+'-src'",
      "u.check_isolation(cid)","u.migrations(cid)","verify(cid)",
      "down','--volumes','--remove-orphans",
      "RC50_ISSUER_PUBLISHER_ISOLATED_PROJECT_CLEANED"]:
   self.assertIn(mark,PY)
 def test_tests_cover_attack_classes(self):
  for mark in ["rogue Ed25519 key","signed claim sequence tamper",
      "cannot be real owner request","CLI fails closed"]:
   self.assertIn(mark,TEST)
  for mark in ["two concurrent claimers","wrong token and claim sequence",
      "expired claim cannot sign","revoked enrolled device",
      "stale global device generation","closed/revoked grant",
      "same retransmission is idempotent","different nonce"]:
   self.assertIn(mark,PY)

if __name__=='__main__':
 unittest.main(verbosity=2)
