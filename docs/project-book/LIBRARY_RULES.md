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

Continue on **main** unless branch protection or actual parallel development requires an explicitly approved short-lived branch. Do not branch for each fix or write new side-by-side handoffs. On failed work, prefer a controlled revert of published commits or isolated reset of *unpublished* work; DB/runtime rollback requires separate verified snapshots and migration instructions.

Update MASTER_CHECKPOINT.json and PROJECT_TRUTH.md for meaningful source changes. Update Worklog for consequential milestones. Rebuild generated catalogs with:
- node deploy/unified/project-book.mjs --write
- node deploy/unified/project-book.mjs --check

These commands check documentation structure only; they do not start services, use credentials, or pronounce production readiness. The existing source↔checkpoint check is retained; no extra HOLD workflow or per-file release gate is introduced.

## Library discipline

Search canonical docs before writing; edit an existing owner file instead of creating overlapping truth. Use [Library Map](DOCUMENT_LIBRARY_MAP.md). Preserve historical paths unless consumers have been audited. The only new canonical governance shelf is docs/project-book; code and deployment evidence stay in their current locations.

Each new durable document records status, scope, concrete source paths, what is tested vs inferred, and one next action. Never write secrets, raw token values, device credentials, private logs, certificates, or database dumps into Git.

## Boundaries and verification

Treat new-repository CI at c03b50f as verified scoped evidence only. 21 internal candidate checks and Windows CI do not establish Owner physical acceptance, Wall SSO live redemption, signed B execution, or production readiness. For a new release, validate exact commit, artifact hash and deployed runtime independently.

Do not edit the old archived branch/worktrees or advance the existing production/old Owner device as part of documentation work.
