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

Before substantive new functionality, verify clean working tree, capture a full checkpoint at the current work commit and create an annotated checkpoint tag. The root checkpoint records component/source identity, contract, currently known proof and limitations, next action and rollback boundary; tags preserve the exact pre-change Git tree.

**Owner explicitly approved ONE `work` branch on 2026-11-08**, first to run the required CI and thereafter to be the persistent development branch. Continue on `work`; `main` remains the protected stable baseline and receives only tested, compatible source. **No additional branch, including temporary PR/CI or `codex/*`, without a new explicit Owner approval.** If protection rejects promotion, preserve the `work` commit and report; never bypass `baseline-required` or force-push. Git-over-SSH `git@github.com:n8n2erpnext/light-remote-mcp.git` works on VPS-ARM (authenticated 2026-11-08); a GitHub API connector 403 does not establish missing Git write access. Do not write new side-by-side handoffs. On failed work, prefer a controlled revert of published commits or isolated reset of *unpublished* work; DB/runtime rollback requires separate verified snapshots and migration instructions.

Update MASTER_CHECKPOINT.json and PROJECT_TRUTH.md for meaningful source changes. Update Worklog for consequential milestones. Rebuild generated catalogs with:
- node deploy/unified/project-book.mjs --write
- node deploy/unified/project-book.mjs --check

These commands check documentation structure only; they do not start services, use credentials, or pronounce production readiness. The existing source↔checkpoint check is retained; no extra HOLD workflow or per-file release gate is introduced.

## VPS-ARM development-directory boundary — Owner rule

All **new** Light Remote directories on VPS-ARM must be created beneath the single approved parent:

`/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/`

New development checkouts, builds, tests, staging, temporary data, artifacts, caches and recovery directories are included. Direct new children of `/home/ubuntu/n8n2erpnext/` (siblings of `light-remote-unified-20261108`) are strictly prohibited. This is not limited to the nested current checkout; creating new folders at the unified workspace root **is allowed**.

Resolve the intended path and verify it cannot escape through symlinks or `..`. Existing historical folders outside the approved parent must remain untouched and cannot be reused for new development. Stop for an explicit Owner decision if the requested workspace falls outside. This rule also applies to Codex and other Agent tools; it does not authorize new Git branches.

## TASK COMPLETION AND SUBTASK CHECKPOINTS

The existing before-task Full Checkpoint rule remains. **In addition**, every task MUST close with a refreshed **single root `MASTER_CHECKPOINT.json` and rolling root `PROJECT_HANDOFF.md`**, plus a durable `LIGHT_REMOTE_WORKLOG.md` milestone. Each meaningful completed subtask in a multi-step/long-running assignment MUST receive an interim handoff + checkpoint **before** the next phase, not just a final summary after all work.

Minimum receipt: objective, step/task status (DONE/IN_PROGRESS/BLOCKED/FAILED/NOT_TESTED), exact Git source commit/tree and uncommitted changes, GitHub publication status, actual files/APIs impacted, CI vs real integration vs physical evidence, deployed-runtime distinction, remaining gaps/regressions, rollback checkpoint, and the next concrete action. Do not mistake tests from an older artifact as proof about the current artifact.

Do not create per-session handoff copies, alternate checkpoints, branch checkpoints or new gates. **Update the existing canonical files**. A task blocked by permission still gets a truthful current handoff/checkpoint. Local-only commits must be labeled `LOCAL_ONLY / GITHUB_NOT_SYNCED`. When current files are updated but cannot be pushed because of protected main, keep the local commit; no new branch without Owner approval.

## Library discipline

Search canonical docs before writing; edit an existing owner file instead of creating overlapping truth. Use [Library Map](DOCUMENT_LIBRARY_MAP.md). Preserve historical paths unless consumers have been audited. The only new canonical governance shelf is docs/project-book; code and deployment evidence stay in their current locations.

Each new durable document records status, scope, concrete source paths, what is tested vs inferred, and one next action. Never write secrets, raw token values, device credentials, private logs, certificates, or database dumps into Git.

## Boundaries and verification

Treat new-repository CI at c03b50f as verified scoped evidence only. 21 internal candidate checks and Windows CI do not establish Owner physical acceptance, Wall SSO live redemption, signed B execution, or production readiness. For a new release, validate exact commit, artifact hash and deployed runtime independently.

Do not edit the old archived branch/worktrees or advance the existing production/old Owner device as part of documentation work.


## Atomic same-commit gate — mandatory

The per-task/step cadence is enforced at the **Git commit** boundary, not just at task completion. Every commit (including docs-only) stages checkpoint, rolling handoff, Worklog and generated Project Truth JSON **together**. Unique `commitSyncGate.taskId` must appear in *newly added* handoff and Worklog lines. Checkpoint records actual status, summary, verification and next action plus a Git-blob source digest computed from the staged index.

**Code Map** is required in the same commit for changed Agent/Operator/Plugin/native/SQL executable boundaries; **API Integration Matrix** for API contract/endpoints; **Build and Deployment** for installer/build changes. Ordinary internal fixes without changed contracts do not need a separate per-feature document. Generated docs-status JSON remains synchronized with checkpoint.

No code-first/docs-later commits. Verify using `npm run check:commit-sync`, `npm run check:docs`, `npm run check:truth`. Local `.githooks/pre-commit` and CI `truth` verify staging / each new commit. On failure, report **YÊU CẦU BỔ SUNG CHECKPOINT + HANDOFF + DOCS (NẾU CÓ)** and missing/unsynced paths. Commits before gate activation are historical and not rewritten. Do not create new branches without Owner permission.
