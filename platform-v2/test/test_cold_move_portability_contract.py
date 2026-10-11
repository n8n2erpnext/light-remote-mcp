#!/usr/bin/env python3
"""Read-only source-contract checks for rc50 cold-move UAT.
No Docker operations, network access, production secrets or data.
"""
import ast
import hashlib
import json
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
COMPOSE=(ROOT/'portability/compose.uat.yml').read_text()
SCRIPT=(ROOT/'portability/rehearse_cold_move_uat.py').read_text()
MANIFEST=json.loads((ROOT/'sql/migrations.lock.json').read_text())

class PortabilitySourceContract(unittest.TestCase):
    def test_immutable_sql_manifest_is_complete(self):
        self.assertEqual(MANIFEST['target'],'synthetic UAT only')
        self.assertEqual([r['version'] for r in MANIFEST['migrations']],
          list(range(1,len(MANIFEST['migrations'])+1)))
        for row in MANIFEST['migrations']:
            script=ROOT/'sql'/row['file']
            self.assertTrue(script.is_file())
            self.assertEqual(hashlib.sha256(script.read_bytes()).hexdigest(),row['sha256'])

    def test_compose_stacks_have_no_static_name_or_public_ports(self):
        self.assertNotRegex(COMPOSE,r'(?m)^name\s*:')
        self.assertNotRegex(COMPOSE,r'(?m)^\s*ports\s*:')
        self.assertNotRegex(COMPOSE,r'(?m)^\s*network_mode\s*:')
        self.assertNotRegex(COMPOSE,r'(?m)^\s*privileged\s*:')
        self.assertNotRegex(COMPOSE,r'(?m)^\s*external\s*:')
        self.assertRegex(COMPOSE,r'(?m)^\s*internal:\s*true\s*$')
        self.assertIn('pgdata:',COMPOSE)
        self.assertIn('redisdata:',COMPOSE)
        self.assertIn('LR_PORTABLE_PG_ENV',COMPOSE)
        self.assertIn('LR_PORTABLE_REDIS_CONF',COMPOSE)
        self.assertIn('postgres:17-alpine',COMPOSE)
        self.assertIn('redis:8-alpine',COMPOSE)

    def test_script_is_syntactically_valid_and_only_synthetic_projects(self):
        ast.parse(SCRIPT)
        self.assertIn('lr-uat-move-',SCRIPT)
        self.assertIn("refusing_non_synthetic_compose_project",SCRIPT)
        self.assertIn('secrets.token_hex(5)',SCRIPT)
        self.assertIn('explicit_synthetic_rehearsal_confirmation_required',SCRIPT)
        self.assertIn("['--confirm-synthetic-only']",SCRIPT)
        self.assertIn("'down','--volumes','--remove-orphans'",SCRIPT)
        self.assertIn('projects.append((src,env_src))',SCRIPT)
        self.assertIn('projects.append((dst,env_dst))',SCRIPT)
        self.assertIn('POSTGRES_PASSWORD=',SCRIPT)
        self.assertIn('secrets.token_urlsafe',SCRIPT)
        self.assertNotIn('platform-v2/secrets/postgres.env',SCRIPT)
        self.assertNotIn('lightremote-rc50-v2-postgres-1',SCRIPT)
        self.assertNotIn('https://light-remote.thaiduy.digital',SCRIPT)
        self.assertNotIn('FLUSHALL',SCRIPT)
        self.assertNotIn('FLUSHDB',SCRIPT)

    def test_identity_replay_and_rollback_gates_present(self):
        for token in ['lr_accounts','lr_sessions','lr_devices',
                      'lr_device_connections','lr_ab_grants','lr_agent_clients',
                      'lr_agent_bindings','lr_jobs','lr_usage_events',
                      'lr_free_family_monthly','lr_usage_monthly',
                      'lr_oauth_one_time','lr_schema_migrations',
                      'PGDMP','redis-synthetic-dump.rdb',
                      'cross_compose_db_identity_drift',
                      'cross_compose_redis_state_lost',
                      'restored_usage_replay_double_charge',
                      'restored_refresh_replay_accepted',
                      'RC50_COLD_MOVE_SYNTHETIC_STACKS_CLEANED']:
            self.assertIn(token,SCRIPT)

if __name__=='__main__':
    unittest.main(verbosity=2)
