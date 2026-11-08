# Light Remote MCP — Unified Worklog

Status: cumulative; one file, append only verified milestones
Source authority: n8n2erpnext/light-remote-mcp, current clean repository
Historical Gold/Windows chronologies remain in the old read-only archive; do not merge them as if they happened in this new repository.

## 2026-11-08 — Clean repository reconstruction

- Parentless initial commit aa378ba established the unified codebase. Follow-up c03b50f aligned packaging; de7eb226 documented final provenance; follow-up 426556e / 23f386e published a single-primary-EXE plan, not a new native binary. New repository ID: 1450214328.
- Source c03b50f: GitHub CI 42475715858 reported 9/9 selected jobs PASS; isolated ARM private candidate 21/21 integration checks PASS; native Windows installer artifact was hash-checked on ARM. Physical Owner acceptance with this backend remains NOT_RUN.
- Older VPS-ARM worktrees, production runtimes and archived Git history are preserved and are not the default build source.
- Full checkpoint tag checkpoint/20261108-before-project-book records de7eb226 before the following documentation-system task.

## 2026-11-08 — Rebuild project documentation library from unified source

- Recreated docs/project-book navigation, governance, technical Project Book, source-linked Code Map, machine Project Truth status, rolling Worklog, generated source catalog and maintenance script.
- Used present code paths, contracts/api.v1.json, config/endpoints.json, root manifest and evidence rather than copying historical project-book documents.
- Kept MASTER_CHECKPOINT.json as the sole active checkpoint; did not reintroduce the forbidden legacy .light-remote/CURRENT_CHECKPOINT.json.
- No runtime rollout, native Windows physical test, A/B grant, DB/schema change or feature-flag change is claimed.
- Verification: local repository source-link and catalog checks; exact results to be recorded in the task completion report (not implicitly production evidence).

## 2026-11-08 — Owner SSH authority and no-branch policy

- README/AGENTS record the verified GitHub SSH remote and identity on VPS-ARM; connector API 403 is not loss of Git-over-SSH access.
- New branches (including CI/PR workaround branches) are prohibited without prior Owner approval; checkpoint-first, same-main development and controlled rollback are mandatory.
- Documentation governance only; no Agent, Wall, runtime, schema, grants or production deployment changed.

## 2026-11-08 — Owner scoped VPS-ARM workspace location

- Recorded the Owner's strict workspace boundary: all newly created Light Remote development folders must be inside `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/`; creating new sibling Light Remote directories directly under `/home/ubuntu/n8n2erpnext/` is forbidden.
- Applies to source, clones, builds, tests, staging, caches and artifacts, including Agent and Codex work. Canonical path/symlink checks required before creation. Preserve old outside-root directories as historical references; do not re-use them for active development.
- This was documentation/governance only, without runtime or production changes.
