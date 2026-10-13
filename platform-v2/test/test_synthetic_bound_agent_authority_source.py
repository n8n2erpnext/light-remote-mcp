#!/usr/bin/env python3
"""Read-only source guards for isolated Linux bound fake Agent receipt authority."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
PORT=ROOT/'portability'
WORKER=(PORT/'synthetic-agent-receipt-authority-worker.mjs').read_text()
UAT=(PORT/'test_synthetic_bound_agent_authority.mjs').read_text()
AB=(PORT/'synthetic-ab-grant-lease.mjs').read_text()
RCPT=(PORT/'rc50_agent_receipt_decision.mjs').read_text()
REAL=(ROOT.parent/'device-agent/operator-agent.mjs').read_text()

class BoundAuthoritySourceTest(unittest.TestCase):
    def test_unwired_real_agent_and_fixture_scope(self):
        self.assertNotIn('synthetic-agent-receipt-authority-worker.mjs',REAL)
        self.assertNotIn('synthetic-ab-grant-lease.mjs',REAL)
        self.assertIn('lr-rc50-agent-authority-',WORKER)
        self.assertIn('physicalExecutionAuthorized:false',WORKER)
    def test_one_kernel_lock_for_all_state_transitions(self):
        for marker in ["'-x','-n','-E','77','-F',lock",
                       "fs.fstatSync(3)","inherited.ino !== lock.ino",
                       "competing independent OS process","fs.statSync(lock).ino,inode"]:
            self.assertIn(marker,WORKER+UAT)
    def test_fsync_and_atomic_combined_grant_receipt_snapshot(self):
        for marker in ["fs.fsyncSync(fd)","fs.renameSync(tmp,file)","fs.fsyncSync(d)",
                       "signedEpochDigest","grantState:decision.next",
                       "grantState:r.next,receipts"]:
            self.assertIn(marker,WORKER)
    def test_signed_three_pins_and_bootstrap_protection(self):
        for marker in ["request.operation==='initialize_bound'",
                       "bound_issuer_key_reuse_disallowed",
                       "fakePublicKeyFingerprint(wall)!==grant.wallPin",
                       "fakePublicKeyFingerprint(issuer)!==grant.issuerPin",
                       "syntheticKeyFingerprint(writer)!==current.signedVerifierSha"]:
            self.assertIn(marker,WORKER)
    def test_bound_all_execution_admission_before_fake_start(self):
        for marker in ["checkedBoundRequest(current,request)",
                       "evaluateFakeAbGrantLease(grant",
                       "operation:accepting?'accept':'check'",
                       "checkedSignedRequest(nextWithGrant",
                       "'signed_start':'signed_complete'",
                       "BOUND_WRITER_EPOCH_DOES_NOT_MATCH_LEASE"]:
            self.assertIn(marker,WORKER)
    def test_all_other_mutation_modes_denied_for_bound_root(self):
        for marker in ["bypass_bound_authority_disallowed",
                       "request.operation?.startsWith('bound_')",
                       "bound_authority_not_initialized"]:
            self.assertIn(marker,WORKER)
        self.assertIn("signed-only epoch request cannot bypass bound mode",UAT)
    def test_corruption_or_clock_rollback_fail_closed(self):
        for marker in ["validFakeDeviceGrantState(grant)",
                       "validSyntheticReceiptSnapshot(current)",
                       "BOUND_DURABLE_STATE_CORRUPT",
                       "CLOCK_ROLLBACK_FAIL_CLOSED",
                       "const now=Date.now()"]:
            self.assertIn(marker,WORKER+AB)
        self.assertNotIn("const now=request.nowMs",WORKER)
    def test_revocation_fences_pending_and_quarantines_started(self):
        for marker in ["request.operation==='bound_revoke'",
                       "operation:'revoke'",
                       "row.status==='accepted'?'fenced'",
                       "row.status==='started'?'uncertain'"]:
            self.assertIn(marker,WORKER)
        self.assertIn("after worker restart old valid lease still tombstoned",UAT)
    def test_sigkill_recovery_and_replay_negative_tests(self):
        for marker in ["crashAfterPersist","'bound_start'",
                       "CRASH_RECOVERY_REQUIRES_DURABLE_RECONCILIATION",
                       "COMMAND_NOT_SAFE_TO_START"]:
            self.assertIn(marker,WORKER+UAT)
        self.assertIn("competing independent OS process cannot write bound receipts",UAT)
    def test_no_real_os_command_dispatch_and_signers_ephemeral(self):
        for forbidden in ["executeCommand(","NATIVE_TERMINALS","NATIVE_PROCESSES",
                          "executeNativeFs(","requestLocalUpdate(","LIGHT_SCP",
                          "child_process"]:
            self.assertNotIn(forbidden,WORKER)
        self.assertIn("crypto.generateKeyPairSync('ed25519')",UAT)
        self.assertNotIn("privateKey.export(",UAT)
    def test_previous_fake_policy_interfaces_preserved(self):
        self.assertIn("export function validFakeDeviceGrantState",AB)
        self.assertIn("export function validSyntheticReceiptSnapshot",RCPT)
        self.assertIn("export function evaluateFakeAbGrantLease",AB)

if __name__=="__main__":
    unittest.main(verbosity=2)
