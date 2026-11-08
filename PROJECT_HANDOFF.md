# Project handoff — clean baseline complete

Read PROJECT_TRUTH.md and MASTER_CHECKPOINT.json first. Official repository: n8n2erpnext/light-remote-mcp, **new ID 1450214328**. Initial root aa378ba has no historical parent; verified build source `c03b50f4328e07138f350532c31dfc8b260311ce` passed [CI 9/9](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42475715858). Current checkpoint commits may contain documentation/evidence only; installer manifest identifies its exact compiled source, never assume the newest documentation commit was rebuilt.

All source writes use Git-over-SSH from ARM. main requires baseline-required from GitHub Actions, including admins, and blocks force-push/deletion. The Owner authorized one permanent `work` development/CI branch on 2026-11-08; the protected `main` is the stable baseline. **No other branch may be created without a new explicit Owner approval.** If main blocks publication because baseline-required is unavailable, preserve the local commit and report the blocker. Run relevant checks without bypassing branch protection. Product source changes must update current truth/checkpoint. Native apps build in Actions; builds and deployment candidates identify exact GitHub commit/tree and artifact hashes.

New independent runtime: `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/conversion-20261108/runtime-from-github-c03b50f432`, candidate `lru-c03b50f432-114436`. After successful new CI and artifact verification, it fetched the official GitHub commit and passed 21 real backend/Agent checks. It is internal-only, with private synthetic accounts, certificates and state; no public/host ports. Inspect actual Docker labels/state for liveness; dev.py status only prints its last receipt. Do not upload .unified, credentials, raw logs or signing keys.

The former repository is [read-only archive ID 1361698660](https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108); ARM old worktrees/runtime and audited snapshot b250908 remain frozen references. Backup Git/release/artifact/settings restore receipts are under the private ARM recovery/conversion roots. Available admin credentials lacked delete_repo, so rename plus new-repository creation preserved old history outside the official development repo. No force-push, old-history import or old runtime overwrite occurred. Never pull/push the new unrelated history from old worktrees.

Current CI requires no repository/environment secrets. No secret or variable existed in the exported old repository/environments. Historical environments/automation were retained in the archive, not copied into the new baseline. Org policy settings were not changed. Obtain signing/deployment secrets only from legitimate authorized sources when a future workflow needs them.

Next product work: controlled transport/isolated Windows state for one authenticated native acceptance with this backend; finish local SSO bootstrap and signed B-command flow. Existing 4dddf511 physical evidence remains scoped to its old artifact. Continuity hooks/DACL, legacy extension/RC50/Guest wiring, full Mac/Linux installers, full endpoint schemas and merging the two main EXEs remain explicit backlog. See KNOWN_ISSUES.md and ROADMAP.md.

Preserved signed beta client feed is legacy 0.9.0-rc.47 (external asset URLs); Fleet Wall feed 0.9.0-rc.31 points to a historical GitHub release at the reused name. Signed bytes were not rewritten or re-signed. New 0.10.0 output is a CI candidate only. Plan a controlled signed-feed/release migration before offering upgrades; no automatic feed promotion, production cutover or old archive retirement is authorized by this source conversion.

## Windows LightRemote.exe consolidation handoff

Read [the existing T12 implementation plan](docs/plans/windows-single-primary-exe/LIGHT_REMOTE_CORE_EXE_CONSOLIDATION_PLAN_20261107.md) and [its scope/coverage index](docs/plans/windows-single-primary-exe/README.md). It contains the updater compatibility/bridge-release sequence, Rust headless host port, task/package/Job Object changes, feature-preservation gates and performance measurements. Owner requested publishing this plan only in this task. Consolidation implementation/native build/physical acceptance remain NOT_STARTED/NOT_BUILT/NOT_RUN; Node and the permitted helpers stay separate. Historical T11 Node-embedding advice is superseded.

## Unified documentation continuation

Start at [Project Book](docs/project-book/README.md), [Code Map](docs/project-book/LIGHT_REMOTE_CODE_MAP.md), [Worklog](docs/project-book/LIGHT_REMOTE_WORKLOG.md) and the single [MASTER_CHECKPOINT](MASTER_CHECKPOINT.json). These were authored from the unified new repository; the archived Gold Project Book is historical. For meaningful source changes keep root truth, checkpoint, and one cumulative Worklog consistent; regenerate/validate via npm run docs:refresh and npm run check:docs. No new branches of any kind without explicit prior Owner approval.

## Task-continuity operating rule — 2026-11-08

This is the **only rolling project handoff**. Together with the single root `MASTER_CHECKPOINT.json` and cumulative `docs/project-book/LIGHT_REMOTE_WORKLOG.md`, it must be updated at completion of **every task** and **each meaningful completed step in multi-step/long-running work**. Record objective, status, exact Git source/tree/published vs local-only status, actual runtime, evidence scopes, blockers/regressions, rollback baseline and the next action. Never rely on a dated historical handoff as new-repository source truth.

### Current governance task — handoff/checkpoint cadence

- DONE: inspected existing single-checkpoint, Worklog and Project Handoff conventions; identified missing mandatory **after-task and after-subtask** continuity cadence.
- DONE: updated README, AGENTS, Library Rules and this rolling handoff to enforce after-each-task/step receipts without new handoff/checkpoint copies.
- SOURCE: documentation/governance only; no application runtime, API contract, database, Wall, Agent or Owner physical acceptance affected. Version remains 0.10.0-dev.1.
- GIT: work carried out on existing `main`; pending governance commit will be local-only until GitHub accepts it. Earlier local commits `0c4cb98` and `fd25174` remain ahead of protected `origin/main`, not published.
- BLOCKER: protected GitHub main requires `baseline-required` before direct push. No new branch is permitted without Owner approval.
- NEXT: continue development from the canonical source and preserve/resolve the protected-main publication block without bypass. For every future task/subtask, update this file and the single checkpoint with exact results.


## Task Receipt: 20261108-atomic-commit-sync-gate-v1
- Status: DONE_LOCAL — atomic code/docs/Checkpoint/Handoff gate implemented and staged, pending publication on protected GitHub main.
- Source: Existing main `f0e6581314178f8b0bcf85e43f44e35eeb7f946c` before this commit; post-change exact staged Git-blob source digest in `MASTER_CHECKPOINT.json`. Scope: `deploy/unified/commit-sync-gate.mjs`, `.githooks/pre-commit`, `.github/workflows/ci.yml`, `package.json` and canonical project governance documents.
- Verification: local Node syntax, 5/5 isolated Git-index negative cases blocked correctly (checkpoint, handoff, Worklog, stale source digest, missing API Code Map), staged positive gate PASS, Project Truth/Docs PASS; CI per-commit range verification to follow commit; GitHub CI not yet run for this unpushed commit. No runtime, Agent, Wall, DB, production or physical Owner acceptance claims.
- Next: keep protected-main publication limitation explicit. Do not create a workaround branch without Owner authorization. Every subsequent commit must contain one fresh matching task receipt, checkpoint, Worklog and required docs; CI must validate every new commit.
- Rollback: `checkpoint/20261108-before-atomic-commit-gate` at `f0e6581`; revert with preserved history if the new policy is rejected.


## Task Receipt: 20261108-work-branch-ci-bootstrap
- Status: INTEGRATION_PENDING_CI — Owner explicitly authorized creating one `work` branch and keeping it permanently as development/CI branch.
- Source: `work` created at `047c744c24becb58fafce80d336ccd4d674bdc34`, from existing local `main` with four earlier local-only commits. This task modifies CI push selector and canonical Git/branch instructions only; product runtime stays unchanged.
- Verification: source and checkpoint verified before edit; commit-sync pre-commit and project-book checks are mandatory, CI must PASS `baseline-required` before promotion to `main`. Live CI outcome NOT_TESTED before push; do not claim success prematurely.
- Next: publish `work` via configured Git-over-SSH; inspect GitHub CI `baseline-required` and then fast-forward protected `main` if allowed. Keep `work` as the sole active development branch, no others.
- Rollback: pre-branch source baseline `047c744`, earlier gate checkpoint tag `checkpoint/20261108-before-atomic-commit-gate`; no source history rewrite or production changes.


## Task Receipt: 20261108-work-ci-selector-regression
- Status: DONE_LOCAL_CI_PENDING — targeted correction of one obsolete branch-selector expectation in Desktop packaging contract test.
- Source: published `work` commit `6207e696b24fb6575ee90d3dd087096f9430dddf`. Changed only `client/desktop-v4/e2e/tauri-production-packaging-contract.mjs` and required checkpoint/handoff/docs in this task.
- Verification: CI 42487422841 `truth` PASS, Core PASS, Desktop Web FAIL and Windows complete-installer FAIL on the **same** hardcoded `codex/**` matcher; earlier installer/Agent/Wall/RM steps succeeded. Targeted assertion checks and commit integrity must pass locally. A new GitHub CI run remains NOT_TESTED until push.
- Next: push to existing `work`, verify new `baseline-required` PASS, fast-forward protected `main` when allowed, keep `work` as sole permanent development branch.
- Rollback: controlled revert of this isolated test correction if necessary, no runtime/DB/Agent/Wall changes.


## Task Receipt: 20261108-work-ci-success-handoff
- Status: DONE — Owner-approved `work` branch created, published and retained as permanent working branch. Full CI run [42487968019](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42487968019) completed SUCCESS at source `4ad70f9541d86c074e6f4c8b37c05196beda6ed2`.
- Source: before this closing documentation receipt, GitHub `main` and `work` both point to the same CI-verified `4ad70f9541d8` commit. Four previously local-only governance commits and targeted Desktop branch-contract correction are published; no source code left stranded on VPS-ARM.
- Verification: Github CI `baseline-required` PASS, including truth/atomic checkpoint gate, Core PostgreSQL/Redis, Desktop Web, Windows installer/install/update/rollback/uninstall, macOS and Linux native source checks. This is CI evidence only; no new physical Owner or production acceptance claimed.
- Next: keep `work` checked out for future tasks. Publish this docs-only final checkpoint/handoff receipt to work, verify its scoped CI, and fast-forward the docs-only commit to protected `main`; then continue features on work with full checkpoint before each task. No new branches.
- Rollback: tagged pre-change baseline `checkpoint/20261108-before-atomic-commit-gate`; verified stable `4ad70f9541d8`. Revert later work commits instead of force-pushing; no old runtime/DB/Agent/Wall changes.


## Task Receipt: 20261108-legacy-fs-cleanup-v1
- Status: DONE_LOCAL_VERIFIED_CI_PENDING — owner-authorized historical Light Remote files outside Unified removed after preserving local-only Git history and uncommitted deltas.
- Source: canonical `work` remains at pre-task `041bbb2b9b4816aaa539d87ae891ad62dc37e3c3`. Deleted 5 source paths (73 registered worktrees), 16 backup paths, 6 artifact paths, 503 old handoff/evidence files, 24 dangling symlinks and 2 Gold UAT generated caches. New source code not modified.
- Verification: archived old GitHub repo verified; private Git bundle verify PASS, three SHA256 checks PASS, 47 untracked source files and six tracked changesets preserved. Recovered net `7.235 GiB` (`5.43 → 12.66 GiB` free). Device Agent and release-sync timer active, compatible symlinks point into Unified. Existing release-sync service failure remains and is not represented as PASS.
- Next: publish this cleanup checkpoint/handoff/Worklog/docs as one atomic commit on `work`, run baseline-required CI, promote verified commit to protected `main`. Retain private archives off GitHub and continue all development under Unified only.
- Rollback: `checkpoint/20261108-before-legacy-fs-cleanup` and the private old refs bundle, uncommitted source delta tar and historical handoff tar under Unified legacy-preservation-20261108.


## Task Receipt: 20261108-legacy-cleanup-promotion-closure
- Status: DONE_PROMOTED — historical Light Remote cleanup completed; previous cleanup receipt commit `e6338e12d7c6432719f27505dd658c7b99cb4df9` passed GitHub `baseline-required` in run 42491303164 and fast-forwarded into protected `main`. `work` is retained as permanent development branch. This final docs-only receipt itself is pending separate CI.
- Source: `main` and `work` both verified at `e6338e12d7c6432719f27505dd658c7b99cb4df9` before the closing docs-only commit. Canonical source code unchanged, no new branch.
- Verification: CI truth and baseline-required PASS (native build jobs skipped as documented-only), 27 old directories/artifact paths removed, 503 old handoffs archived/removed, 24 symlinks removed, SHA256/Git bundle verified. Agent and release-sync timer active. Release-sync service remains pre-existing failed, no production or Windows physical acceptance claimed.
- Next: push this final docs-only receipt on `work`, confirm `baseline-required` PASS, fast-forward protected `main` and leave `work` checked out, with clean Git tree; next feature starts with full checkpoint.
- Rollback: `checkpoint/20261108-before-legacy-fs-cleanup`, private `legacy-preservation-20261108` recovery artifacts under Unified.


## Task Receipt: 20261108-release-asset-cache-cleanup
- Status: DONE_LOCAL_CI_PENDING — deleted only the 372 historical downloaded release asset blobs inside Unified `recovery/release-assets/objects` after 421/421 GitHub archive SHA-256/size metadata match and a real HTTP 206 asset-download check.
- Source: active `work` baseline `120b48b6ff1d2545af48ea06d102aa2dbde94f87`; application code, Agent, Wall, Owner Windows install and production runtime untouched. Evidence only in Unified `recovery/release-assets/{manifest.json,VERIFICATION.json,verification.jsonl,LOCAL_OBJECTS_REMOVED.json}`, outside source Git checkout.
- Verification: deletion target absent, 372/372 matched manifest before removal, no service reference detected, disk reclaimed `14,442,455,040 bytes (13.451 GiB)`; `df` now reports ~39 GB free / 69% used. The historical `VERIFICATION.json` PASS is a **pre-removal check**, not local presence after removal.
- Next: publish atomic docs/checkpoint/handoff/Worklog receipt on existing `work` and require GitHub `baseline-required` PASS before fast-forwarding protected `main`. Keep only the one approved work branch. If old releases are needed, fetch the specific asset from archived GitHub repository.
- Rollback: regenerate recovery objects by downloading corresponding archived GitHub Release assets according to the preserved manifest/digests; don't restore the 13.45 GiB cache without a concrete need.

## Task Receipt: 20261108-oneexe-p0-full-checkpoint
- Status: DONE_BASELINE / IN_PROGRESS_IMPLEMENTATION — Owner now authorizes implementing T12, rather than publishing its proposal only. Work stays on existing `work`; protected `main` remains stable.
- Source: clean `c8d308c82d17b5a4052163377d23f4514da6db02`, tree `4616c83adb7ba9af2eaebdfd0d0e4003d49155d4`; annotated tag `checkpoint/20261108-before-lightremote-exe-c8d308c` pushed before changes. Merge only the two primary Windows EXEs into root LightRemote.exe; retain Node/RM/updater/helpers and identities.
- Verification: full Git bundle SHA-256 `003fe1165b7465b79e49c6f330eaf558cb7593bcb089eccf71757ce99f8d557d`; independent restore/full fsck PASS. No new native build, physical acceptance, application/runtime/DB change yet. Existing baseline CI/physical claims are unchanged.
- Next: inspect current headless/bridge/managed-process/update contracts, then implement updater compatibility and Rust host on work; keep intermediate receipts atomic and promote only verified source.
- Rollback: tagged exact pre-change source and private bundle under approved Unified implementation/checkpoints; no old-runtime overwrite or database migration.

## Task Receipt: 20261108-oneexe-p1-inprocess-host-poc
- Status: IMPLEMENTED_POC / NATIVE_CI_PENDING — current caller inventory completed. Native Windows source now has a fixed-path in-process component adapter and early headless mode dispatch; the current full installer layout is intentionally not switched in this proof step.
- Source: existing work `a7f42ebeeb5a5731524cbff23c49bb33487ed60c` before this commit; exact staged source digest is stamped in the checkpoint. New `windows_host.rs`, `LightRemote.WindowsHost` class-library project/exports, shared Desktop JSON response path, native-root path binding and private-runtime build/test scripts; no new Git branch.
- Verification: native tray/lifecycle/endpoint source regressions PASS on Windows and ARM, PowerShell parse PASS. Windows native build and executable fixture tests pending CI: no managed assembly entry point, invalid global DOTNET_ROOT, same native process, WMI, response allowlist, Unicode/stdio/exit codes, Job Object cleanup, supervisor crash/backoff/profile/RM/native-A/B environment. No Owner physical/live-backend or production assertion.
- Next: verify the new Windows proof, then implement updater/rollback compatibility and switch only the primary product's installer/task/entry paths. Node, RM, helper isolation, enrollment, state/vault identity and public update-feed HOLD stay intact.
- Rollback: full annotated checkpoint `checkpoint/20261108-before-lightremote-exe-c8d308c`; revert work commits if necessary, no existing runtime/database changes.

## Task Receipt: 20261109-oneexe-p2-compatibility-helper
- Status: IMPLEMENTED_COMPATIBILITY / CI_PENDING. The in-process core proof at `9248b2925ad87d91ae86fb21d693240fbc8bae5d` has CI9/9 PASS (run42501889183). This bridge candidate remains the legacy two-core install layout and carries the new independent dual-layout helper.
- Source: work after `9248b2925ad87d91ae86fb21d693240fbc8bae5d`, candidate0.10.1-dev.1. CoreLayout permits only fixed product/profile/layout names; updater health/relaunch/recovery and AOT watchdog select the matching core, including older VERSION after rollback. Full updates quiesce exact installed GUI/core/Node files. Agent-only restart uses a bounded same-core stop role that verifies executable, parsed argv, user SID and creation time; another same-name role/GUI is excluded. Background GUI relaunch avoids raising an existing window.
- Verification: four native lifecycle/tray/endpoint/version source checks PASS. New executable layout fixtures and actual WMI owned-stop isolation are CI_PENDING; no physical Owner/backend assertion. Package and runtime not switched yet.
- Next: retain the verified bridge installer by exact source/version/hash; switch the following candidate0.10.1-dev.2 to LightRemote.exe, then test fresh/reinstall/bridge upgrade/rollback and task/GUI preservation.
- Runtime: no existing ARM or Owner Windows installation changed; public update feed HOLD. Full checkpoint/tag remains checkpoint/20261108-before-lightremote-exe-c8d308c.

## Task Receipt: 20261109-oneexe-p2-bridge-recovery-layout
- Status: BRIDGE_IMPLEMENTED_NATIVE_CI_PENDING. Prepare reversible fixed-name installer/task layout support, exact runtime quiesce and legacy rollback cleanup while keeping the bridge installer on its old two-core layout. Fix the WMI compile namespace caught by CI.
- Source: work after `ed10983d5d0fbc18d018135612cb1cc13942e2bd`, candidate0.10.1-dev.1; exact source digest is stamped atomically. Installer supports a dormant SinglePrimaryExe define but this bridge workflow does not enable it. No production package/layout or feed switch yet.
- Verification: CI42503527848: helper dual-layout executable fixture PASS, portable/core/browser/macOS/Linux PASS; Windows hosted proof failed compilation due ambiguous EnumerationOptions and WMI constructor binding, now explicitly qualified. Source regressions run before commit; full native bridge rebuild pending, not physical acceptance.
- Next: Verify this compatibility bridge CI and retain its exact installer/hash; then switch candidate0.10.1-dev.2 primary package and prove real bridge upgrade, rollback and fresh/reinstall lifecycle.
- Runtime: no existing ARM/Owner Windows install or public feed changed. Full checkpoint checkpoint/20261108-before-lightremote-exe-c8d308c remains the recovery reference.
