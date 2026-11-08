#!/usr/bin/env python3
"""Source-only portability inventory verification.

Reads tracked .mjs/systemd source and the checked-in contract ONLY. Never
opens any live registry, secret, .env, Docker volume, or customer data.
"""
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
MANIFEST=ROOT/"platform-v2/portability/legacy-state-contract.json"
SOURCE=ROOT/"operator-host/executor.mjs"
EXPECTED_CLASSES={
 "critical_signing_material","critical_config","durable_identity",
 "durable_authorization","durable_session","durable_billing",
 "durable_entitlement","durable_message","durable_content",
 "operational_history","verification_artifact","release_integrity"
}
PATTERN=re.compile(
 r"const\s+([A-Z_]+)\s*=\s*path\.join\(STATE_DIR,\s*'([^']+\.json)'\)",
 re.MULTILINE
)
class ContractError(RuntimeError): pass
def ensure(ok,what):
    if not ok:raise ContractError(what)
def read_source(rel):
    path=ROOT/rel
    ensure(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(ROOT.resolve()),
        "unapproved_source_reference:"+rel)
    ensure(path.suffix in ('.mjs','.service'),"unapproved_source_extension:"+rel)
    return path.read_text(encoding="utf8")

def audit():
    obj=json.loads(MANIFEST.read_text(encoding="utf8"))
    ensure(obj.get("schema_version")==1,"invalid_inventory_schema")
    ensure(obj.get("scope")=="source-derived state inventory; NEVER read live files",
        "invalid_inventory_scope")
    root=obj.get("operator_state_root",{})
    ensure(root.get("variable")=="STATE_DIR" and root.get("env_override")=="OPERATOR_STATE_DIR",
        "state_root_mismatch")
    source=read_source("operator-host/executor.mjs")
    ensure("process.env.OPERATOR_STATE_DIR" in source,"missing_operator_override")
    observed=dict(PATTERN.findall(source))
    # Fails when a new durable file is added to executor.mjs but no inventory
    # row is added. Source is the authority for path *discovery*, not values.
    rows=obj.get("operator_files",[])
    declared={row["variable"]:row["filename"] for row in rows}
    ensure(observed==declared,
      "operator_durable_file_inventory_drift:"+
      "missing="+",".join(sorted(set(observed)-set(declared)))+
      ";stale="+",".join(sorted(set(declared)-set(observed))))
    ensure(len(declared)==len(rows),"duplicate_operator_inventory_key")
    for row in rows:
        ensure(row.get("classification") in EXPECTED_CLASSES,
            "invalid_operator_class:"+row.get("variable",""))
        ensure(row.get("backup_required") is True,"unsafe_optional_durable_file")
        ensure(row.get("restore_policy")=="must-preserve-ID-and-revocation",
            "missing_restore_identity_guard")
        ensure("/" not in row["filename"] and ".." not in row["filename"],
            "unsafe_inventory_relative_path")
    extra=obj.get("outside_operator_state",[])
    ids=[r.get("id") for r in extra]
    ensure(len(ids)==len(set(ids)) and len(ids)>8,"duplicate_or_missing_external_state")
    for row in extra:
        ensure(row.get("classification") in EXPECTED_CLASSES,
            "invalid_external_class:"+str(row.get("id")))
        ensure(isinstance(row.get("required"),bool),"external_requirement_not_explicit")
        marker=row.get("source_marker")
        ensure(isinstance(marker,str) and len(marker)>=6,"missing_external_marker")
        ensure(marker in read_source(row["path_source"]),
            "external_state_source_marker_missing:"+row["id"])
    # Enumerate checked-in plugin .mjs writer call sites, not live state.
    # Explicit test-only writers must also be tracked; do not silently ignore
    # any newly added persistence module.
    plugin_dir=ROOT/"plugin-server"
    discovered=set()
    writer_calls=re.compile(r"\bfs\.(?:promises\.)?(?:writeFile|appendFile|rename)(?:Sync)?\s*\(")
    for file in sorted(plugin_dir.glob("*.mjs")):
        rel=file.relative_to(ROOT).as_posix()
        content=read_source(rel)
        if writer_calls.search(content):
            discovered.add(rel)
    plugin_rows=obj.get("plugin_persistent_writers",[])
    plugin_sources=[r.get("source") for r in plugin_rows]
    fixtures=obj.get("plugin_test_only_writers",[])
    ensure(len(plugin_sources)==len(set(plugin_sources)) and len(fixtures)==len(set(fixtures)),
           "duplicate_plugin_writer")
    ensure(all(isinstance(x,str) and x.startswith("plugin-server/") for x in fixtures),
           "invalid_test_only_writer")
    ensure(discovered==set(plugin_sources)|set(fixtures),
           "plugin_writer_inventory_drift:missing="+
           ",".join(sorted(discovered-set(plugin_sources)-set(fixtures)))+
           ";stale="+",".join(sorted((set(plugin_sources)|set(fixtures))-discovered)))
    external_by_id={r["id"]:r for r in extra}
    for row in plugin_rows:
        rel=row["source"]
        ensure(rel.startswith("plugin-server/") and rel.endswith(".mjs"),
               "invalid_plugin_writer_source:"+rel)
        contract=external_by_id.get(row.get("state_contract_id"))
        ensure(contract is not None and contract["path_source"]==rel,
               "unbound_plugin_writer:"+rel)
        source_text=read_source(rel)
        for marker in row.get("markers",[]):
            ensure(isinstance(marker,str) and len(marker)>=6 and marker in source_text,
                   "plugin_writer_marker_missing:"+rel)
        ensure(len(row.get("markers",[]))>=2,"weak_plugin_writer_markers:"+rel)
    trans=obj.get("transient_state",[])
    ensure(len(trans)>=3,"missing_runtime_state_classes")
    for row in trans:
        content=read_source(row["source"])
        for marker in row.get("markers",[]):
            ensure(marker in content,"missing_transient_state_marker:"+row["id"])
        ensure("never" in row.get("migration_requirement","").lower()
              or "required" in row.get("migration_requirement","").lower(),
               "unsafe_transient_state_policy")
    inv=obj.get("restore_invariants",[])
    ensure(len(set(inv))==len(inv) and len(inv)>=14,
        "missing_or_duplicate_restore_invariants")
    return {"plugin_persistent_writers":len(plugin_rows),
            "plugin_test_only_writers":len(fixtures),
            "operator_state_files":len(rows),
            "external_state_contracts":len(extra),
            "transient_classes":len(trans),
            "restore_invariants":len(inv)}
if __name__=="__main__":
    try:
        stats=audit()
        print("RC50_SOURCE_STATE_INVENTORY_PASS "+json.dumps(stats,sort_keys=True))
        print("SOURCE_ONLY: no live files, registry contents, credentials, or containers read")
    except (ContractError,ValueError,KeyError,TypeError) as exc:
        print("RC50_SOURCE_STATE_INVENTORY_FAIL "+str(exc),file=sys.stderr)
        sys.exit(1)
