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
        self.assertEqual(summary['plugin_persistent_writers'],4)
        self.assertEqual(summary['plugin_test_only_writers'],1)
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
    def test_plugin_writer_unlisted_fails_closed(self):
        obj=json.loads(json.dumps(self.original))
        obj['plugin_persistent_writers'].pop()
        with patch.object(inventory,'MANIFEST',self.fake_contract(obj)):
            with self.assertRaisesRegex(inventory.ContractError,'plugin_writer_inventory_drift'):
                inventory.audit()
    def test_plugin_writer_missing_source_marker_fails_closed(self):
        obj=json.loads(json.dumps(self.original))
        obj['plugin_persistent_writers'][0]['markers'][0]='does-not-exist-uat-writer-call'
        with patch.object(inventory,'MANIFEST',self.fake_contract(obj)):
            with self.assertRaisesRegex(inventory.ContractError,'plugin_writer_marker_missing'):
                inventory.audit()
    def test_plugin_writer_unbound_contract_fails_closed(self):
        obj=json.loads(json.dumps(self.original))
        obj['plugin_persistent_writers'][0]['state_contract_id']='PLUGIN_FAKE_NEW_STATE'
        with patch.object(inventory,'MANIFEST',self.fake_contract(obj)):
            with self.assertRaisesRegex(inventory.ContractError,'unbound_plugin_writer'):
                inventory.audit()
    def test_transient_fleet_marker_missing_fails_closed(self):
        obj=json.loads(json.dumps(self.original))
        row=next(x for x in obj['transient_state'] if x['id']=='FLEET_IN_MEMORY_DISPATCH')
        row['markers'][0]='missing-uat-fleet-marker'
        with patch.object(inventory,'MANIFEST',self.fake_contract(obj)):
            with self.assertRaisesRegex(inventory.ContractError,'missing_transient_state_marker'):
                inventory.audit()
    def test_missing_revocation_guard_fails_closed(self):
        obj=json.loads(json.dumps(self.original))
        obj['operator_files'][0]['restore_policy']='just_copy_json'
        with patch.object(inventory,'MANIFEST',self.fake_contract(obj)):
            with self.assertRaisesRegex(inventory.ContractError,'missing_restore_identity_guard'):
                inventory.audit()

if __name__=='__main__':
    unittest.main(verbosity=2)
