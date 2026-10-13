#!/usr/bin/env python3
"""Read-only source-contract tests for fake A/B -> grant -> lease chain.
Never reads auth DB, production identity or device state.
"""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
MODULE=(ROOT/'portability/synthetic-ab-grant-lease.mjs').read_text()
TEST=(ROOT/'portability/test_synthetic_ab_grant_lease.mjs').read_text()
SQL3=(ROOT/'sql/003_auth_device_communications.sql').read_text()
SQL4=(ROOT/'sql/004_tenant_binding_guards.sql').read_text()
REAL=(ROOT.parent/'device-agent/operator-agent.mjs').read_text()

class SyntheticAbSourceContract(unittest.TestCase):
    def test_not_imported_into_real_agent(self):
        self.assertNotIn('synthetic-ab-grant-lease.mjs',REAL)
        self.assertIn('OFFLINE UAT ONLY',MODULE)
        self.assertIn('physicalExecutionAuthorized:false',MODULE)
    def test_two_separate_domain_signed_packets(self):
        for marker in ["approval:['kind'","lease:['kind'","revocation:['kind'",
                       "crypto.sign(null,encoded(type,payload),privateKey)",
                       "crypto.verify(null,encoded(type,packet.payload),publicKey,"]:
            self.assertIn(marker,MODULE)
        self.assertIn("wallPin:fakePublicKeyFingerprint(wallPublicKey)",MODULE)
        self.assertIn("issuerPin:fakePublicKeyFingerprint(issuerPublicKey)",MODULE)
    def test_links_request_grant_connection_and_device_key(self):
        for marker in ['requestId','grantId','connectionId','deviceKeySha256',
                       'ownerAccountId','accountId','agentId','approvalDigest',
                       "l.approvalDigest!==approvalHash"]:
            self.assertIn(marker,MODULE)
        self.assertIn("a[k]!==l[k]",MODULE)
    def test_bounded_pair_grant_and_short_lease(self):
        self.assertIn('>600000',MODULE)
        self.assertIn('>86400000',MODULE)
        self.assertIn('>30000',MODULE)
        self.assertIn("p.purpose!=='device'",MODULE)
    def test_signed_revocation_and_clock_floor_fail_closed(self):
        for marker in ['REVOCATION_SIGNATURE_INVALID','revokedGrantIds',
                       'STALE_REVOCATION_FLOOR','CLOCK_ROLLBACK_FAIL_CLOSED',
                       'GENERATION_REUSE_WITH_DIFFERENT_GRANT','revocationRevision']:
            self.assertIn(marker,MODULE)
        self.assertIn('timeSource=()=>Date.now()',MODULE)
        self.assertNotIn('request.nowMs',MODULE.split('export function evaluateFakeAbGrantLease')[1])
    def test_mutations_are_only_proposals(self):
        self.assertIn("decision:'PROPOSE_DURABLE_STATE'",MODULE)
        self.assertIn('requiresFsync:true',MODULE)
        for forbidden in ['child_process','execSync(','spawnSync(','executeNativeFs(',
                          'NATIVE_TERMINALS','NATIVE_PROCESSES','LIGHT_SCP',
                          'fs.writeFile','fs.rename']:
            self.assertNotIn(forbidden,MODULE)
    def test_schema_provenance_and_no_prod_db_change(self):
        for marker in ['lr_ab_requests','lr_ab_grants','lr_agent_bindings']:
            self.assertIn(marker,SQL3)
        self.assertIn('lr_binding_same_actor_and_device_as_grant',SQL4)
        self.assertIn("purpose IN ('device','team-member')",SQL3)
    def test_test_suite_covers_offline_replay_and_rebinding(self):
        for marker in [
          'expired offline lease','local clock rollback','old signed lease permanently',
          'signed new A/B approval','same generation cannot silently replace',
          'actor cannot borrow','counterfeit revoke']:
            self.assertIn(marker,TEST)

if __name__=='__main__':
    unittest.main(verbosity=2)
