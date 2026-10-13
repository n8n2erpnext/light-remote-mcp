#!/usr/bin/env python3
"""Read-only guards for rc50 SCRAM authenticated origin verifier UAT."""
from pathlib import Path
import unittest
R=Path(__file__).resolve().parents[1]
P=R/'portability'
SQL=(P/'owner_channel_origin_verifier_acl_uat.sql').read_text()
INTENT=(P/'owner_channel_authenticated_intents_uat.sql').read_text()
RUN=(P/'verify_owner_channel_origin_transaction_pg_uat.py').read_text()
SIGN=(P/'synthetic-owner-channel-db-proof.mjs').read_text()
VERIFY=(P/'synthetic-owner-channel-verify-only.mjs').read_text()
T=(P/'test_synthetic_owner_channel_verify_only.mjs').read_text()
WALL=(R.parent/'device-agent/local-wall.mjs').read_text()
AGENT=(R.parent/'device-agent/operator-agent.mjs').read_text()

class AuthenticatedVerifierSource(unittest.TestCase):
 def test_synthetic_only_and_no_production_import(self):
  self.assertIn('UAT-only PUBLIC-KEY-ONLY verifier',VERIFY)
  self.assertNotIn('synthetic-owner-channel-verify-only',WALL+AGENT)
  self.assertIn('--confirm-synthetic-only',RUN)
 def test_login_is_noninherit_and_can_only_set_verifier(self):
  self.assertIn('CREATE ROLE lr_uat_origin_service_login LOGIN NOINHERIT',SQL)
  self.assertIn('GRANT lr_uat_origin_verifier TO lr_uat_origin_service_login',SQL)
  self.assertIn('WITH INHERIT FALSE, SET TRUE',SQL)
 def test_password_is_random_and_not_in_process_command_line(self):
  self.assertIn('secrets.token_hex(32)',RUN)
  self.assertIn('chmod 0600 /tmp/lr_rc50_origin_login_secret',RUN)
  self.assertIn("data=(\"ALTER ROLE lr_uat_origin_service_login PASSWORD '\"+secret",RUN)
  self.assertIn("data=secret.encode()",RUN)
  self.assertNotIn('password=changeme',RUN)
 def test_client_uses_scram_tcp_not_local_trust(self):
  self.assertIn('password authentication failed',RUN)
  self.assertIn('wrong_password=True',RUN)
  self.assertIn("hostname -i",RUN)
  self.assertIn('127.*|::1',RUN)
  self.assertIn('SCRAM-SHA-256$',RUN)
  self.assertNotIn(' -h 127.0.0.1 ',RUN)
 def test_verified_origin_transactions_really_use_login(self):
  self.assertIn('authenticated_sql(pg,query,secret_path)',RUN)
  self.assertIn('pool.submit(authenticated_sql,pg,authorized(p3),secret_path)',RUN)
  self.assertIn('AUTH PASS 05 SCRAM-authenticated service can SET ROLE verifier',RUN)
 def test_proof_signer_exports_public_signed_packets_only_when_uat(self):
  self.assertIn("--synthetic-envelope-only",SIGN)
  self.assertIn('wallPublicSpki',SIGN)
  self.assertIn('channelPublicSpki',SIGN)
  self.assertNotIn('privateKey.export(',SIGN)
 def test_public_verifier_never_generates_private_key(self):
  self.assertNotIn('generateKeyPairSync',VERIFY)
  self.assertNotIn('crypto.sign(',VERIFY)
  self.assertIn('verifySyntheticChannelAndWallOrigin',VERIFY)
  self.assertIn('syntheticWallOriginFingerprint(wallKey)',VERIFY)
  self.assertIn('TRUSTED_STATE_INVALID',VERIFY)
 def test_trusted_request_grant_intent_obtained_from_pg(self):
  self.assertIn('lr_uat_origin_verifier_intent',INTENT)
  self.assertIn('JOIN lr_uat_origin_verifier_intent i',RUN)
  self.assertIn('row_to_json(z)',RUN)
  self.assertIn('ownerSessionActive',RUN)
  self.assertIn('nonceUnused',RUN)
  self.assertIn('requestCreatedAtMs',VERIFY)
  self.assertIn('ownerSessionSha256',VERIFY)
 def test_negative_tests_cover_signed_packet_key_and_intent(self):
  for text in ['forged channel signature denied','forged wall signature denied',
    'wrong persisted grant intent denied','revoked database owner session denied',
    'verification fails after grant expiry','public verifier process cannot sign']:
   self.assertIn(text,T)
  self.assertIn('tampered channel, wrong trusted Wall pin and wrong DB grant intent denied',RUN)
 def test_no_prod_db_or_network_listener(self):
  self.assertIn('u.check_isolation(cid)',RUN)
  self.assertIn("u.BASE+'-src'",RUN)
  self.assertIn("down','--volumes','--remove-orphans",RUN)
  self.assertNotIn('listen(',VERIFY)
  self.assertIn('productionIssuerAuthorized:false',VERIFY)

if __name__=='__main__':
 unittest.main(verbosity=2)
