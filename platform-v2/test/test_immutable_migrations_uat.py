#!/usr/bin/env python3
"""Pure local unit checks; NO connection to Docker or PostgreSQL."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

RUNNER=Path(__file__).resolve().parents[1]/'scripts/migrations_uat.py'
spec=importlib.util.spec_from_file_location('migrations_uat',RUNNER)
migration=importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

class MigrationGuardTests(unittest.TestCase):
    def test_lock_manifest_current_source_hashes(self):
        rows=migration.lock_entries()
        self.assertEqual(len(rows),12)
        self.assertEqual([r['version'] for r in rows],list(range(1,13)))

    def test_checksum_drift_is_detected_without_db_calls(self):
        with tempfile.TemporaryDirectory(prefix='uat-migration-unit-') as root:
            base=Path(root);(base/'sql').mkdir()
            name='001_synthetic.sql'
            (base/'sql'/name).write_text('SELECT 1;\n')
            manifest=base/'sql/migrations.lock.json'
            manifest.write_text(json.dumps({
                'target':'synthetic UAT only','format':1,
                'migrations':[{'version':1,'file':name,
                  'sha256':hashlib.sha256(b'SELECT 2;\n').hexdigest()}]
            }))
            with patch.object(migration,'ROOT',base),patch.object(migration,'MANIFEST',manifest):
                with self.assertRaisesRegex(RuntimeError,'migration_source_checksum_mismatch'):
                    migration.lock_entries()
                (base/'sql'/name).write_text('SELECT 2;\n')
                self.assertEqual(len(migration.lock_entries()),1)
                (base/'sql'/'002_unlisted.sql').write_text('SELECT 3;\n')
                with self.assertRaisesRegex(RuntimeError,'unlisted_migrations'):
                    migration.lock_entries()

    def test_applied_checksum_history_fails_closed(self):
        rows=[{'version':1,'file':'001_test.sql','sha256':'a'*64},
          {'version':2,'file':'002_test.sql','sha256':'b'*64}]
        with self.assertRaisesRegex(RuntimeError,'historical_migrations_require_explicit_attestation'):
            migration.verified(rows,[1],None)
        with self.assertRaisesRegex(RuntimeError,'migration_checksum_history_incomplete'):
            migration.verified(rows,[1,2],{1:'a'*64})
        with self.assertRaisesRegex(RuntimeError,'applied_migration_checksum_drift'):
            migration.verified(rows,[1,2],{1:'a'*64,2:'c'*64})
        with self.assertRaisesRegex(RuntimeError,'migration_history_has_gap'):
            migration.verified(rows,[2],{2:'b'*64})
        migration.verified(rows,[1,2],{1:'a'*64,2:'b'*64})

    def test_unsafe_database_is_refused_before_external_commands(self):
        with self.assertRaisesRegex(RuntimeError,'refusing_database_outside_rc50_uat'):
            migration.preflight('light_remote_production')
        with self.assertRaisesRegex(RuntimeError,'refusing_database_outside_rc50_uat'):
            migration.preflight('light_remote_rc50_restore_uat_fake_dst')
        with self.assertRaisesRegex(RuntimeError,'refusing_database_outside_rc50_uat'):
            migration.preflight('postgres')

if __name__=='__main__':
    unittest.main(verbosity=2)
