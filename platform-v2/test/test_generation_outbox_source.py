#!/usr/bin/env python3
"""Offline rc50 synthetic outbox source/boundary regression (no DB connection)."""
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
PORT=ROOT/'portability'
SQL=(PORT/'uat_generation_outbox.sql').read_text()
FIX=(PORT/'test_generation_outbox_uat.sql').read_text()
EPOCH=(PORT/'uat_writer_epoch.sql').read_text()
MATRIX=json.loads((PORT/'ingress-fence-integration-boundaries.json').read_text())

class GenerationOutboxSource(unittest.TestCase):
 def test_isolated_schema_no_historical_migration_or_role_changes(self):
  self.assertIn('CREATE TABLE IF NOT EXISTS lr_rc50_epoch_synthetic.command_outbox',SQL)
  for disallowed in ('ALTER ROLE','CREATE ROLE','GRANT ','lr_schema_migrations',
                     'CREATE TABLE public.','DROP TABLE','DROP SCHEMA'):
   self.assertNotIn(disallowed,SQL)
  versions=json.loads((ROOT/'sql/migrations.lock.json').read_text())['migrations']
  self.assertEqual([row['version'] for row in versions],list(range(1,14)))
 def test_three_transactional_security_invoker_functions(self):
  self.assertEqual(SQL.count('LANGUAGE plpgsql SECURITY INVOKER'),3)
  for name in ('enqueue_command_uat','claim_command_uat','ack_command_uat'):
   self.assertIn('FUNCTION lr_rc50_epoch_synthetic.'+name+'(',SQL)
  self.assertEqual(SQL.count('assert_writer_uat(p_holder,p_generation)'),3)
  self.assertIn('WHERE c.source_generation=p_generation',SQL)
  self.assertIn('ON CONFLICT (command_id) DO NOTHING',SQL)
 def test_no_real_actions_supported_by_envelopes(self):
  self.assertIn("'fake_fleet','fake_webhook','fake_pty'",SQL)
  self.assertNotIn('EXECUTE ',SQL)
  self.assertNotIn('http://',SQL)
  self.assertNotIn('https://',SQL)
 def test_claim_and_ack_are_single_owner_and_generation(self):
  self.assertIn('FOR UPDATE SKIP LOCKED LIMIT 1',SQL)
  self.assertIn("c.source_holder=p_holder",SQL)
  self.assertIn('c.claimed_by=p_consumer AND c.claim_tag=p_claim_tag',SQL)
  self.assertIn('c.claimed_until>clock_timestamp()',SQL)
  self.assertNotIn('SET status=\'queued\' WHERE',SQL) # no unsafe auto-requeue
 def test_fixture_rolls_back(self):
  self.assertTrue(FIX.lstrip().startswith('-- rc50 isolated'))
  self.assertTrue(FIX.rstrip().endswith('ROLLBACK;'))
  for marker in ('stale_envelopes_not_quarantined','fenced_writer_enqueue_accepted',
                 'duplicate_ack_accepted','expired_claim_ack_accepted'):
   self.assertIn(marker,FIX)
 def test_boundary_manifest_is_not_a_certification(self):
  self.assertEqual(MATRIX['mode'],'SOURCE_ONLY_NOT_WIRED')
  self.assertEqual(MATRIX['status'],'GAPS_IDENTIFIED_NOT_READY')
  self.assertFalse('runtime_gate_passed' in MATRIX)
  self.assertGreaterEqual(len(MATRIX['required_guarantees']),7)
 def test_ten_source_boundaries_have_real_markers(self):
  boundaries=MATRIX['required_boundaries']
  self.assertEqual(len(boundaries),10)
  self.assertEqual(len({row['id'] for row in boundaries}),10)
  for row in boundaries:
   source=ROOT.parent/row['file']
   self.assertTrue(source.is_file() and not source.is_symlink(),row['id'])
   data=source.read_text()
   self.assertGreaterEqual(len(row['markers']),2)
   self.assertTrue(all(marker in data for marker in row['markers']),row['id'])
   self.assertTrue(bool(row.get('risk')) and bool(row.get('gate')),row['id'])
 def test_pg_lease_lock_is_shared_with_outbox(self):
  self.assertIn('WHERE id=1 FOR SHARE;',EPOCH)
  self.assertIn('WHERE id=1 FOR UPDATE;',EPOCH)
  self.assertIn('assert_writer_uat(p_holder,p_generation)',SQL)

if __name__=='__main__':
 unittest.main(verbosity=2)
