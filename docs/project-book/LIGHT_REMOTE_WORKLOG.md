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


## 2026-11-08 — Removed redundant historical release asset blobs

- Receipt: 20261108-release-asset-cache-cleanup
- Explicit Owner-approved cleanup of `recovery/release-assets/objects`, holding 372 content-addressed objects for 421 asset records across 22 old Light Remote releases. Not source code; old SHA-256 verification archive created by earlier source-unification/recovery audit.
- All 421 remote GitHub Archive release assets matched metadata SHA-256 and byte size; real archived asset HTTP Range GET returned 206. No direct runtime refs to local objects were found.
- Deleted precisely the 372 local blob files; retained small manifest and old verification reports plus explicit `LOCAL_OBJECTS_REMOVED.json` outside Git to prevent misreading verification as current file presence.
- Freed `13.451 GiB` (14,442,455,040 bytes). Disk usage 80% → 69%, about 39 GB available. No source, active release, production service or alternate backups changed.

## 2026-11-08 — primary Windows EXE implementation baseline

Receipt: 20261108-oneexe-p0-full-checkpoint

Owner authorized implementing T12. Full annotated tag `checkpoint/20261108-before-lightremote-exe-c8d308c` at c8d308c and independently restored Git bundle PASS. Only existing work branch is used; main remains stable. Baseline checkpoint DONE, caller inventory IN_PROGRESS; native consolidation build and physical acceptance NOT_RUN. Next: port compatible updater/host contracts without changing Node, RM, data identities or live runtime.

## 2026-11-08 — in-process Windows host proof implementation

Receipt: 20261108-oneexe-p1-inprocess-host-poc

Implemented a Tauri/Rust native hostfxr adapter and framework-dependent WindowsHost DLL reusing existing WMI, Job Object, supervisor and sanitized bridge logic. Private .NET frameworks are packaged for the prototype; no managed EXE is published. Three relevant source checks PASS. Native proof CI_PENDING; current installer remains the previous two-core layout. Next: actual native proof then updater/task/installer compatibility and switch.

## 2026-11-09 — compatibility helper before primary layout migration

Receipt: 20261109-oneexe-p2-compatibility-helper

Native PoC source9248b29 has CI42501889183 PASS9/9. Implemented fixed-name dual-layout updater/watchdog resolver, version-aware rollback, owned Agent-only stop and background GUI preservation. Candidate0.10.1-dev.1 is the compatibility bridge, not the final layout. Four source/version regressions PASS; executable helper/stop checks CI_PENDING. Next: bridge CI then one-primary packaging and real install/upgrade/rollback CI fixtures.

## 2026-11-09 — Complete compatibility bridge recovery and installer layout guards

Receipt: 20261109-oneexe-p2-bridge-recovery-layout

Prepare reversible fixed-name installer/task layout support, exact runtime quiesce and legacy rollback cleanup while keeping the bridge installer on its old two-core layout. Fix the WMI compile namespace caught by CI. CI42503527848: helper dual-layout executable fixture PASS, portable/core/browser/macOS/Linux PASS; Windows hosted proof failed compilation due ambiguous EnumerationOptions and WMI constructor binding, now explicitly qualified. Source regressions run before commit; full native bridge rebuild pending, not physical acceptance. Next: Verify this compatibility bridge CI and retain its exact installer/hash; then switch candidate0.10.1-dev.2 primary package and prove real bridge upgrade, rollback and fresh/reinstall lifecycle.

## 2026-11-09 — Fix locatable WMI identity for owned Agent stop

Receipt: 20261109-oneexe-p2-wmi-owner-stop-proof

Retain WMI instance paths for exact SID-verified Agent stop and update the installer regression to require all four fixed quiesce paths. CI42504277501 compiled the managed component, passed native layout and prior worker fixtures, then failed Agent-only stop. Reproduced InvalidOperationException with a read-only WMI self-process query; EnsureLocatable=true resolves it and returns matching owner/file/creation evidence. Core source gate failed only on its obsolete two-path quiesce literal, now updated to four. Full bridge CI rerun pending. Local broad suite was not a clean native environment: spawn EPERM, missing dependencies and no staged helper; it is not claimed PASS. Next: Verify bridge CI and archive its exact successful installer; then enable the primary layout and execute real fresh/reinstall/bridge upgrade/rollback proof.

## 2026-11-09 — Bind hosted component activation to the primary executable

Receipt: 20261109-oneexe-p2-explicit-primary-host-selection

Only LightRemote.exe may activate the hosted component or worker dispatch; the compatibility Desktop always uses its matching legacy core, including after rollback leaves supporting DLLs behind. Source lifecycle/endpoint/package regressions PASS before commit. This closes a rollback risk found while designing the real post-install failure fixture: DLL presence alone must never make an old Desktop opportunistically load a newer component. Existing SID/argv/creation checks and primary early worker dispatch remain unchanged. Exact native bridge CI pending; no physical acceptance. Next: Require final bridge CI PASS, pin and retain its exact installer/hash for migration testing, then publish the one-primary candidate with native install/upgrade/rollback tests.

## 2026-11-09 — Establish managed-role fixture readiness before Agent stop

Receipt: 20261109-oneexe-p2-other-role-fixture-stdio

Give the unrelated managed-worker fixture real inherited stdio pipes and require its child readiness before testing Agent-only stop isolation. CI42505457103 core/backend/browser/macOS/Linux PASS; Windows successfully compiled and passed owned Agent stop after EnsureLocatable, then the other-role assertion failed. The comparison worker had no redirected stdin/stdout/stderr and could fail its existing fail-closed handle contract before the stop call. The fixture now redirects all three, asserts readiness and verifies both wrapper and child survive. The isolation assertion remains required; native final bridge rerun pending. Next: Require final bridge full CI PASS, retain exact verified bridge installer, then run primary candidate packaging and real migration acceptance in hosted Windows.

## 2026-11-09 — Package one primary LightRemote.exe and prove native migration lifecycle

Receipt: 20261109-oneexe-p3-primary-package-and-migration

Switch the V4 complete installer to one root LightRemote.exe plus a private in-process WindowsHost component. Keep Node, RM V2 and independent recovery helpers separate. Add actual GUI/restart/fresh/reinstall/bridge upgrade/health-failure rollback/watchdog tests. Compatibility bridge e997e14 passed CI42506546750 (9/9), including native component/private runtime/WMI/stdio/Job Objects/supervisor/owned-stop isolation, legacy real install/update/rollback/uninstall and core/backend/browser/macOS/Linux. Downloaded artifact13627977718 ZIP and inner installer SHA-256 match exact source BUILD_MANIFEST and sidecar. Primary YAML, all41 inline PowerShell scripts, new standalone scripts and relevant source/version checks PASS parsing/source scope. Full primary native compile/install/migration CI_PENDING; no physical Owner/account/vault/B acceptance. Bridge prerelease retention upload is independently verified before final acceptance; feeds remain HOLD. Next: Require work full CI PASS including actual primary GUI private CLR and hidden-window restart, real bridge upgrade/reinstall/cross-layout health-failure rollback/watchdog tests; verify installer/source/hash manifest, then promote the verified source under baseline-required.

## 2026-11-09 — Verify watchdog recovery by commit evidence and preserve migration failures

Receipt: 20261109-oneexe-p4-watchdog-recovery-proof

Use observed failpoint/abort and actual native watchdog recovery as the postinstall-failure acceptance gate. Wait for watchdog completion before uninstall and preserve the original failure with recovery diagnostics. Report hosted-layout capability only for the compiled supported Windows profile. CI42509136055: native primary stage/install, private CLR in GUI with global DOTNET_ROOT disabled, shortcut/autostart, hidden GUI singleton/restart, independent helper, normal broken-update rollback and uninstall PASS. Actual bridge→primary upgrade, reinstall, controlled legacy downgrade, injected runtimeconfig health-failure rollback and legacy GUI isolation also reached PASS; cross-layout rollback report confirms success. Last manual watchdog fixture assumed nonzero exit, but Inno logged the injected ssPostInstall exception and abort while returning zero; premature cleanup then masked the original assertion with an active-watchdog recovery-root error. The fixture now waits for actual restored version/task/Wall and rollback_restore_wall_healthy, retains isolation assertions and preserves root errors. Parser PASS; full native rerun pending, no physical Owner acceptance. Next: Require full primary CI PASS including native manual watchdog recovery and clean fixture uninstall; verify final installer/source/hash, then promote under baseline-required and reconcile the single checkpoint/handoff.

## 2026-11-09 — Record Owner pause and exact running primary build handoff

Receipt: 20261109-oneexe-owner-pause-quota

Owner explicitly requested a quota pause: record the current single-primary implementation and let the already-running GitHub build finish without waiting for or acting on its result this session. At handoff, code source1fb8335a21d0a6716df2322c8ed6f19265421421 is published on work and CI42511023888 is IN_PROGRESS (https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42511023888). Its result is NOT assumed PASS. Prior trial727b841 CI42509136055 failed overall in the final watchdog test/cleanup, while primary fresh installation, private CLR in GUI, same-file task/shortcut/autostart, hidden GUI restart, bridge upgrade/reinstall, real health-failure rollback and legacy GUI isolation passed. The last code commit corrects the fixture to follow actual abort/watchdog recovery rather than exit code and preserves original failure/cleanup evidence; full native rerun pending. No Owner physical/account/vault/B acceptance or production runtime/feed change. Next: ONLY when Owner resumes after quota recovery: read README + MASTER_CHECKPOINT.json + this handoff; check CI42511023888 for exact source1fb8335 first. If FAIL, inspect primary migration progress/failure/recovery/watchdog proof artifact and fix on existing work with same-commit checkpoint/handoff/docs. If PASS, verify installer SHA-256, BUILD_MANIFEST and PRIMARY_EXE_MANIFEST/test scope, then finish verified promotion to protected main under baseline-required. Do not create branches, force-push, install on Owner Windows or cut over existing ARM runtime as part of this pause.

## 2026-11-09 — Resume build28 and wait for final PostgreSQL TCP readiness

Receipt: 20261109-oneexe-resume-build28-pg-readiness

Owner resumed the task after quota recovery. Build28 passed all Windows primary package, GUI, migration/rollback/watchdog and uninstall steps; its remaining failure was the isolated backend fixture accepting PostgreSQL's temporary Unix-socket bootstrap server. Wait for the final TCP listener before initialization SQL and add a startup-stage regression. Build28 / CI42511023888 source1fb8335: Windows job128823990554 PASS through all native/install/migration/watchdog/intake/manifest/upload steps; desktop web/macOS/Linux, lock, truth and all70 selected source groups PASS. Backend psql raced bootstrap shutdown and saw missing Unix socket. Official PostgreSQL17 image entrypoint confirms bootstrap is socket-only and stops before the final server. Two readiness tests PASS locally, and the startup-stage test demonstrably rejects the old Unix-only behavior. ARM unit regression runs before commit; new full exact-source CI pending. No Owner physical/account/vault/B acceptance or production changes. Next: Run the new work full CI from the corrected source; require backend/schema integration and all native gates PASS. Verify exact final installer/BUILD_MANIFEST/PRIMARY_EXE_MANIFEST hashes and proof, then promote only verified source to main under baseline-required.

## 2026-11-09 — Record verified single-primary build and reconcile project truth

Receipt: 20261109-oneexe-ci30-verified-candidate-closeout

Single-primary LightRemote.exe candidate0.10.1-dev.2 is implemented, full exact-source CI30 PASS9/9, installer/manifests independently verified on ARM and locally; compiled source promoted to protected main without force or policy changes. Node/RM/private DLLs/recovery helpers remain supporting components. Public binary prerelease is not published: automatic approval review requires explicit Owner authorization. Compiled source `31f23393aacb89b6d541cebb2cd0c2e1afa64538`, CI #30/42549642811; installer SHA-256 `aac78a063f0628eac2966052fa0cd9e6650b5c2c6a1deb5048939e9a7b83ab19`. Exact-source full CI30 PASS9/9: backend PostgreSQL/Redis integration, truth/lock, Windows primary package/install/GUI/private CLR/Agent restart isolation/real bridge upgrade/reinstall/forced health-failure rollback/native watchdog/uninstall, browser and native Mac/Linux source builds. Independently checked artifact ZIP digest, installer hash, embedded source/run/profile and all primary migration/lifecycle checks on ARM and after SSH transfer. Owner physical/account/vault/B acceptance NOT_RUN; signing trust, public feed promotion and existing runtime cutover are not claimed. No public binary release was created after the automatic approval rejection. This atomic documentation receipt does not rebuild the installer. Next: Obtain explicit Owner approval to publish the already-verified candidate installer and manifests as a publicly downloadable GitHub prerelease under windows/0.10.1-dev.2; then verify uploaded asset hashes without activating the product feed. Do not bypass the approval rejection. Continue development only on permanent work; physical Owner/account/vault/B acceptance and existing runtime migration remain separate future tasks.

## 2026-11-09 — Begin internal Desktop backend integration from verified source checkpoint

Receipt: 20261109-desktop-backend-contract-inventory

Owner clarified internal-only test artifacts, with no public binary release. Start actual Desktop/backend/Agent feature integration, Wall B regression investigation and displayed A/B/Desktop naming cleanup on permanent work. Verified full pre-change checkpoint and independent Git restore before edits. Baseline521d04c/tag checkpoint/20261109-before-desktop-backend-521d04c; bundle SHA2565f20de606764ca319b3bfd695c81dda0b08bacac6a3ac831bdc8405e222c2331, independent bare restore/fsck PASS. Read current README/AGENTS/Truth/checkpoint/map/handoff. Actual Windows installation reports0.10.1-dev.2 with root primary and neither old EXE. Source confirms Long Memory/Codex placeholder UI and same-origin /api/status fetch under Tauri. Actual ARM Lab Operator and Plugin serve separate STAGED0.9.0-rc.49 trees; Operator lacks desktop-v4-owner-snapshot.mjs and has Owner-auth/token flags0, Plugin has them1; no READ flag observed. This is confirmed deployment drift, not a conclusion that every backend source feature is absent. Wall B regression remains to reproduce, not marked fixed. Runtime: Read-only inventory only; no existing Agent/session/device enrollment, serving ARM runtime or installed Windows files changed. Internal-only artifact policy replaces the former public-release proposal. Next: Implement one verified native Desktop-to-local-Agent API using current Owner/account/device checks and existing module/controllers, wire actual Desktop reads and mutations with stale-response/CAS fences, then complete same-source backend candidate/real Wall B integration and internal Actions build. Keep technical credential/profile IDs compatible while removing version suffixes from displayed names.

## 2026-11-09 — Implement verified native device API and fix Memory startup and Desktop ACL gaps

Receipt: 20261109-desktop-native-device-api-foundation

Implemented the current Owner/account/device-bound native Agent API and explicit Tauri command/ACL for real local device/module/Memory/sync/Codex/session/job/log controllers. Corrected missing inventory-page ACL and fresh Memory usage schema initialization. Candidate version0.10.1-dev.3, internal testing only; Desktop provider/UI binding and coherent Lab rollout are next. Seven focused tests PASS locally across real SQLite and OS-private socket: modules OFF create no DB, module CAS preserves the other flag and data, immediate first Memory usage works, archive/restore persist, task edits/deletes reject stale versions, native dispatch denies wrong Owner/account/device/extra fields and identity rotation, sync changes recheck identity after async roster, native command ACL covers pagination, and operation contract matches native allowlist. The initial real SQLite test reproduced no such table lm_scopes; source fix initializes scoped schema before usage. Node syntax PASS. Native Rust/build and full regression are CI_PENDING, not inferred PASS. No physical Owner acceptance, serving runtime change or public binary publication. Runtime: Source implementation only; existing ARM Lab/production and installed Owner Windows runtime, credentials, grants and sessions unchanged. Candidate artifacts remain internal-only. Next: Inspect the exact work CI, fix any source/native regressions without weakening authority guards, wire the Desktop native device provider and actual feature controls, standardize displayed A/B/Desktop names, then complete real signed Wall B plus same-source internal backend integration before final internal installer verification.

All11 targeted tests PASS on ARM, including the unchanged A/B IPC authority checks. Initial ARM fixture run exceeded AF_UNIX pathname length because the mandatory workspace root plus temporary prefixes was too long. Only fixture prefixes/parent names and private TMPDIR under the approved root were shortened; production endpoint/102-byte guard and all authority checks remain unchanged.

## 2026-11-09 — Include native device API in Agent package and preserve scoped Owner fence checks

Receipt: 20261109-desktop-device-api-package-closure

Fix the P1 Agent package import closure: explicitly include both new native device API modules in client/core-files.json. Keep the original F14 Owner verification regression scoped to F14 and independently require the new device command to verify Owner before/after with an exact device for writes. CI35/42556313669 at c6d5735: Node units and web/native macOS PASS; full Core source suite and Windows pre-build crypto/package smoke FAIL because the two new static Agent imports were missing from the explicit packaging manifest. The old verification source assertion also counted the new command as part of F14. Both targeted source regressions now PASS locally; no authority assertion removed or production bypass. New full CI pending; P1 Windows native packaging is not yet PASS. Runtime: Source/package declaration only; installed Owner app and existing ARM serving runtime unchanged. Internal testing only. Next: Continue Desktop provider/control wiring and displayed A/B/Desktop naming cleanup while exact-source CI validates package closure. Then run real signed Wall B/coherent backend integration and verify the final internal-only installer; no public Release/feed.

## 2026-11-09 — Connect Desktop controls to the verified Agent API and unify displayed names

Receipt: 20261109-desktop-live-device-ui-binding

Replace static Memory/Codex shells and native relative URL reads with the current Owner/account/device-bound Agent API. Wire immediate CAS module toggles, actual Memory scopes/storage/sync/lifecycle, Codex tasks/runtime/login/delegation/observer, local session/job control and Settings/Cloud/logs. Display A/B and Light Remote Desktop; preserve technical profile/route/vault/mutex identities and old-window compatibility fallback. P1 exact source ccf79679 CI36/42556894256 PASS9/9, including Windows installed lifecycle, full backend and Linux/macOS native. New P2 React suite PASS112/112 (11 new regressions for Owner swap, stale confirmations, read backpressure, unconfirmed writes, real module controls and typed destructive confirmation). Production Vite build/typecheck PASS; targeted real SQLite/native operation contract and Owner verification source checks PASS. No credentials in React; exact expectedAccountId checked natively before effects. Final new native compilation/packaging/real signed Wall B/coherent ARM backend remain pending. Runtime: Source implementation only. Existing ARM Lab/production, Owner Windows install, identities/grants/sessions and update feeds unchanged. No public binary Release. Next: Validate exact P2 CI while adding a real signed Wall B and native device API integration flow against a coherent disposable backend. Correct reproduced faults, then verify a final internal-only exact-source Windows installer and prepare same-source ARM deployment without touching historical sources or Owner installation.

## 2026-11-09 — Verify both real B approval flows and classify known Wall rejections

Receipt: 20261109-signed-b-real-backend-coverage

Real coherent ARM disposable candidate proves MCP OAuth B issuance, signed Owner Wall approval, PostgreSQL durable grant and MCP attach; independent Account B also passes. Reproduced wrong B incorrectly returned as503. Preserve safe known rejection status/code at Wall and unknown transport outcome, with real HTTP regressions. Extend disposable CI acceptance to both B flows and real same-device native API/module/Memory/Codex/Settings. Initialize the missing private fixture MCP OAuth secret and explicitly enable native IPC in isolated DEV. Update two display-only source assertions to A/B while preserving all no-V1 authority checks. ARM exact P2 source d4efc68 private candidate real backend21/21 PASS. Additional actual OAuth/MCP/Wall/PG roundtrip and independent Account B PASS; wrong B observed503 (reproduced presentation error). New safe mapping HTTP regression and unified one-app source checks PASS locally, readiness2/2 PASS. CI37 web112/112, production bundle and Linux/macOS native PASS; Core/Windows stopped at two obsolete A/B V2 text regex assertions, updated without removing no-V1 checks. Extended whole-backend/native integration remains pending on the new commit. No existing runtime or Owner installation changed. Runtime: Only newly created label-owned disposable Docker resources under the approved ARM workspace were used. Old Lab, production, Owner app, real credentials/grants/sessions and public feeds untouched. Candidate OAuth secrets are synthetic, private and never committed. Next: Run exact-source extended isolated backend acceptance and full CI. Correct any reproduced cross-layer failures, verify internal installer/manifests, then prepare coherent Lab runtime migration from the tested GitHub source while preserving existing state and rollback.

## 2026-11-09 — Preserve explicit Agent start intent and isolate Owner rows during rendering

Receipt: 20261109-desktop-final-async-and-display-contracts

Prevent one-render old Owner inventory/activity disclosure by projecting pages against the current Owner/kind before effects; clear pending on signout. Add explicit idempotent native service-start/service-stop so a confirmed Start cannot toggle an independently started Agent off. Keep legacy service compatibility. Finish displayed A/B/Desktop naming in Portal, consent and MCP descriptions without changing protocol/profile/vault identities. Add UI race tests and installed Windows same-daemon Start acceptance. New targeted UI14/14 and typecheck PASS (Owner first-render swap and delayed Start added); previous112 UI tests, 25 real coherent backend integration steps PASS. Native explicit Start is CI_PENDING. Source714 CI38 passed Core extended backend, web and Linux/macOS; Windows compiled/installed/restarted GUI successfully, then external GitHub bridge-manifest download returned504 before migration. Rerun attempt2 is running; no product assertion removed. A new isolated Lab source/dependency tree714 is prepared with private unit/key/DB backups and read-only schema43 preflight PASS; existing serving Lab unchanged. Runtime: Old ARM source trees, actual Lab services/DB/Redis/identities/grants and Owner Windows installation unchanged. Only isolated candidates and private preparation/archive paths under approved root created. Private DB snapshot verified by pg_restore index, not falsely called full restore acceptance. Next: Require final exact-source full CI including explicit Start/native migration to PASS. Verify internal installer hashes, stage final GitHub source coherently in the already-backed-up internal Lab, validate backend API/health/state preservation and rollback, and close the single canonical checkpoint/handoff. No public Release or Owner installation change.
