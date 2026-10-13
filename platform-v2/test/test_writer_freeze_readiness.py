#!/usr/bin/env python3
"""Negative tests for the read-only rc50 source writer gap inventory."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[1]/'portability/audit_writer_freeze_readiness.py'
spec=importlib.util.spec_from_file_location('writer_audit',SCRIPT)
audit_mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_mod)

class WriterGapTests(unittest.TestCase):
    def setUp(self):
        self.original=json.loads(audit_mod.MANIFEST.read_text(encoding='utf8'))
    def expect_reject(self,modify,reason):
        data=json.loads(json.dumps(self.original))
        modify(data)
        with tempfile.TemporaryDirectory(prefix='lr_writer_gap_source_only_') as td:
            fixture=Path(td)/'manifest.json'
            fixture.write_text(json.dumps(data),encoding='utf8')
            with patch.object(audit_mod,'MANIFEST',fixture):
                with self.assertRaisesRegex(audit_mod.WriterAuditError,reason):
                    audit_mod.audit()
    def test_real_source_gaps_must_report_not_ready(self):
        result=audit_mod.audit()
        self.assertEqual(result['status'],'NOT_READY')
        self.assertEqual(result['operator_writers'],14)
        self.assertEqual(result['plugin_writers'],4)
        self.assertEqual(result['fsync_proven'],5)
        self.assertEqual(result['fsync_not_proven'],13)
        self.assertFalse(result['single_writer_authority_proven'])
    def test_removed_critical_writer_fails(self):
        self.expect_reject(lambda x:x['operator_writers'].pop(),'operator_writer_inventory_drift')
    def test_duplicate_writer_fails(self):
        self.expect_reject(lambda x:x['operator_writers'].__setitem__(1,x['operator_writers'][0]),'operator_writer_inventory_drift')
    def test_claim_fsync_without_evidence_fails(self):
        self.expect_reject(lambda x:x['operator_writers'][5].update(fsync_proven=True),'unsupported_fence_or_durability_claim')
    def test_remove_atomic_writer_proof_fails(self):
        self.expect_reject(lambda x:x['operator_writers'][0].update(source_fence_proven=True),'durable_writer_overclaims_global_fence')
    def test_claim_shared_generation_without_evidence_fails(self):
        self.expect_reject(lambda x:x['plugin_writers'][1].update(consistent_generation_proven=True),'unsupported_fence_or_durability_claim')
    def test_remove_background_outbox_pump_fails(self):
        self.expect_reject(lambda x:x['dependencies'].pop(1),'dependency_risk_inventory_drift')
    def test_claim_async_append_durable_fails(self):
        self.expect_reject(lambda x:x['dependencies'][0].update(barrier_proven=True),'dependency_risk_source_drift')
    def test_live_ready_status_fails(self):
        self.expect_reject(lambda x:x.update(status='RESTORE_READY'),'readiness_claim_not_allowed')
    def test_missing_registry_source_marker_fails(self):
        self.expect_reject(lambda x:x['operator_writers'][0].update(write_marker='fs.appendFileSync('),'write_path_marker_missing')
    def test_drop_remediation_fails(self):
        self.expect_reject(lambda x:x.update(required_remediations=[]),'missing_gap_register')

if __name__=='__main__':
    unittest.main(verbosity=2)
