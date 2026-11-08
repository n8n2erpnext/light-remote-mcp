# Unified Light Remote Documentation Rules

Status: canonical
Edition: 2026-11-08
Scope: new Light Remote MCP repository, all human/AI contributors

## Authority, not folklore

Source at an exact SHA plus actual runtime/build provenance outranks a document claim. Source presence != deployed != enabled != integrated != CI PASS != physical PASS. Owner decisions define goals, not retroactive test evidence. Historical notes, including docs/gold and the archived repository, are **not** current runtime authority.

**One active checkpoint:** root MASTER_CHECKPOINT.json. Do not create .light-remote/CURRENT_CHECKPOINT.json or a competing latest checkpoint. The current repository's deploy/unified/check-truth.mjs deliberately rejects that legacy file.

**One status:** root PROJECT_TRUTH.md for current high-level state, docs/project-book/LIGHT_REMOTE_PROJECT_BOOK.md for the navigable technical synthesis, and docs/project-book/PROJECT_TRUTH_STATUS.json for the machine-readable view. None replaces exact runtime observations.

**One chronology:** LIGHT_REMOTE_WORKLOG.md. Add meaningful dated milestones and evidence; do not create session-specific FINAL/LATEST/HOLD files.

**One Code Map:** LIGHT_REMOTE_CODE_MAP.md. Update when module ownership, executable entrypoints, API routes, trust boundary, persistence or packaging ownership actually changes; keep exact repository-relative file links.

## Full checkpoint and single-branch practice

Before substantive new functionality, verify clean working tree, capture a full checkpoint at the current main commit and create an annotated checkpoint tag. The root checkpoint records component/source identity, contract, currently known proof and limitations, next action and rollback boundary; tags preserve the exact pre-change Git tree.

Continue only on **main**. **No branch of any kind (including temporary PR/CI, `codex/*` and branch-backed worktrees) without explicit prior Owner permission.** If branch protection rejects a push, preserve the local commit and report the block — do not branch, bypass `baseline-required` or force-push. Git-over-SSH `git@github.com:n8n2erpnext/light-remote-mcp.git` works on VPS-ARM (authenticated 2026-11-08); a GitHub API connector 403 does not establish missing Git write access. Do not write new side-by-side handoffs. On failed work, prefer a controlled revert of published commits or isolated reset of *unpublished* work; DB/runtime rollback requires separate verified snapshots and migration instructions.

Update MASTER_CHECKPOINT.json and PROJECT_TRUTH.md for meaningful source changes. Update Worklog for consequential milestones. Rebuild generated catalogs with:
- node deploy/unified/project-book.mjs --write
- node deploy/unified/project-book.mjs --check

These commands check documentation structure only; they do not start services, use credentials, or pronounce production readiness. The existing source↔checkpoint check is retained; no extra HOLD workflow or per-file release gate is introduced.

## VPS-ARM development-directory boundary — Owner rule

All **new** Light Remote directories on VPS-ARM must be created beneath the single approved parent:

`/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/`

New development checkouts, builds, tests, staging, temporary data, artifacts, caches and recovery directories are included. Direct new children of `/home/ubuntu/n8n2erpnext/` (siblings of `light-remote-unified-20261108`) are strictly prohibited. This is not limited to the nested current checkout; creating new folders at the unified workspace root **is allowed**.

Resolve the intended path and verify it cannot escape through symlinks or `..`. Existing historical folders outside the approved parent must remain untouched and cannot be reused for new development. Stop for an explicit Owner decision if the requested workspace falls outside. This rule also applies to Codex and other Agent tools; it does not authorize new Git branches.

## Library discipline

Search canonical docs before writing; edit an existing owner file instead of creating overlapping truth. Use [Library Map](DOCUMENT_LIBRARY_MAP.md). Preserve historical paths unless consumers have been audited. The only new canonical governance shelf is docs/project-book; code and deployment evidence stay in their current locations.

Each new durable document records status, scope, concrete source paths, what is tested vs inferred, and one next action. Never write secrets, raw token values, device credentials, private logs, certificates, or database dumps into Git.

## Boundaries and verification

Treat new-repository CI at c03b50f as verified scoped evidence only. 21 internal candidate checks and Windows CI do not establish Owner physical acceptance, Wall SSO live redemption, signed B execution, or production readiness. For a new release, validate exact commit, artifact hash and deployed runtime independently.

Do not edit the old archived branch/worktrees or advance the existing production/old Owner device as part of documentation work.
