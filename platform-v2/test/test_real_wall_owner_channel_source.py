#!/usr/bin/env python3
"""Read-only guards for REAL handler exercised only with isolated synthetic auth."""
from pathlib import Path
import unittest
R=Path(__file__).resolve().parents[1]
PORT=R/'portability'
HTTP=(PORT/'test_real_wall_owner_approval_http_uat.mjs').read_text()
MOD=(PORT/'synthetic-channel-approval-attestation.mjs').read_text()
T=(PORT/'test_synthetic_channel_approval_attestation.mjs').read_text()
WALL=(R.parent/'device-agent/local-wall.mjs').read_text()
AGENT=(R.parent/'device-agent/operator-agent.mjs').read_text()
REGISTRY=(R.parent/'operator-host/device-access-grant-registry.mjs').read_text()

class WallOwnerChannelSource(unittest.TestCase):
 def test_real_http_handler_path_and_csrf_used_without_source_mutation(self):
  self.assertIn("url.pathname==='/api/approve'",WALL)
  self.assertIn('mutationAllowed(req)',WALL)
  self.assertIn('resolveCode(data.code)',WALL)
  self.assertIn('accessApprove(found.requestId)',WALL)
  self.assertIn("startLocalWall({",HTTP)
 def test_isolated_loopback_no_live_device_or_b_code(self):
  for x in ["host:'127.0.0.1',port:0",
   "getRemoteStatus:async()=>","getLocalStatus:async()=>",
   "uat_request_http_gate","lr-uat-wall-proof-"]:
   self.assertIn(x,HTTP)
  self.assertNotIn("https://light-remote.thaiduy.digital",HTTP)
 def test_actual_authenticated_session_and_csrf_negative_http(self):
  for x in ["missing session returns 401","missing owner-bound CSRF",
   "CSRF issued to another session","forged random cookie",
   "wrong synthetic B code","consumed B code fails replay"]:
   self.assertIn(x,HTTP)
 def test_explicit_unauthed_local_wall_cannot_issue_owner_proof(self):
  self.assertIn("auth:{enabled:false}",HTTP)
  self.assertIn("issuerEvidence.length,0",HTTP)
  self.assertIn("const mutationAllowed=req=>!auth?.enabled",WALL)
 def test_two_independent_test_signing_keys(self):
  self.assertIn("const signer=crypto.generateKeyPairSync('ed25519')",HTTP)
  self.assertIn("const channelSigner=crypto.generateKeyPairSync('ed25519')",HTTP)
  self.assertIn("hashSyntheticChannelApprovalPacket(channelAck)",HTTP)
 def test_channel_and_wall_signature_verification_is_compulsory(self):
  for x in ["crypto.verify(null,encoded(p),channelPublicKey",
   "verifySyntheticWallApprovalOrigin(wallApproval",
   "channelAckSha256:digest",
   "expected.deviceChannelActive!==true",
   "expected.channelPublicSha256",
   "CHANNEL_WALL_APPROVAL_ORDER_INVALID"]:
   self.assertIn(x,MOD)
 def test_trusted_device_connection_and_grant_binding(self):
  for x in ["'requestId','grantId','accountId','deviceId','agentId','connectionId'",
    "CHANNEL_BINDING_MISMATCH","CHANNEL_ISSUER_PIN_MISMATCH"]:
   self.assertIn(x,MOD)
 def test_no_production_import_or_authorized_native_effects(self):
  self.assertNotIn('synthetic-channel-approval-attestation',WALL+AGENT+REGISTRY)
  self.assertIn('physicalExecutionAuthorized:false',MOD)
  self.assertIn('productionIssuerAuthorized:false',MOD)
  for x in ['executeCommand(','LIGHT_SCP','NATIVE_PROCESSES','requestLocalUpdate(']:
   self.assertNotIn(x,MOD)
 def test_negative_suite_includes_forgery_and_expiry(self):
  for x in ['attacker Channel signer','forged Channel success',
   'enrolled Channel key pin mismatch','expired owner approval',
   'old or consumed decision nonce','wrong owner signing key']:
   self.assertIn(x,T)

if __name__=='__main__':
 unittest.main(verbosity=2)
