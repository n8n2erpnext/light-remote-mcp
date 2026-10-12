#!/usr/bin/env python3
"""Read-only consistency checks for the conservative rc50 route census."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
MODULE=ROOT/'portability/census_mutating_routes.py'
REPORT=ROOT/'portability/mutating-route-census.json'
spec=importlib.util.spec_from_file_location('rc50_census',MODULE)
census=importlib.util.module_from_spec(spec)
spec.loader.exec_module(census)

class RouteCensusSourceTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.report=json.loads(REPORT.read_text(encoding='utf8'))
 def test_report_remains_explicitly_heuristic(self):
  self.assertEqual(self.report['classification'],'SOURCE_HEURISTIC_REQUIRES_MANUAL_ROUTE_REVIEW')
  self.assertFalse(self.report['global_epoch_wired'])
  self.assertFalse(self.report['production_cutover_authorized'])
  self.assertIn('no runtime claim',self.report['disclaimer'].lower())
 def test_regeneration_has_identical_semantics(self):
  current=census.main()
  self.assertEqual(current,self.report)
 def test_relevant_source_files_and_hashes_present(self):
  rows=self.report['sources']
  self.assertGreaterEqual(len(rows),25)
  for rel,info in rows.items():
   filename=ROOT.parent/rel
   self.assertTrue(filename.is_file())
   self.assertEqual(hashlib.sha256(filename.read_bytes()).hexdigest(),info['sha256'])
 def test_candidate_sites_include_source_location_without_secrets(self):
  sites=self.report['candidate_mutating_route_sites']
  self.assertGreaterEqual(len(sites),80)
  required={'operator-host/executor-routes-account.mjs',
    'operator-host/executor-routes-device-channel.mjs',
    'operator-host/executor-routes-runtime.mjs',
    'plugin-server/oauth.mjs','plugin-server/paddle-billing.mjs',
    'plugin-server/support-backoffice.mjs'}
  self.assertTrue(required.issubset({x['source'] for x in sites}))
  for item in sites:
   self.assertIsInstance(item['line'],int)
   self.assertTrue(item['verbs'])
   self.assertEqual(item['resolution'],'source_candidate_manual_verify')
   self.assertTrue(item['requires_fence_review'])
   self.assertNotIn('source_line',item)
 def test_background_sites_are_not_misclassified_as_fenced(self):
  rows=self.report['candidate_async_dispatch_sites']
  self.assertGreaterEqual(len(rows),8)
  self.assertTrue(any(x['source']=='plugin-server/support-backoffice.mjs' for x in rows))
  self.assertTrue(all(x['resolution']=='source_candidate_manual_verify' for x in rows))
 def test_no_fixture_selftest_or_external_runtime_paths(self):
  self.assertFalse(any('selftest' in rel for rel in self.report['sources']))
  self.assertFalse(any(rel.startswith('/') or '..' in Path(rel).parts for rel in self.report['sources']))
 def test_count_fields_consistent(self):
  stats=self.report['stats']
  self.assertEqual(stats['source_files'],len(self.report['sources']))
  self.assertEqual(stats['candidate_mutation_sites'],len(self.report['candidate_mutating_route_sites']))
  self.assertEqual(stats['candidate_background_sites'],len(self.report['candidate_async_dispatch_sites']))

if __name__=='__main__':
 unittest.main(verbosity=2)
