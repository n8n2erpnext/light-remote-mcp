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
