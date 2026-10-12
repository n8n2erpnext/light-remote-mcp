#!/usr/bin/env python3
"""Offline synthetic-only fence, drain and restore consistency negative tests."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1]/'portability/validate_backup_consistency.py'
spec = importlib.util.spec_from_file_location('lr_consistency',SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
digest=lambda label:hashlib.sha256(('FAKE_ONLY_'+label).encode()).hexdigest()

def synthetic_evidence():
    freeze='lr_rc50_fake_snapshot_alpha_001'
    return {
      'schema_version':1,'mode':'synthetic-only','freeze_id':freeze,
      'source_generation':50,'target_generation':51,
      'fence':{
        'source_writer_fenced':True,'destination_writer_disabled':True,
        'new_writes_fenced':True,'webhooks_journaled':True,
        'active_jobs_drained':True,'pending_async_writes_flushed':True,
        'inflight_jobs':0,'live_ptys':0,'unacknowledged_commands':0,
        'destination_writes_count':0
      },
      'planes':{
        name:{'freeze_id':freeze,'generation':50,'captured_after_fence':True,
              'flush_ack':True,'synthetic_digest':digest(name)}
        for name in ('operator','plugin','postgres')
      },
      'redis':{'mode':'cold_rebuild_fail_closed','auth_rate_limit':'deny_until_ready',
               'replay_source':'durable_postgres_not_redis'},
      'oauth':{'process_maps_not_restored':True,
               'pending_google_pkce_expires':True,'consumed_hash_durable':True},
      'comparisons':{
        name:{'source':digest(name),'restored':digest(name)}
        for name in gate.RECONCILE
      }
    }

class ConsistencyContractTests(unittest.TestCase):
    def setUp(self):
        self.record=synthetic_evidence()
    def reject(self,expected):
        with self.assertRaisesRegex(gate.ConsistencyError,expected):
            gate.evaluate_synthetic_evidence(self.record)
    def test_source_contract_markers(self):
        self.assertEqual(gate.contract_audit()['freeze_lanes'],6)
    def test_synthetic_happy_path_is_not_real_certificate(self):
        outcome=gate.evaluate_synthetic_evidence(self.record)
        self.assertEqual(outcome['reconciled_dimensions'],9)
        self.assertFalse(outcome['real_backup_proven'])
        self.assertFalse(outcome['production_cutover_authorized'])
    def test_synthetic_only_guard(self):
        self.record['mode']='production'
        self.reject('not_synthetic_evidence')
    def test_split_brain_fails(self):
        self.record['fence']['source_writer_fenced']=False
        self.reject('fence_missing')
    def test_target_writer_before_reconcile_fails(self):
        self.record['fence']['destination_writes_count']=1
        self.reject('premature_destination_writer')
    def test_active_pty_fails(self):
        self.record['fence']['live_ptys']=1
        self.reject('active_work_remaining')
    def test_webhook_not_journaled_fails(self):
        self.record['fence']['webhooks_journaled']=False
        self.reject('fence_missing')
    def test_generation_replay_fails(self):
        self.record['target_generation']=50
        self.reject('writer_generation_not_monotonic')
    def test_missing_plugin_plane_fails(self):
        del self.record['planes']['plugin']
        self.reject('missing_durable_plane_attestation')
    def test_cross_plane_freeze_mismatch_fails(self):
        self.record['planes']['postgres']['freeze_id']='lr_rc50_fake_other_snapshot_000'
        self.reject('snapshot_fence_mismatch')
    def test_unflushed_plugin_snapshot_fails(self):
        self.record['planes']['plugin']['flush_ack']=False
        self.reject('unflushed_snapshot')
    def test_revoked_grant_digest_mismatch_fails(self):
        self.record['comparisons']['grant_revocation']['restored']=digest('active-grants-only')
        self.reject('reconciliation_mismatch:grant_revocation')
    def test_meter_double_charge_digest_mismatch_fails(self):
        self.record['comparisons']['usage_events']['restored']=digest('charged-twice')
        self.reject('reconciliation_mismatch:usage_events')
    def test_oauth_replay_map_restore_fails(self):
        self.record['oauth']['consumed_hash_durable']=False
        self.reject('oauth_replay_reset')
    def test_redis_auth_fail_open_fails(self):
        self.record['redis']['auth_rate_limit']='allow_while_empty'
        self.reject('redis_fail_open')
    def test_missing_billing_outbox_fails(self):
        del self.record['comparisons']['billing_outbox']
        self.reject('missing_reconciliation')

if __name__=='__main__':
    unittest.main(verbosity=2)
