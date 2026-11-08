#!/usr/bin/env python3
"""Source-only deployment writer and ABI boundary audit. Never reads live paths."""
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
BOUNDARIES=ROOT/'platform-v2/portability/deployment-state-boundaries.json'
LEGACY=ROOT/'platform-v2/portability/legacy-state-contract.json'
WRITES=re.compile(r'\bfs\.(?:promises\.)?(?:writeFile|appendFile|rename|copyFile|cp|rm)(?:Sync)?\s*\(')
ALLOWED_ROLES={
 'rebuildable_release_manifest','security_sensitive_key_provisioning',
 'security_sensitive_local_wall_provisioning','signed_distribution_state',
 'build_only_client_artifact','build_only_native_artifact'
}
class BoundaryError(RuntimeError):pass
def require(check,message):
    if not check:raise BoundaryError(message)
def source_text(rel):
    require(isinstance(rel,str) and (rel.startswith('deploy/scripts/') or rel.startswith('lib/') or rel.startswith('operator-host/')),
            'unsafe_source_ref')
    path=ROOT/rel
    require(path.suffix=='.mjs' and path.is_file() and not path.is_symlink() and
            path.resolve().is_relative_to(ROOT.resolve()),'missing_source_ref:'+rel)
    return path.read_text(encoding='utf8')
def audit():
    obj=json.loads(BOUNDARIES.read_text(encoding='utf8'))
    legacy=json.loads(LEGACY.read_text(encoding='utf8'))
    require(obj.get('schema_version')==1 and obj.get('status')=='SOURCE_ONLY_NOT_RUNTIME_INVENTORY',
            'boundary_schema_invalid')
    tracked=obj.get('tracked_deploy_writers',[])
    declared={x['source'] for x in tracked}
    require(len(tracked)==len(declared),'duplicate_deploy_writer')
    discovered=set()
    for file in (ROOT/'deploy/scripts').glob('*.mjs'):
        if file.name.startswith('selftest-'):continue
        rel=file.relative_to(ROOT).as_posix()
        if WRITES.search(source_text(rel)):discovered.add(rel)
    require(discovered==declared,
            'deploy_writer_inventory_drift:missing='+','.join(sorted(discovered-declared))+
            ';stale='+','.join(sorted(declared-discovered)))
    for row in tracked:
        rel=row['source']
        require(rel.startswith('deploy/scripts/') and row.get('role') in ALLOWED_ROLES,
                'unclassified_deploy_writer:'+rel)
        markers=row.get('markers',[])
        require(len(markers)>=2 and len(markers)==len(set(markers)),
                'weak_writer_source_markers:'+rel)
        src=source_text(rel)
        for marker in markers:
            require(isinstance(marker,str) and len(marker)>=6 and marker in src,
                    'missing_deploy_writer_marker:'+rel)
        require(bool(row.get('restore')),'writer_restore_policy_missing:'+rel)
    external={x['id']:x for x in legacy['outside_operator_state']}
    linked=obj.get('host_external_links',[])
    linked_ids=[x['external_state_id'] for x in linked]
    require(len(linked_ids)==len(set(linked_ids)) and len(linked_ids)>=4,
            'host_external_link_missing')
    for row in linked:
        name=row['external_state_id']
        entry=external.get(name)
        require(entry is not None and entry['path_source']==row['source'] and row['source'] in declared,
                'host_writer_unbound:'+name)
        require(bool(row.get('custody')) and bool(row.get('restore')),'host_custody_policy_missing:'+name)
    exclusions=obj.get('explicit_exclusions',[])
    require(len(exclusions)>=3 and len({x['source'] for x in exclusions})==len(exclusions),
            'exclusion_missing_or_duplicate')
    for row in exclusions:
        text=source_text(row['source'])
        require(row['category'] in {'device_local_state','uat_sqlite_only','user_requested_filesystem_operations'},
                'exclusion_scope_invalid:'+row['source'])
        require(all(marker in text for marker in row['markers']) and bool(row['reason']),
                'exclusion_marker_missing:'+row['source'])
    native=obj['native_abi']
    require(native['source']=='deploy/scripts/stage-terminal-runtime.mjs'
            and native['source'] in declared,'native_stage_not_classified')
    require(native['runtime_module']=='@homebridge/node-pty-prebuilt-multiarch'
            and native['linux_native_name']=='node.abi127.node'
            and set(native['architectures'])=={'linux-x64','linux-arm64'}
            and native['validation']=='STATIC_ABI_BOUNDARY_ONLY_NO_BINARY_TEST',
            'native_abi_contract_drift')
    src=source_text(native['source'])
    require(native['runtime_module'] in src and native['linux_native_name'] in src
            and "${platform}-${arch}" in src,
            'native_abi_source_drift')
    return {'deploy_writers':len(tracked),'host_links':len(linked),
            'explicit_exclusions':len(exclusions),'native_architectures':len(native['architectures'])}
if __name__=='__main__':
    try:
        print('RC50_DEPLOYMENT_SOURCE_BOUNDARIES_PASS '+json.dumps(audit(),sort_keys=True))
        print('SOURCE_ONLY: no credentials, actual mounts, channel promotion or native binary loaded')
    except (BoundaryError,KeyError,ValueError,TypeError) as exc:
        print('RC50_DEPLOYMENT_SOURCE_BOUNDARIES_FAIL '+str(exc),file=sys.stderr)
        sys.exit(1)
