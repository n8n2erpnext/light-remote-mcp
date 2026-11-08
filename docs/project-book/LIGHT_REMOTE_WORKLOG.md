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

## 2026-11-08 — Mandatory per-task and per-step handoff/checkpoint cadence

- Existing rule previously covered a Full Checkpoint **before** substantive work and periodic Worklog updates; it did not mandate checkpoint + rolling handoff **after each task and each meaningful subtask** of long work.
- Added explicit completion/interim reporting to the existing `README.md`, `AGENTS.md`, `docs/project-book/LIBRARY_RULES.md`, `PROJECT_HANDOFF.md` and root `MASTER_CHECKPOINT.json`. No new handoff files or checkpoint store.
- Required receipts distinguish Git source tree, published/local-only state, runtime, tests/physical evidence, regressions, rollback point and next action; documentation-only change, no runtime claims.

## 2026-11-08 — Atomic commit sync guard

- Receipt: 20261108-atomic-commit-sync-gate-v1
- New `deploy/unified/commit-sync-gate.mjs` verifies Git index/source blob digest and per-commit unique receipt mirrored in `MASTER_CHECKPOINT.json`, `PROJECT_HANDOFF.md` and this Worklog. Generated docs status and relevant Code Map/API/build docs must be staged in the **same** commit. Added pre-commit and CI range enforcement; no branch/production/runtime change.
- Five isolated negative-index cases PASS: missing checkpoint, handoff, Worklog, stale source digest and API Code Map; staged positive check PASS. Deliberate omissions returned `COMMIT_BLOCKED` and Vietnamese instruction to add checkpoint + handoff + docs.
- Publication is `LOCAL_ONLY / GITHUB_NOT_SYNCED` until protected `main` permits the commit. No unauthorized temporary branch.


## 2026-11-08 — Owner-authorized permanent work branch and CI bootstrap

- Receipt: 20261108-work-branch-ci-bootstrap
- Owner explicitly approved creation of exactly one `work` branch. It begins at existing local `main` commit `047c744` with all four pending checkpoint/handoff/governance commits; after initial CI it remains `work` (not deleted).
- CI push selector recognizes `work` and `main`; removed permissive `codex/**` source push entry. Protected `main` remains stable, requiring `baseline-required` PASS for promotion; no future branches without fresh Owner approval.
- Change is Git governance/workflow only, not a runtime, database, Agent, Wall or installer change.


## 2026-11-08 — Work CI inherited codex branch-selector assertion

- Receipt: 20261108-work-ci-selector-regression
- GitHub `work` first CI run 42487422841 confirmed the new commit truth gate and backend integration, but Desktop Web and Windows full-installer workflows both failed at the **same inherited** source packaging test because its expected CI push selector was `codex/**`. The Owner-authorized `work` branch must be the only development trigger alongside protected `main`.
- Corrected that test expectation while preserving the installer/Agent/Wall/RM assertions. Staged in the same commit with checkpoint, handoff, Worklog and generated docs status. No branch addition or runtime changes.


## 2026-11-08 — Permanent work branch, full CI PASS and main fast-forward

- Receipt: 20261108-work-ci-success-handoff
- `work` remains the single Owner-authorized development branch; `main` is the protected stable baseline. No new branches after creating work.
- Verified exact work source commit `4ad70f9541d86c074e6f4c8b37c05196beda6ed2` with CI [42487968019](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42487968019) `baseline-required=PASS` (truth, Core integration, Desktop Web, Windows full installer smoke, native macOS/Linux).
- Protected main accepted a non-forced fast-forward to the same work commit. Four earlier local-only commits were thereby synchronized to official GitHub. No production, installed Owner app, Agent/Wall or database deployment changed.
- This closing documentation receipt updates canonical checkpoint/handoff in one commit and has its own docs-scoped CI before final main synchronization.


## 2026-11-08 — Old VPS-ARM source and backups cleaned after archiving

- Receipt: 20261108-legacy-fs-cleanup-v1
- GitHub old repository verified archived. From 73 old registered worktrees (12 dirty), preserved all local refs in Git bundle, six tracked diffs, 47 unique non-build untracked files and 503 historical handoff/evidence/config files in checked private snapshots under Unified, not in new Git.
- Removed 27 historical source/backup/artifact locations, 503 individual handoff files, 24 dangling symlinks and two Gold UAT caches. Net `7.235 GiB` reclaimed (`5.43 to 12.66 GiB` free), no deletion errors.
- Active Device Agent and release-sync timer were preserved. Old systemd service unit could not be edited on a read-only filesystem; two compatibility symlinks were retargeted to Unified source and staging. Existing failed release-sync service status not corrected. Other projects and live `/opt`/config/state remained untouched.


## 2026-11-08 — Legacy cleanup verified/published on protected main

- Receipt: 20261108-legacy-cleanup-promotion-closure
- GitHub `work` commit `e6338e12` passed CI run 42491303164 `baseline-required=PASS`; the same commit fast-forwarded to protected `main` without force or new branch. Checks covered truth/docs and commit integrity; native Windows/macOS/Linux jobs were intentionally skipped for docs-only changes.
- Cleanup completed and private local recovery snapshots remain within Unified. Device Agent and release-sync timer still active; historical old source/backup directories outside Unified removed. This is the final documentation-only closeout, not a runtime deployment.
