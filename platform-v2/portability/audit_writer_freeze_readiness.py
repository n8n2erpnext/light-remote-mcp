#!/usr/bin/env python3
"""Read-only coverage audit of unmitigated rc50 writer-fencing hazards.

Outputs NOT_READY by design. Never touches services, Docker, data or secrets.
"""
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
MANIFEST=ROOT/'platform-v2/portability/writer-freeze-readiness.json'
STATE=ROOT/'platform-v2/portability/legacy-state-contract.json'
FSYNC_RE=re.compile(r'\b(?:fs\.|fs\.promises\.|fsp\.)?(?:f(?:data)?sync(?:Sync)?|sync(?:Sync)?)\s*\(')
class WriterAuditError(ValueError): pass

def require(ok,reason):
    if not ok: raise WriterAuditError(reason)

def source(relative):
    require(isinstance(relative,str) and
            (relative.startswith('operator-host/') or relative.startswith('plugin-server/')) and
            relative.endswith('.mjs') and '..' not in Path(relative).parts,
            'untrusted_source_path')
    file=ROOT/relative
    require(file.is_file() and not file.is_symlink() and
            file.resolve().is_relative_to(ROOT.resolve()),
            'missing_source:'+relative)
    return file.read_text(encoding='utf8')

def audit():
    manifest=json.loads(MANIFEST.read_text(encoding='utf8'))
    state=json.loads(STATE.read_text(encoding='utf8'))
    require(manifest.get('schema_version')==1 and
            manifest.get('status')=='SOURCE_OBSERVATIONS_ONLY_NOT_RESTORE_READY' and
            manifest.get('non_authoritative_uat_only') is True,
            'readiness_claim_not_allowed')
    operator=manifest['operator_writers']
    plugins=manifest['plugin_writers']
    expected={row['variable']:row['classification'] for row in state['operator_files']}
    require(len(expected)==14 and len(operator)==14 and
            len({row['id'] for row in operator})==14 and
            {row['id'] for row in operator}==set(expected),
            'operator_writer_inventory_drift')
    ptypes={row['id']:row['classification'] for row in state['outside_operator_state']
            if row['kind']=='plugin_state'}
    require(len(plugins)==4 and len({row['id'] for row in plugins})==4 and
            {row['id'] for row in plugins}==set(ptypes),
            'plugin_writer_inventory_drift')
    for row in operator+plugins:
        label=row['id']
        require(row['classification']==(expected.get(label) if label in expected else ptypes.get(label)),
                'writer_classification_drift:'+label)
        data=source(row['source'])
        if row.get('write_marker')=='durableAtomicWriteSync(':
            require(row['write_marker'] in data and
                    "from '../lib/durable-atomic-file.mjs'" in data,
                    'durable_writer_import_or_call_missing:'+label)
            require(row.get('flushing')=='sync_file_and_parent_directory'
                    and row.get('fsync_proven') is True
                    and row.get('source_fence_proven') is False
                    and row.get('consistent_generation_proven') is False,
                    'durable_writer_overclaims_global_fence:'+label)
            require('fs.writeFileSync(' not in data and
                    'fs.renameSync(' not in data,
                    'unconverted_writer_still_present:'+label)
        else:
            require(row.get('write_marker')=='fs.writeFileSync(' and
                    row['write_marker'] in data,
                    'write_path_marker_missing:'+label)
            require(row.get('flushing')=='synchronous_process_io_only' and
                    all(row.get(x) is False for x in
                        ('fsync_proven','source_fence_proven',
                         'consistent_generation_proven')),
                    'unsupported_fence_or_durability_claim:'+label)
            require(FSYNC_RE.search(data) is None,
                    'new_fsync_requires_reaudit:'+label)
    deps=manifest['dependencies']
    require(len(deps)==5 and len({d['id'] for d in deps})==5,
            'dependency_risk_inventory_drift')
    for row in deps:
        data=source(row['source'])
        require(all(isinstance(marker,str) and marker in data
                    for marker in row['required_markers']) and
                bool(row['risk']) and row['barrier_proven'] is False,
                'dependency_risk_source_drift:'+row['id'])
        if row['id']=='EVENT_LOG_ASYNC':
            require('beforeDrained:()=>flushDiskRecords()' in row['required_markers'],
                    'audit_drain_seal_missing')
            require(row.get('helper_source')=='operator-host/audit-append-barrier.mjs'
                    and row.get('risk')=='append_file_and_directory_fsync_in_dev_but_no_source_fence_or_authoritative_journal_watermark'
                    and len(row.get('helper_markers',[]))>=3,
                    'append_error_latch_contract_missing')
            helper=source(row['helper_source'])
            require(all(marker in helper for marker in row['helper_markers']),
                    'append_error_latch_source_drift')
            durable=source('operator-host/durable-audit-append.mjs')
            require(all(marker in durable for marker in
                    ('await file.writeFile(batch', 'await file.sync()',
                     'await dir.sync()', 'fs.constants.O_NOFOLLOW')),
                    'durable_audit_append_source_drift')
    helper=source('operator-host/durable-audit-append.mjs')
    atomic=ROOT/'lib/durable-atomic-file.mjs'
    require(atomic.is_file() and not atomic.is_symlink(),
            'shared_atomic_writer_missing')
    atomic_source=atomic.read_text(encoding='utf8')
    require(all(mark in atomic_source for mark in
                ('io.fsyncSync(fd)', 'io.fsyncSync(dirFd)',
                 'io.renameSync(tmp,file)', 'io.constants.O_EXCL',
                 'io.constants.O_NOFOLLOW',
                 'failed=error instanceof Error')),
            'shared_atomic_writer_durability_contract_missing')
    require(len(manifest.get('required_remediations',[]))>=8 and
            bool(manifest.get('reason_not_ready')),
            'missing_gap_register')
    durable=sum(row['fsync_proven'] is True for row in operator+plugins)
    return {'status':'NOT_READY',
            'operator_writers':len(operator),'plugin_writers':len(plugins),
            'known_unmitigated_dependencies':len(deps),
            'fsync_proven':durable,
            'fsync_not_proven':len(operator)+len(plugins)-durable,
            'single_writer_authority_proven':False}

if __name__=='__main__':
    try:
        print('RC50_WRITER_SOURCE_GAP_AUDIT_PASS '+json.dumps(audit(),sort_keys=True))
        print('SOURCE_ONLY: NOT_READY is an explicit limitation, NOT a restore acceptance')
    except (WriterAuditError,KeyError,TypeError,ValueError) as e:
        print('RC50_WRITER_SOURCE_GAP_AUDIT_FAIL '+str(e),file=sys.stderr)
        sys.exit(1)
