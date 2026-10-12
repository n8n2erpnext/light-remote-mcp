#!/usr/bin/env python3
"""Offline source constraints for separate rc50 synthetic PG writer authority.

This test does not contact Docker or DB. Concurrent DB test is separate.
"""
import json
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
SQL=ROOT/'portability/uat_writer_epoch.sql'
CASE=ROOT/'portability/test_writer_epoch_uat.sql'
LOCK=ROOT/'sql/migrations.lock.json'

class PgWriterEpochSourceGuard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql=SQL.read_text(encoding='utf8')
        cls.case=CASE.read_text(encoding='utf8')
    def test_explicit_private_synthetic_schema(self):
        self.assertIn('CREATE SCHEMA IF NOT EXISTS lr_rc50_epoch_synthetic',self.sql)
        self.assertIn('CREATE TABLE IF NOT EXISTS lr_rc50_epoch_synthetic.writer_authority',self.sql)
        self.assertNotIn('CREATE TABLE IF NOT EXISTS public.',self.sql)
        self.assertNotRegex(self.sql,re.compile(r'\b(?:ALTER ROLE|GRANT|CREATE ROLE|DROP DATABASE|DROP SCHEMA)\b',re.I))
    def test_transactional_writer_guards_and_source_scope(self):
        for method in ('start_writer_uat','assert_writer_uat','renew_writer_uat','fence_writer_uat'):
            self.assertIn('FUNCTION lr_rc50_epoch_synthetic.'+method+'(',self.sql)
        self.assertEqual(self.sql.count('SECURITY INVOKER'),4+1) # one mention in header and four definitions
        self.assertIn('WHERE id=1 FOR SHARE;',self.sql)
        self.assertGreaterEqual(self.sql.count('WHERE id=1 FOR UPDATE;'),3)
        self.assertIn("v.state<>'fenced'",self.sql)
        self.assertIn("v.lease_until>clock_timestamp()",self.sql)
    def test_fail_closed_epoch_transition_and_expiry(self):
        self.assertIn("v.generation<>p_expected",self.sql)
        self.assertIn("v.generation<>p_generation",self.sql)
        self.assertIn("lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds)",self.sql)
        self.assertIn("v.lease_until<=clock_timestamp()",self.sql)
        self.assertIn("state='fenced',holder=NULL",self.sql)
    def test_transactional_fixture_always_rolls_back(self):
        self.assertIn('BEGIN;',self.case)
        self.assertTrue(self.case.rstrip().endswith('ROLLBACK;'))
        for marker in ('split_brain_acquire_allowed','expired_lease_fail_open',
                       'fenced_old_writer_accepted','one_active_writer_turnover_failed'):
            self.assertIn(marker,self.case)
    def test_locked_historical_migrations_not_changed_by_new_uat(self):
        data=json.loads(LOCK.read_text(encoding='utf8'))
        entries=data['migrations']
        self.assertEqual([x['version'] for x in entries],list(range(1,14)))
        self.assertEqual(len(entries),13)
        self.assertNotIn('lr_schema_migrations',self.sql)
    def test_no_automatic_expired_lease_takeover(self):
        start=self.sql.split('CREATE OR REPLACE FUNCTION lr_rc50_epoch_synthetic.start_writer_uat',1)[1].split('END $$;',1)[0]
        self.assertIn("v.state<>'fenced'",start)
        self.assertNotIn('lease_until<=clock_timestamp()',start)

if __name__=='__main__':
    unittest.main(verbosity=2)
