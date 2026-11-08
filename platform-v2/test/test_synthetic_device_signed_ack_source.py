#!/usr/bin/env python3
"""Read-only source contract: isolated device Ed25519 ACK, no production bridge."""
from pathlib import Path
import unittest

R=Path(__file__).resolve().parents[1]
P=R/'portability'
A=(P/'synthetic-device-lease-ack.mjs').read_text()
CLI=(P/'synthetic-device-ack-fixture-cli.mjs').read_text()
TEST=(P/'test_synthetic_device_lease_ack.mjs').read_text()
SQL=(P/'device_signed_ack_uat.sql').read_text()
RUN=(P/'verify_signed_device_ack_pg_uat.py').read_text()
REAL=(R.parent/'device-agent/operator-agent.mjs').read_text()
WALL=(R.parent/'device-agent/local-wall.mjs').read_text()

class SignedFakeAckSourceGuard(unittest.TestCase):
 def test_isolation_from_real_agent_and_wall(self):
  self.assertNotIn('synthetic-device-lease-ack',REAL+WALL)
  self.assertIn('OFFLINE UAT ONLY',A)
  self.assertIn('physicalExecutionAuthorized:false',A)
  self.assertIn('productionAckAuthorized:false',A)
 def test_signed_packet_binds_enrollment_lease_and_epoch(self):
  for t in ["fakeSignedOutboxDigest(signedLease)",
   "fakeIssuerPublicKeyFingerprint(issuerPublicKey)",
   "fakeIssuerPublicKeyFingerprint(devicePublicKey)",
   "claimSeq","generation","grantRevision","nonceSha256",
   "crypto.sign(null,bytes(payload),devicePrivateKey)",
   "crypto.verify(null,bytes(ack),devicePublicKey"]:
   self.assertIn(t,A)
 def test_trusted_challenge_and_generation_are_required(self):
  for t in ["ack.nonceSha256!==expected.nonceSha256",
   "ack.challengeExpiresAtMs!==expected.challengeExpiresAtMs",
   "lease.generation!==expected.floorGeneration",
   "lease.grantRevision!==expected.floorGrantRevision",
   "expected.nonceUnused!==true","expected.enrollmentActive!==true"]:
   self.assertIn(t,A)
 def test_verifier_separate_process_never_generates_private_key(self):
  for t in ["mode==='--synthetic-only'","['--synthetic-only','--verify-only'].includes(mode)",
   "body.action==='verify' && !device",
   "body.action==='sign' && device"]:
   self.assertIn(t,CLI)
  self.assertNotIn("privateKey.export(",CLI+A)
  self.assertIn("['node',str(CLI),'--verify-only']",RUN)
 def test_scratch_only_sql_and_compose(self):
  for t in ["--confirm-synthetic-only","u.check_isolation(cid)",
   "u.migrations(cid)","u.BASE+'-src'",
   "down','--volumes','--remove-orphans",
   "RC50_DEVICE_SIGNED_ACK_PRIVATE_COMPOSE_CLEANED"]:
   self.assertIn(t,RUN)
  for t in ["CREATE ROLE","CREATE USER","SECURITY DEFINER"]:
   self.assertNotIn(t,SQL)
 def test_nonce_unique_and_receipt_fenced_in_one_transaction(self):
  for t in ["nonce_sha256 TEXT NOT NULL UNIQUE",
   "lr_uat_issue_device_ack_challenge",
   "lr_uat_commit_signed_device_ack",
   "FOR UPDATE OF o,f,ek,pin,g",
   "DEVICE_ACK_SIGNATURE_DUPLICATE_NOOP",
   "uat_device_signed_ack_conflicting_replay",
   "INSERT INTO lr_uat_signed_device_ack_receipt",
   "UPDATE lr_uat_device_ack_challenge",
   "lr_uat_ack_signed_lease(p_request_id,p_grant_id"]:
   self.assertIn(t,SQL)
 def test_no_pg_signature_claim(self):
  self.assertIn('SQL CANNOT verify Ed25519 signatures',SQL)
  self.assertNotIn('CREATE EXTENSION pgcrypto',SQL)
  self.assertIn('production=false',RUN)
 def test_rogue_key_nonce_revoke_and_replay_tests(self):
  for t in ["ACK signature forgery by rogue device",
   "tampered signed issuer lease","different one-time ACK challenge",
   "current device floor generation revoked","consumed nonce denied",
   "public verifier subprocess"]:
   self.assertIn(t,TEST)
  for t in ["ACK PASS 07 revoked enrolled",
   "ACK PASS 08 newer device writer generation",
   "ACK PASS 10 exact signed ACK retransmission",
   "ACK PASS 11 conflicting fake ACK packet digest"]:
   self.assertIn(t,RUN)
 def test_no_native_action_imported(self):
  for t in ["executeCommand(","NATIVE_TERMINALS","NATIVE_PROCESSES",
   "executeNativeFs(","requestLocalUpdate(","LIGHT_SCP"]:
   self.assertNotIn(t,A+CLI)

if __name__=='__main__':
 unittest.main(verbosity=2)
