#!/usr/bin/env python3
"""Source review guards for the rc50 scratch-only PG issuer and fail-stop journal."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
P=ROOT/'portability'
WORKER=(P/'synthetic-agent-receipt-authority-worker.mjs').read_text()
FAULT=(P/'test_synthetic_bound_persist_faults.mjs').read_text()
SQL=(P/'issuer_origin_uat.sql').read_text()
RUN=(P/'verify_issuer_origin_pg_uat.py').read_text()
REAL=(ROOT.parent/'device-agent/operator-agent.mjs').read_text()

class IssuerFaultSourceGuard(unittest.TestCase):
    def test_unwired_scratch_only_no_prod_agent_import(self):
        self.assertNotIn('test_synthetic_bound_persist_faults.mjs',REAL)
        self.assertNotIn('issuer_origin_uat.sql',REAL)
        self.assertNotIn('synthetic-agent-receipt-authority-worker.mjs',REAL)
        self.assertIn('ISOLATED PG UAT ONLY',SQL)
        self.assertIn('--confirm-synthetic-only',RUN)
    def test_fault_injector_only_on_bound_start_and_private_fixture(self):
        self.assertIn("request.operation==='bound_start'",WORKER)
        self.assertIn('LR_RC50_SYNTHETIC_FAULT_STAGE',WORKER)
        self.assertIn('requireSafeFixture()',WORKER)
        self.assertIn('process.kill(process.pid,\'SIGKILL\')',WORKER)
        self.assertNotIn("request.testCrashAt",WORKER)
    def test_injected_at_four_actual_persistence_boundaries(self):
        for marker in [
           "uatCrashAt('after_write',requestedFault)",
           "uatCrashAt('after_file_fsync',requestedFault)",
           "uatCrashAt('after_rename',requestedFault)",
           "uatCrashAt('after_dir_fsync',requestedFault)",
           "fs.fsyncSync(fd)","fs.renameSync(tmp,file)","fs.fsyncSync(d)"
        ]:self.assertIn(marker,WORKER)
    def test_stale_temp_blocks_unreviewed_replay_after_process_crash(self):
        self.assertIn('refuseUnreconciledTempResidue()',WORKER)
        self.assertIn('ambiguous_persist_residue_requires_owner_reconcile',WORKER)
        self.assertIn("assert.equal(f.read().receipts.uat_cmd_fault_test.status,'uncertain')",FAULT)
    def test_no_native_execution_from_fault_harness(self):
        for term in ['executeCommand(','NATIVE_TERMINALS','executeNativeFs(','Paddle','LIGHT_SCP']:
            self.assertNotIn(term,WORKER)
        self.assertIn("payload:{kind:'fake_noop'",FAULT)
    def test_issuer_binds_existing_auth_tables_and_device_public_key(self):
        for term in ['lr_ab_requests req','lr_sessions sess','lr_devices dev',
                     'lr_device_connections con','lr_uat_device_enrolled_key enrolled',
                     "r.device_owner","r.evidence_owner<>r.device_owner",
                     "r.session_actor<>r.device_owner","r.connected_device<>r.device_id"]:
            self.assertIn(term,SQL)
    def test_single_pg_transaction_grant_provenance_and_signing_outbox(self):
        for term in ['BEGIN;','FOR UPDATE OF req,ev,sess,dev,con,enrolled',
                     'SET generation=generation+1,grant_revision=grant_revision+1',
                     'INSERT INTO lr_ab_grants','INSERT INTO lr_uat_grant_provenance',
                     'INSERT INTO lr_uat_lease_signing_outbox',
                     "VALUES(p_request_id,p_grant_id,'pending')",
                     "UPDATE lr_ab_requests SET consumed_at=local_now"]:
            self.assertIn(term,SQL)
    def test_signer_not_implemented_in_sql(self):
        self.assertIn('signing-outbox row',SQL)
        self.assertIn("ORIGIN_COMMITTED_SIGNING_PENDING",SQL)
        self.assertNotIn("CREATE ROLE",SQL)
        self.assertNotIn("CREATE USER",SQL)
        self.assertNotIn("SECURITY DEFINER",SQL)
    def test_pg_runner_uses_random_private_compose_and_cleanup(self):
        for term in ["u.BASE+'-src'","u.prepare_configs","u.check_isolation(cid)",
                     "u.migrations(cid)","u.compose(project,env,'down','--volumes','--remove-orphans'",
                     "dir=Path.home()","RC50_ISSUER_ORIGIN_ISOLATED_PROJECT_CLEANED"]:
            self.assertIn(term,RUN)
    def test_replay_fences_and_failed_tx_rollback_are_e2e_asserted(self):
        for term in ['PASS 02 pending owner','PASS 07 replayed request',
                     'PASS 08 already-used grant ID','PASS 09 new approved request',
                     'PASS 10 issued provenance remains pending']:
            self.assertIn(term,RUN)

if __name__=='__main__':
    unittest.main(verbosity=2)
