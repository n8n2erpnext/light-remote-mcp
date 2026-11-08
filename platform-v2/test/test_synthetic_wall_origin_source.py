#!/usr/bin/env python3
"""Read-only source guards for rc50 fake Wall approval origin and PG issuance races."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
PORT=ROOT/'portability'
MOD=(PORT/'synthetic-wall-approval-origin.mjs').read_text()
TEST=(PORT/'test_synthetic_wall_approval_origin.mjs').read_text()
PG=(PORT/'verify_issuer_origin_pg_uat.py').read_text()
WALL=(ROOT.parent/'device-agent/local-wall.mjs').read_text()
AGENT=(ROOT.parent/'device-agent/operator-agent.mjs').read_text()
ROUTE=(ROOT.parent/'operator-host/executor-routes-device-channel.mjs').read_text()
GRANT=(ROOT.parent/'operator-host/device-access-grant-registry.mjs').read_text()

class WallOriginGuard(unittest.TestCase):
 def test_synthetic_component_not_loaded_by_production_wall_or_agent(self):
  self.assertNotIn('synthetic-wall-approval-origin.mjs',WALL)
  self.assertNotIn('synthetic-wall-approval-origin.mjs',AGENT)
  self.assertIn('SOURCE-ONLY synthetic',MOD)
  self.assertIn('productionIssuerAuthorized:false',MOD)
 def test_exact_real_wall_route_still_has_auth_csrf_and_resolution(self):
  for token in ["'/api/approve'","mutationAllowed(req)",
                "resolveCode(data.code)","accessApprove(found.requestId)"]:
   self.assertIn(token,WALL)
  self.assertIn("channelRequest(state,hub,'access-approve',{requestId:id})",AGENT)
 def test_approval_operator_evidence_source_census(self):
  self.assertIn("verifiedChannelContext(body,'access-approve')",ROUTE)
  self.assertIn('accessGrants.approve(ctx.payload.requestId',ROUTE)
  self.assertIn("type:'device_access_approved'",GRANT)
  self.assertIn('requestId:row.requestId,grantId:grant.grantId',GRANT)
 def test_signed_domain_separated_and_exact_shape(self):
  for token in ['LIGHT_REMOTE_RC50_FAKE_WALL_APPROVAL_ORIGIN_V1',
                "crypto.sign(null,canonical(record),privateKey)",
                "crypto.verify(null,canonical(p),pinnedWallPublicKey",
                "const FIELDS=['kind','requestId','grantId'",
                'ownerSessionSha256','wallDecisionNonceSha256',
                'channelAckSha256','deviceKeySha256']:
   self.assertIn(token,MOD)
 def test_trusted_binding_and_request_window(self):
  for token in ['p.accountId!==p.ownerAccountId','>600000','+86400000',
                'expected.ownerSessionActive!==true',
                'expected.deviceEnrollmentActive!==true',
                'expected.connectionActive!==true',
                'expected.originNonceUnused!==true',
                "p[k]!==expected[k]"]:
   self.assertIn(token,MOD)
 def test_cannot_authorize_real_native_action(self):
  self.assertIn('physicalExecutionAuthorized:false',MOD)
  for token in ['executeCommand(','NATIVE_PROCESSES','NATIVE_TERMINALS',
                'requestLocalUpdate(','fs.writeFile','child_process']:
   self.assertNotIn(token,MOD)
 def test_two_concurrent_pg_clients_must_serialize_generation(self):
  for token in ['ThreadPoolExecutor(max_workers=2)',
                'concurrent_generation_collision','concurrent_floor_nonmonotonic',
                'PASS 11 competing issuer connections',
                'PASS 12 concurrency preserves four pending outbox rows']:
   self.assertIn(token,PG)
 def test_negative_origin_cases_covered(self):
  for token in ['fake arbitrary Wall key','wrong connection',
                'expired fake grant','already consumed nonce','missing trusted local/DB']:
   self.assertIn(token,TEST)

if __name__=='__main__':
 unittest.main(verbosity=2)
