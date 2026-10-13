#!/usr/bin/env python3
"""Read-only source checks: fake signed Wall/device-channel receipt -> PG transaction."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
P=ROOT/'portability'
SQL=(P/'owner_channel_origin_transaction_uat.sql').read_text()
RUN=(P/'verify_owner_channel_origin_transaction_pg_uat.py').read_text()
NODE=(P/'synthetic-owner-channel-db-proof.mjs').read_text()
TEST=(P/'test_synthetic_owner_channel_db_proof.mjs').read_text()
REAL_WALL=(ROOT.parent/'device-agent/local-wall.mjs').read_text()
REAL_AGENT=(ROOT.parent/'device-agent/operator-agent.mjs').read_text()

class OwnerChannelAtomicSource(unittest.TestCase):
 def test_uat_only_no_real_runtime_import(self):
  self.assertIn('DISPOSABLE POSTGRES ONLY',SQL)
  self.assertIn('synthetic-only bridge',NODE.lower())
  self.assertNotIn('owner_channel_origin_transaction_uat.sql',REAL_WALL+REAL_AGENT)
  self.assertNotIn('synthetic-owner-channel-db-proof.mjs',REAL_WALL+REAL_AGENT)
 def test_domain_bound_wall_channel_signature_verification(self):
  self.assertIn('signSyntheticWallApprovalOrigin',NODE)
  self.assertIn('signSyntheticChannelApprovalAck',NODE)
  self.assertIn('verifySyntheticChannelAndWallOrigin',NODE)
  self.assertIn('hashSyntheticChannelApprovalPacket(channelPacket)',NODE)
  self.assertIn("v.decision!=='VERIFIED_FAKE_OWNER_AND_CHANNEL'",NODE)
 def test_external_signer_only_explicit_synthetic_fixture(self):
  self.assertIn("'--synthetic-only'",NODE)
  self.assertIn("LR_RC50_UAT_ONLY",NODE)
  self.assertIn("'LR_RC50_UAT_ONLY':'1'",RUN)
  self.assertIn('productionIssuerAuthorized:false',NODE)
  self.assertIn('physicalExecutionAuthorized:false',NODE)
 def test_one_to_one_request_grant_and_unique_nonce(self):
  for mark in ['request_id TEXT PRIMARY KEY','grant_id TEXT NOT NULL UNIQUE',
      'owner_decision_nonce_sha256 TEXT NOT NULL UNIQUE',
      'wall_proof_sha256 TEXT NOT NULL UNIQUE',
      'signed_channel_packet_sha256 TEXT NOT NULL UNIQUE',
      'DEFERRABLE INITIALLY DEFERRED']:
   self.assertIn(mark,SQL)
 def test_db_validates_joined_owner_session_device_and_pins(self):
  for mark in ['JOIN lr_sessions sess','JOIN lr_devices dev',
     'JOIN lr_device_connections conn','JOIN lr_uat_device_enrolled_key',
     'JOIN lr_uat_trusted_origin_verifier_pins',
     'FOR UPDATE OF req,sess,dev,conn,enrolled,pin',
     "r.request_state<>'pending'",'r.session_revoked IS NOT NULL',
     "r.pin_state<>'active'","r.enrolled_state<>'active'"]:
   self.assertIn(mark,SQL)
 def test_request_timestamp_bound_to_exact_db_window(self):
  for mark in ['requestCreatedAtMs','requestExpiresAtMs']:
   self.assertIn(mark,NODE)
   self.assertIn(mark,RUN)
  for mark in ['p_request_created_at IS DISTINCT FROM r.created_at',
    'p_request_expires_at IS DISTINCT FROM r.expires_at',
    'uat_owner_channel_request_window_not_bound']:
   self.assertIn(mark,SQL)
  self.assertIn('request signed creation/expiry must match',RUN)
 def test_transaction_consumes_request_and_nonce_with_issuer(self):
  for mark in ["INSERT INTO lr_uat_signed_owner_channel_ledger",
     "INSERT INTO lr_uat_owner_approval_evidence",
     "UPDATE lr_ab_requests SET state='approved'",
     "lr_uat_issue_direct_owner_grant(p_request_id,p_grant_id)",
     "RETURN 'SYNTHETIC_OWNER_CHANNEL_ATOMIC_GRANT_PENDING_SIGNING'",
     'uat_owner_channel_nonce_replayed']:
   self.assertIn(mark,SQL)
 def test_no_production_roles_or_cryptographic_sql_assertion(self):
  for mark in ['CREATE ROLE','CREATE USER','SECURITY DEFINER',
    'CREATE EXTENSION','private_key']:
   self.assertNotIn(mark,SQL)
  self.assertIn('PostgreSQL does not verify Ed25519',SQL)
 def test_pg_runner_destroys_private_project_and_uses_real_migrations(self):
  for mark in ['--confirm-synthetic-only',"u.BASE+'-src'",
    'u.check_isolation(cid)','u.migrations(cid)',
    "down','--volumes','--remove-orphans",
    'RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_PRIVATE_COMPOSE_CLEANED']:
   self.assertIn(mark,RUN)
 def test_negative_replay_atomic_rollback_concurrency(self):
  for mark in ['wrong owner, device or channel key',
    'revoked owner session or device enrollment',
    'same decision nonce used for second request',
    'failed reused grant ID rolls back nonce',
    'concurrent issuer replay']:
   self.assertIn(mark,RUN)
  self.assertIn('invalid enrolled device fingerprint rejected',TEST)

if __name__=='__main__':
 unittest.main(verbosity=2)
