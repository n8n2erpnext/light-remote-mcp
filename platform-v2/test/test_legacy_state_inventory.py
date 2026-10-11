#!/usr/bin/env python3
"""Unit tests for source-only inventory, never reading live state."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[1]/'portability/audit_legacy_state_contract.py'
spec=importlib.util.spec_from_file_location('lr_state_inventory',SCRIPT)
inventory=importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)

class StateInventoryTests(unittest.TestCase):
    def setUp(self):
        self.original=json.loads(inventory.MANIFEST.read_text())
    def fake_contract(self,obj):
        directory=tempfile.TemporaryDirectory(prefix='lr_state_contract_unit_')
        path=Path(directory.name)/'test_contract.json'
        path.write_text(json.dumps(obj))
        self.addCleanup(directory.cleanup)
        return path
    def test_source_inventory_exact_match(self):
        summary=inventory.audit()
        self.assertGreaterEqual(summary['operator_state_files'],14)
        self.assertGreaterEqual(summary['external_state_contracts'],13)
        self.assertGreaterEqual(summary['restore_invariants'],15)
    def test_new_registry_not_in_manifest_fails_closed(self):
        obj=json.loads(json.dumps(self.original))
        obj['operator_files'].pop()
        with patch.object(inventory,'MANIFEST',self.fake_contract(obj)):
            with self.assertRaisesRegex(inventory.ContractError,'operator_durable_file_inventory_drift'):
                inventory.audit()
    def test_unknown_external_path_source_marker_fails(self):
        obj=json.loads(json.dumps(self.original))
        obj['outside_operator_state'][0]['source_marker']='does-not-exist-uat-marker'
        with patch.object(inventory,'MANIFEST',self.fake_contract(obj)):
            with self.assertRaisesRegex(inventory.ContractError,'external_state_source_marker_missing'):
                inventory.audit()
    def test_missing_revocation_guard_fails_closed(self):
        obj=json.loads(json.dumps(self.original))
        obj['operator_files'][0]['restore_policy']='just_copy_json'
        with patch.object(inventory,'MANIFEST',self.fake_contract(obj)):
            with self.assertRaisesRegex(inventory.ContractError,'missing_restore_identity_guard'):
                inventory.audit()

if __name__=='__main__':
    unittest.main(verbosity=2)
