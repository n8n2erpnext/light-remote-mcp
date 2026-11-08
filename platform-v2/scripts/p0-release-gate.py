#!/usr/bin/env python3
"""Fail-closed rc50 RELEASE acceptance; not a substitute for production tests.

Default --report prints verified blockers and succeeds for development CI.
--require-ready exits nonzero until all hard P0 gates have genuine evidence.
Never infer E2E release readiness from isolated synthetic PG/node unit tests.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
AUDIT=ROOT/'platform-v2/portability/audit_writer_freeze_readiness.py'
REQUIRE={
    'P0-A_WRITER':'single_authoritative_epoch_for_operator_plugin_fleet_agent_not_verified',
    'P0-B_IDENTITY':'independent_authenticated_owner_wall_agent_origin_not_verified',
    'P0-C_DURABILITY':'consistent_all_writer_checkpoint_and_restart_fence_not_verified',
    'P0-D_PORTABILITY':'independent_arm_to_amd_full_state_restore_and_rollback_not_verified',
    'P0-E_RELEASE':'real_multi_service_e2e_rollback_acceptance_not_verified'
}

def main(args=None):
    parser=argparse.ArgumentParser()
    group=parser.add_mutually_exclusive_group()
    group.add_argument('--report',action='store_true')
    group.add_argument('--require-ready',action='store_true')
    opts=parser.parse_args(args)
    if not AUDIT.is_file():
        print(json.dumps({'status':'UNVERIFIABLE','error':'writer_audit_missing'}))
        return 4
    try:
        spec=importlib.util.spec_from_file_location('lr_rc50_writer_audit',AUDIT)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        registry=module.audit()
        if registry.get('status')!='NOT_READY':
            # A change to the inventory schema/meaning must be independently
            # reviewed, not silently promote release eligibility.
            raise RuntimeError('writer_inventory_status_drift_review_required')
        if not isinstance(registry.get('fsync_proven'),int):
            raise RuntimeError('writer_inventory_fs_count_invalid')
    except Exception as exc:
        print(json.dumps({'status':'UNVERIFIABLE','error':str(exc)[:180]}))
        return 4
    gates={name:{'ready':False,'reason':reason} for name,reason in REQUIRE.items()}
    gates['P0-A_WRITER']['writer_single_authority_proven']=bool(
        registry.get('single_writer_authority_proven'))
    gates['P0-C_DURABILITY']['file_sync_proven']=registry['fsync_proven']
    gates['P0-C_DURABILITY']['file_sync_not_proven']=registry.get('fsync_not_proven')
    gates['P0-C_DURABILITY']['multi_file_checkpoint_proven']=False
    report={'product':'light-remote','release':'0.9.0-rc.50',
      'status':'NOT_READY','gate_count':len(gates),
      'ready_count':0,'gates':gates,
      'source':'local_rc50_p0_exit_checks_not_production_attestation',
      'explicit_release_guard':bool(opts.require_ready)}
    print(json.dumps(report,sort_keys=True,ensure_ascii=True))
    return 3 if opts.require_ready else 0

if __name__=='__main__':
    raise SystemExit(main())
