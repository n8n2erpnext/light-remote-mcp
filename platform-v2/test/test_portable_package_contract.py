#!/usr/bin/env python3
"""Static package/portability contract checks. Never reads a live state path."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
CONTRACT=ROOT/'platform-v2/portability/portable-package-contract.json'

class ContractError(ValueError): pass

def source(rel):
    if not isinstance(rel,str) or not rel or Path(rel).is_absolute() or '..' in Path(rel).parts:
        raise ContractError('unsafe_source_path')
    target=ROOT/rel
    if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(ROOT.resolve()):
        raise ContractError('missing_source_reference:'+rel)
    return target.read_text(encoding='utf8')

def audit():
    data=json.loads(CONTRACT.read_text(encoding='utf8'))
    def require(ok,reason):
        if not ok:raise ContractError(reason)
    require(data.get('schema_version')==1,'schema_drift')
    require(data.get('status')=='DESIGN_ONLY_NOT_A_BACKUP_OR_RELEASE','not_design_only')
    require(data.get('validation_state')=='static-contract-only','validation_overclaim')
    require(data.get('scope')=='source-only portability package contract; no runtime or production reads','scope_drift')
    require(set(data.get('target_platforms',[]))=={'linux/arm64','linux/amd64'},'architecture_contract_drift')
    rt=data['runtime']
    require(rt['language']=='node-esm-mjs' and rt['framework']=='express-5','runtime_contract_drift')
    require(rt['service_user']=='lightremote' and rt['binary_digest_required'] is True
            and rt['architecture_specific_dependency_audit_required'] is True,'artifact_policy_missing')
    require(rt['artifacts']==['operator-host/executor.mjs','plugin-server/server.mjs','plugin-server/package-lock.json'],
            'artifact_source_drift')
    for item in rt['artifacts']:source(item)
    package=json.loads(source('plugin-server/package.json'))
    require(package['type']=='module' and package['dependencies']['express'].startswith('^5.'),
            'esm_express_source_drift')
    units=data['systemd']
    for unit,key,entry in [('operator_source','operator_env_reference','operator_entry'),
                           ('plugin_source','plugin_env_reference','plugin_entry')]:
        text=source(units[unit])
        require('User=lightremote' in text and 'EnvironmentFile='+units[key] in text,
                'unit_config_reference_drift:'+unit)
        require('ExecStart='+rt['node_path_in_install']+' '+units[entry] in text,
                'unit_exec_reference_drift:'+unit)
    envelope=data['envelopes']
    require(envelope['application']['digest_required'] is True
            and envelope['application']['include_secrets'] is False
            and envelope['application']['include_customer_state'] is False
            and envelope['application']['reproducible_arm64_amd64_required'] is True,'unsafe_artifact_envelope')
    require(envelope['configuration']['versioned_references_only'] is True
            and envelope['configuration']['actual_runtime_paths_require_separate_authorization'] is True,
            'unsafe_config_envelope')
    require(envelope['durable_data']['single_writer_freeze_required'] is True
            and envelope['durable_data']['independent_restore_required'] is True,
            'unsafe_restore_envelope')
    inventory=json.loads(source(envelope['durable_data']['inventory_source']))
    require(inventory['schema_version']==1,'invalid_state_inventory')
    secret=envelope['secret_identity']
    require(secret['in_repository'] is False and secret['in_artifact'] is False
            and secret['offline_owner_authorized_custody'] is True
            and secret['device_private_keys_never_exported'] is True,'unsafe_secret_envelope')
    uat=data['uat_template']
    compose=source(uat['path'])
    require(uat['synthetic_only'] is True and uat['may_be_used_for_production'] is False
            and 'internal: true' in compose and 'ports:' not in compose,'unsafe_uat_template')
    needed={'source_writer_fence','drain_jobs_and_pty','snapshot_consistency',
            'oauth_key_identity_continuity','grant_revocation_continuity',
            'usage_and_billing_reconcile','single_authority_switch','reverse_fence_before_rollback'}
    require(needed.issubset(set(data.get('relocation_requirements',[]))),'missing_cutover_gate')
    blocks=set(data.get('blocked_operations',[]))
    require({'sealed_synthetic_backup_runtime_tests','docker_two_stack_cold_move',
             'production_secret_or_customer_data_export'}.issubset(blocks),'unsafe_blocked_gate')
    return {'source_artifacts':len(rt['artifacts']),'target_platforms':len(data['target_platforms']),
            'required_cutover_gates':len(data['relocation_requirements'])}

class PortablePackageContractTests(unittest.TestCase):
    def setUp(self):
        self.original=json.loads(CONTRACT.read_text())
    def check_changed(self,data,reason):
        with tempfile.TemporaryDirectory(prefix='lr_portable_contract_src_only_') as scratch:
            mock=Path(scratch)/'contract.json'
            mock.write_text(json.dumps(data))
            with patch(__name__+'.CONTRACT',mock):
                with self.assertRaisesRegex(ContractError,reason):audit()
    def test_declared_source_contract(self):
        result=audit()
        self.assertEqual(result['target_platforms'],2)
        self.assertEqual(result['source_artifacts'],3)
    def test_deny_production_eligible_uat_compose(self):
        data=json.loads(json.dumps(self.original))
        data['uat_template']['may_be_used_for_production']=True
        self.check_changed(data,'unsafe_uat_template')
    def test_missing_amd64_target_fails(self):
        data=json.loads(json.dumps(self.original))
        data['target_platforms']=['linux/arm64']
        self.check_changed(data,'architecture_contract_drift')
    def test_single_writer_fence_not_optional(self):
        data=json.loads(json.dumps(self.original))
        data['envelopes']['durable_data']['single_writer_freeze_required']=False
        self.check_changed(data,'unsafe_restore_envelope')
    def test_runtime_unit_entry_mismatch_fails(self):
        data=json.loads(json.dumps(self.original))
        data['systemd']['plugin_entry']='/opt/fake/plugin.mjs'
        self.check_changed(data,'unit_exec_reference_drift')

if __name__=='__main__':
    unittest.main(verbosity=2)
