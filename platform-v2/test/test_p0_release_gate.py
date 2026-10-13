#!/usr/bin/env python3
"""Release acceptance is distinct from the platform regression build."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
SCRIPT=ROOT/'platform-v2/scripts/p0-release-gate.py'
WORKFLOW=ROOT/'.github/workflows/rc50-mjs-scale.yml'

def run(*args):
    return subprocess.run([sys.executable,'-B',str(SCRIPT),*args],
        cwd=ROOT,capture_output=True,text=True,timeout=10)

class Rc50GateTests(unittest.TestCase):
    def test_development_report_is_honest_not_ready(self):
        r=run('--report')
        self.assertEqual(r.returncode,0,r.stderr)
        v=json.loads(r.stdout)
        self.assertEqual(v['status'],'NOT_READY')
        self.assertEqual(v['gate_count'],5)
        self.assertEqual(v['ready_count'],0)
        self.assertEqual(set(v['gates']),{
            'P0-A_WRITER','P0-B_IDENTITY','P0-C_DURABILITY',
            'P0-D_PORTABILITY','P0-E_RELEASE'})
    def test_explicit_release_request_must_fail_closed(self):
        r=run('--require-ready')
        self.assertEqual(r.returncode,3,r.stderr)
        v=json.loads(r.stdout)
        self.assertTrue(v['explicit_release_guard'])
        self.assertTrue(all(not g['ready'] for g in v['gates'].values()))
    def test_release_cannot_extrapolate_fsync_into_writer_authority(self):
        v=json.loads(run('--report').stdout)
        self.assertEqual(v['gates']['P0-C_DURABILITY']['file_sync_proven'],16)
        self.assertEqual(v['gates']['P0-C_DURABILITY']['file_sync_not_proven'],2)
        self.assertFalse(v['gates']['P0-A_WRITER']['writer_single_authority_proven'])
        self.assertFalse(v['gates']['P0-C_DURABILITY']['multi_file_checkpoint_proven'])
    def test_workflow_runs_when_actual_product_code_changes(self):
        txt=WORKFLOW.read_text()
        for marker in ['operator-host/**','plugin-server/**','lib/**',
                       'package.json','package-lock.json','platform-v2/**']:
            self.assertIn(marker,txt)
        self.assertIn('node --test platform-v2/test/*.test.mjs',txt)
        self.assertIn('test_writer_freeze_readiness.py',txt)
    def test_workflow_reports_without_failing_development(self):
        txt=WORKFLOW.read_text()
        self.assertIn('p0-release-gate.py --report',txt)
        self.assertIn("github.event_name == 'workflow_dispatch' && inputs.require_ready",txt)
        self.assertIn('p0-release-gate.py --require-ready',txt)
        self.assertIn('if: always()',txt)
        self.assertIn('docker compose -p lightremote-rc50-v2',txt)
        self.assertIn('down -v --remove-orphans',txt)
    def test_native_multi_arch_ci_is_not_a_restore_claim(self):
        txt=WORKFLOW.read_text()
        self.assertIn('native-runtime-parity:',txt)
        self.assertIn('runner: ubuntu-24.04-arm',txt)
        self.assertIn('runner: ubuntu-24.04',txt)
        self.assertIn('expected_arch: arm64',txt)
        self.assertIn('expected_arch: x64',txt)
        self.assertIn("process.arch!==process.env.EXPECTED_ARCH",txt)
        self.assertIn('npm ci --ignore-scripts --no-audit --no-fund',txt)
        self.assertIn('NOT cross-host state restore',txt)
        self.assertIn('node --test platform-v2/test/*.test.mjs',txt)
        self.assertIn('ARM64-native PostgreSQL schema and rollback',txt)
        self.assertIn('docker compose -p lightremote-rc50-v2 -f compose.yml up -d --wait',txt)
        self.assertIn('docker compose -p lightremote-rc50-v2 -f compose.yml down -v --remove-orphans',txt)
        self.assertIn("if: always() && matrix.expected_arch == 'arm64'",txt)
    def test_reject_unknown_flags(self):
        self.assertNotEqual(run('--assume-ready').returncode,0)

if __name__=='__main__':
    unittest.main(verbosity=2)
