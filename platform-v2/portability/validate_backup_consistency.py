#!/usr/bin/env python3
"""rc50 source-only backup consistency contract and synthetic evidence verifier.

No Docker, shell, network, secret, production path, database or volume access.
An in-memory fake attestation is NOT evidence that production is recoverable.
"""
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / 'platform-v2/portability/backup-consistency-contract.json'
SHA = re.compile(r'^[a-f0-9]{64}$')
FREEZE = re.compile(r'^lr_rc50_fake_[a-z0-9_-]{8,80}$')
PHASES = ['identify', 'fence', 'drain', 'checkpoint', 'snapshot',
          'independent_restore', 'reconcile', 'activate_one_writer']
RECONCILE = {
    'account_identity', 'device_identity', 'signing_identity',
    'grant_revocation', 'usage_events', 'billing_outbox', 'oauth_consumed_hashes',
    'team_entitlements', 'support_outbox'
}

class ConsistencyError(ValueError):
    pass

def require(condition, reason):
    if not condition:
        raise ConsistencyError(reason)

def contract_audit():
    data = json.loads(CONTRACT.read_text(encoding='utf8'))
    require(data.get('schema_version') == 1 and
            data.get('status') == 'SYNTHETIC_EVIDENCE_ONLY_NOT_RUNTIME_CERTIFICATION',
            'invalid_consistency_scope')
    require(data.get('production_data_access_allowed') is False,
            'production_data_forbidden')
    require(data.get('ordered_phases') == PHASES, 'incorrect_fence_order')
    require(set(data.get('durable_planes', [])) == {'operator','plugin','postgres'},
            'missing_durable_plane')
    require(set(data.get('transient_planes', [])) == {'redis','oauth_process','fleet_process','native_pty'},
            'missing_transient_plane')
    lanes = data.get('required_freeze_lanes', [])
    require(len(lanes) == 6 and len({x['id'] for x in lanes}) == 6,
            'freeze_lane_inventory_drift')
    for lane in lanes:
        rel = lane['source']
        require(rel in {
            'operator-host/executor.mjs', 'plugin-server/oauth.mjs',
            'plugin-server/paddle-billing.mjs', 'plugin-server/support-backoffice.mjs',
            'operator-host/fleet-router.mjs', 'plugin-server/google-auth.mjs'
        }, 'invalid_lane_source')
        file = ROOT / rel
        require(file.is_file() and not file.is_symlink() and
                file.resolve().is_relative_to(ROOT.resolve()), 'missing_lane_source')
        require(lane['source_marker'] in file.read_text(encoding='utf8'),
                'freeze_lane_source_drift:' + lane['id'])
        require(isinstance(lane.get('enforce'),str) and len(lane['enforce']) >= 16,
                'missing_lane_policy:' + lane['id'])
    blocked = set(data.get('blocked_tasks_remain_blocked', []))
    require({
        'platform-v2/test/test_sealed_synthetic_backup.py',
        'platform-v2/portability/rehearse_cold_move_uat.py'
    }.issubset(blocked), 'previous_tool_block_not_preserved')
    require(set(data.get('negative_cases', [])) >= {
        'split_brain', 'active_pty', 'snapshot_fence_mismatch',
        'revoked_grant_resurrected', 'duplicate_meter_charge',
        'oauth_replay_reset', 'redis_fail_open', 'premature_target_activation'
    }, 'missing_failure_case')
    return {'freeze_lanes':len(lanes), 'durable_planes':3, 'transient_planes':4}

def evaluate_synthetic_evidence(value):
    """Validate declared FAKE evidence only; never assume attestation is genuine."""
    require(isinstance(value,dict), 'invalid_evidence_type')
    require(value.get('schema_version') == 1 and value.get('mode') == 'synthetic-only',
            'not_synthetic_evidence')
    freeze = value.get('freeze_id')
    require(isinstance(freeze,str) and FREEZE.fullmatch(freeze) is not None,
            'unsafe_freeze_id')
    generation = value.get('source_generation')
    target = value.get('target_generation')
    require(type(generation) is int and 0 < generation < 2**63 and
            type(target) is int and generation < target < 2**63,
            'writer_generation_not_monotonic')
    fence = value.get('fence')
    require(isinstance(fence,dict), 'missing_fence')
    for field in ('source_writer_fenced','destination_writer_disabled',
                  'new_writes_fenced','webhooks_journaled',
                  'active_jobs_drained','pending_async_writes_flushed'):
        require(fence.get(field) is True, 'fence_missing:' + field)
    for field in ('inflight_jobs','live_ptys','unacknowledged_commands'):
        require(type(fence.get(field)) is int and fence[field] == 0,
                'active_work_remaining:' + field)
    require(fence.get('destination_writes_count') == 0 and
            type(fence.get('destination_writes_count')) is int,
            'premature_destination_writer')
    planes = value.get('planes')
    require(isinstance(planes,dict) and set(planes) == {'operator','plugin','postgres'},
            'missing_durable_plane_attestation')
    for name, row in planes.items():
        require(isinstance(row,dict) and row.get('freeze_id') == freeze,
                'snapshot_fence_mismatch:' + name)
        require(type(row.get('generation')) is int and row['generation'] == generation,
                'snapshot_generation_mismatch:' + name)
        require(row.get('captured_after_fence') is True and
                row.get('flush_ack') is True, 'unflushed_snapshot:' + name)
        digest = row.get('synthetic_digest')
        require(isinstance(digest,str) and SHA.fullmatch(digest) is not None,
                'invalid_synthetic_digest:' + name)
    redis = value.get('redis')
    require(isinstance(redis,dict) and
            redis.get('mode') == 'cold_rebuild_fail_closed' and
            redis.get('auth_rate_limit') == 'deny_until_ready' and
            redis.get('replay_source') == 'durable_postgres_not_redis',
            'redis_fail_open')
    oauth = value.get('oauth')
    require(isinstance(oauth,dict) and
            oauth.get('process_maps_not_restored') is True and
            oauth.get('pending_google_pkce_expires') is True and
            oauth.get('consumed_hash_durable') is True,
            'oauth_replay_reset')
    comparisons = value.get('comparisons')
    require(isinstance(comparisons,dict) and set(comparisons) == RECONCILE,
            'missing_reconciliation')
    for name, row in comparisons.items():
        require(isinstance(row,dict), 'invalid_reconciliation:'+name)
        a,b=row.get('source'),row.get('restored')
        require(isinstance(a,str) and SHA.fullmatch(a) is not None and a == b,
                'reconciliation_mismatch:' + name)
    # No completion claim; this verifies only the shape/consistency of FAKE proofs.
    return {'status':'SYNTHETIC_EVIDENCE_CONTRACT_PASS',
            'planes':len(planes),'reconciled_dimensions':len(comparisons),
            'real_backup_proven':False,'production_cutover_authorized':False}

if __name__ == '__main__':
    try:
        print('RC50_BACKUP_CONSISTENCY_SOURCE_PASS '+json.dumps(contract_audit(),sort_keys=True))
        print('SOURCE_ONLY: no runtime backup, Docker action, private key or production data accessed')
    except (ConsistencyError,ValueError,TypeError,KeyError) as error:
        print('RC50_BACKUP_CONSISTENCY_SOURCE_FAIL '+str(error),file=sys.stderr)
        sys.exit(1)
