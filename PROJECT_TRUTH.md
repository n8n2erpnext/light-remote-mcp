# Light Remote MCP — Project Truth

Current source candidate: **0.10.1-dev.5**, IMPLEMENTED_LOCAL_VERIFIED / **ACTIONS_NATIVE_INSTALLER_PENDING**. Owner installed dev.4 and reported Codex login/copy/model/usage gaps, inconsistent auth branding, long Agent IDs, blank PTY, a silent200-job ceiling and intermittent Desktop Close. The additional COMMAND/DANGER label layout is included. [Follow-up](docs/plans/desktop-user-experience/CODEX_WALL_FOLLOWUP.md) · [local evidence](docs/evidence/desktop-followup/LOCAL_VERIFICATION.json).

Codex login/code is now backend-derived on both surfaces, with explicit copy and automatic completion cleanup. Runtime models/reasoning are validated and saved locally for actual turns. Token counters deduplicate cumulative events and distinguish local observed work from reported account usage/quota; unsupported or stale telemetry remains explicit. Fast turn completion cannot be lost between the RPC response and notification. Native/device/CSRF checks are retained, including a recheck immediately before saving preferences.

Consent, Desktop callback and other affected auth entry pages use the canonical distribution mark/fonts. Callback contains no OAuth query/credential and makes no premature token-exchange success claim; its bounded loopback asset server serves only a fixed public font under strict Host/CSP checks. Native begin/restore/logout/browser launch leave the UI thread before mutex/vault/network work.

Wall now pages complete retained local JSONL/gzip history outside its RAM window, with opaque event cursors and count/byte bounds per page. A moving250 completed-job view keeps live ingestion advancing beyond200 and makes older retained work accessible. Existing disk retention, explicit clean and redaction stay intact. COMMAND/risk labels have their own first row; full Agent IDs are in tooltips/details. PTY tracks the producer grid, acknowledges paint before advancing read offsets, has a selectable transcript/replay/replacement-session path, accepts fixed shell aliases, and waits briefly for Windows ConPTY output/onExit before PID fallback disposes its worker.

Local selected backend/contract48 tests, Codex RPC regression, prior React124 plus9 changed-file tests, browser170 plus4 actual-server Wall scenario groups PASS. An isolated **real Windows ConPTY -> authenticated Wall HTTP** source harness PASS verifies executed marker/Unicode/offset EOF using the existing installed Node/native dependency. Missing native exit callback remains UNKNOWN, never fabricated exit0. The new Rust/Windows GUI/installer tests are **NOT_RUN until Actions**; no full physical dev.5 acceptance is claimed.

The last compiled/verified installer and current internal Lab Operator/Plugin remain dev.4/source947a117/CI45 as detailed below. Do not treat the new source or this receipt as a built/deployed dev.5. One LightRemote.exe layout, credentials and legacy rollback sources stay preserved; internal testing only, no public binary Release/feed.

Previous verified compiled baseline: **0.10.1-dev.4**, compiled GitHub source `947a11763161aca6856ffc1e8e18dc8fc446ede7`, tree `0ef2892ae2b8ecf253e35510548a1493673d21ee`, [CI45](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42628405851) **9/9 PASS**. One primary LightRemote.exe. All nine Desktop screens, account entry, linking, confirmation and browser consent now have user-facing layouts and copy; technical metadata is available on demand. Actual native APIs and security authorities are retained. [Acceptance](docs/evidence/desktop-user-experience/ACCEPTANCE.json).

The B input/button overlap and zero-padding populated tables have been removed. Overview reflects actual requests and work; sessions, devices and account have readable rows and filters; Memory uses project cards/sync controls; Codex has setup/tasks; Settings has working section navigation. Live Monitor prioritizes a friendly activity timeline and bounded10-row task history with show/load more. Unknown values stay unknown; a current Owner change clears previous B/device/account presentation before painting.

Validation is scoped: React121, consent/token36, synthetic browser170 across two themes and Windows150% DPI, real private backend25 (including both B flows/native API), Windows full installed lifecycle/real migration/rollback/watchdog and Linux/macOS native source checks PASS. Installer and ZIP/source/tree/run/profile/one-primary manifests were independently checked on ARM and after local SSH transfer. SHA256 `a59e94e98c2581def5a9f622a3551e57a9ecc2071f7994f5a30db3850729ad5e`. No new public Release or signed feed was published/promoted.

Internal Lab Operator/Plugin now run this same GitHub source from a new approved-root runtime directory. Private/public health and API header PASS; unauthenticated Owner snapshot401. Persisted account/device/grant/Owner counts stayed equal. Independent Agent/Wall, supervisor and mTLS PIDs/dependency graph and home ACL stayed unchanged. No SQL migration. Prior source2771f47/runtime and original legacy sources remain preserved. Private current config/key inputs and a pg_dump with a verified archive index are retained for recovery; a full DB restore test is not claimed.

The Owner installed dev.3 and reported functional UI, then rejected its technical presentation across all screens. This does not establish physical dev.4 acceptance. The new installer is available for internal Owner testing; Codex did not alter their Windows installation. Positive browser Wall SSO, full Mac/Linux installers, deeper physical features and legacy feed migration remain documented backlog. A documentation receipt after the pinned compiled source is not a rebuilt artifact.

Earlier entries below are historical. Current source/build/runtime evidence is this lead, the single Master Checkpoint, current acceptance and newest rolling Task Receipt. Official repository ID1450214328, permanent work and protected main policies remain unchanged.

## Documentation authority — 2026-11-08

The new [Project Book](docs/project-book/README.md), [Code Map](docs/project-book/LIGHT_REMOTE_CODE_MAP.md), [Worklog](docs/project-book/LIGHT_REMOTE_WORKLOG.md), generated [Source Catalog](docs/project-book/SOURCE_CATALOG.md) and [machine status](docs/project-book/PROJECT_TRUTH_STATUS.json) describe the unified codebase. The sole live checkpoint remains [MASTER_CHECKPOINT.json](MASTER_CHECKPOINT.json), not the old .light-remote checkpoint. Documentation checks do not mean native Owner acceptance or production release.


## Atomic commit continuity — 2026-11-08

The **new** [atomic commit gate](deploy/unified/commit-sync-gate.mjs) rejects any new commit unless its **staged contents in the same commit** include the [Master Checkpoint](MASTER_CHECKPOINT.json), [rolling Handoff](PROJECT_HANDOFF.md), [Worklog](docs/project-book/LIGHT_REMOTE_WORKLOG.md) and generated [docs status](docs/project-book/PROJECT_TRUTH_STATUS.json). A unique per-commit task receipt must match the handoff/worklog, and a SHA-256 of tracked Git source blobs must match the committed source tree. Security/API/Agent ownership changes require [Code Map](docs/project-book/LIGHT_REMOTE_CODE_MAP.md); contract changes also require [API Matrix](API_INTEGRATION_MATRIX.md); installer/build changes require [Build and Deployment](BUILD_AND_DEPLOYMENT.md).

The local Git pre-commit hook and GitHub Actions `truth` job enforce the same rule, with CI checking **each new commit in the pushed range**. Historical commits predating activation are not retroactively required to have receipts. This is an atomic documentation/source integrity gate, not evidence of physical acceptance or production readiness. Protected main, Owner-only branch permission and workspace root restrictions remain unchanged.

## Owner-approved work branch — 2026-11-08

Owner approved exactly one new branch `work`. It starts from local `main` at `047c744c24becb58fafce80d336ccd4d674bdc34`, containing the four verified-local governance commits awaiting publication. `work` remains the permanent development and CI branch, with `main` retained as protected stable baseline. CI push trigger now covers `work`; only a PASS `baseline-required` allows promotion to main. No other branch is authorized; no release/runtime deployment follows merely from this Git operation.

### Work CI bootstrap correction

GitHub `work` run 42487422841 verified `truth` and Core integration, but both Desktop Web and Windows packaging reached the same test that still asserted the abandoned `codex/**` branch namespace. The source test now enforces the authorized `main` + `work` controller and retains all other packaging assertions. This is a **test expectation alignment**, not a change to native packaging or product behavior.


### Owner-approved work branch verified

Run [42487968019](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42487968019) reported `baseline-required` success at `4ad70f9541d86c074e6f4c8b37c05196beda6ed2`. Protected `main` and permanent `work` both advanced to this source; the four previously local-only governance commits are now published. This closing docs receipt is a separate documentation commit and is not itself a native rebuild or physical Owner acceptance.


## VPS-ARM legacy cleanup — 2026-11-08

GitHub `n8n2erpnext/light-remote-mcp-archive-20261108` is confirmed archived. Before cleaning historical Light Remote directories outside Unified, 73 registered worktrees, local-only Git refs and 12 dirty worktrees were identified. Saved three private verified recovery artifacts inside `light-remote-unified-20261108/legacy-preservation-20261108/` (outside the Git checkout): `old-local-git-all-refs.bundle`, `old-uncommitted-source-deltas.tar.gz` and `old-private-handoffs-and-evidence.tar.gz`. Each SHA256 checked. See `cleanup-audit.json` in the private folder.

Removed 5 old source locations, 16 backup directories, 6 historical artifact paths, 503 archived old handoff/evidence files, 24 dangling source symlinks and two Gold UAT generated caches. Disk free `/home` grew from `5.43 GiB` to `12.66 GiB`, a net gain of `7.235 GiB`. Historical checkout paths are no longer active.

The current Unified Git source (`work` and protected `main`), deployed `/opt/gpt-operator-agent` runtime, configuration, local state and shared gpt-vps-bridge were preserved. Existing compatibility aliases `/home/ubuntu/light-remote-dev` and `/home/ubuntu/light-remote-release-staging` now resolve inside Unified. System release-sync unit is on read-only filesystem and was not edited; timer remains active, while the pre-existing release-sync service failure is **not** claimed fixed. No production rollout or physical acceptance is implied.


### Legacy filesystem cleanup publication receipt

GitHub run [42491303164](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42491303164) completed `baseline-required` PASS at `e6338e12d7c6432719f27505dd658c7b99cb4df9`. Verified non-forced fast-forward to `main` while retaining `work`. This documentation-only closeout follows the successful cleanup; it does not establish native/physical Owner acceptance, newly built binaries or working Cloudflare release-sync delivery.


## Unified legacy GitHub release-asset recovery cache cleanup — 2026-11-08

With explicit Owner approval, removed **372 local SHA-256 object blobs** from `light-remote-unified-20261108/recovery/release-assets/objects/`. This was a local recovery copy of **421 assets across 22 historical v0.9.x GitHub releases**, not active source or runtime.

Before removal: archived repository `n8n2erpnext/light-remote-mcp-archive-20261108` verified all 22 releases and **421/421 metadata records** with exact SHA-256 and byte-size equality; a direct download of `v0.9.0-rc.47/client-update-unsigned.json` returned HTTP 206. No service or running process reference to this local object directory found. The local manifest/verification files remain **historical evidence** only, annotated by `recovery/release-assets/LOCAL_OBJECTS_REMOVED.json` outside the Git checkout; local blobs no longer exist. Old manifest URLs need the archived repo name.

Reclaimed **14,442,455,040 bytes (13.451 GiB)** from the root filesystem; `df -h` reported 121G total, 82G used, 39G available (69%). Canonical Git source, release scripts, Windows Owner installation, deployed Agent/Wall, Docker/LXD, and runtime configuration were not touched. Historical GitHub Releases can be re-downloaded while the archive remains available. No new code/build or physical Owner acceptance is claimed.

## LightRemote.exe implementation — 2026-11-08

Owner authorized implementing T12 on the permanent work branch. Full pre-change checkpoint/tag at c8d308c is verified and recorded in MASTER_CHECKPOINT.json. Only GptOperator.Client.exe and desktop-v4/LightRemote.Desktop.exe are being unified; Node/RM/updater/helpers remain separate. Current step is caller/contract inventory; no new native build/physical acceptance or runtime cutover is claimed.

### Primary executable work — in-process component proof

On work, native early worker dispatch and an in-process WindowsHost DLL adapter are implemented for CI proof. Existing WMI/process containment/recovery and sanitized Desktop action code is reused. A framework-dependent library plus private .NET runtime is used per Microsoft hostfxr support, with no apphost or managed assembly entry point. Three source checks PASS; native proof/packaging migration/physical acceptance are pending. Stable main and existing runtime are unchanged.

### Single-primary work — bridge candidate

PoC work9248b29 passed CI42501889183 (9/9), including actual hosted Windows proof. Candidate0.10.1-dev.1 implements dual-layout helper/watchdog support and owned Agent-only stop; native compatibility checks pending CI. The primary installer switch is next. Stable main, runtime and public feeds remain unchanged.

## Complete compatibility bridge recovery and installer layout guards

Compatibility helper executable resolver fixtures passed CI42503527848. That run's hosted Windows component compile failed on an ambiguous WMI type; corrected source is submitted with installer/task layout guards and verified legacy rollback cleanup. Final bridge native rebuild and primary package switch remain pending.

## Fix locatable WMI identity for owned Agent stop

Bridge0.10.1-dev.1 remains pending a fully successful CI. Two failures in42504277501 are addressed: stale two-target installer regression and WMI projected object identity for GetOwnerSid. Native library compilation succeeded; no final package switch, Owner install or public feed promotion occurred.

## Bind hosted component activation to the primary executable

The final bridge adds explicit primary-executable host selection to prevent opportunistic DLL loading by a restored old Desktop. Current native bridge validation remains pending. The candidate primary layout and real migration fixtures are being prepared independently; no stable main or installed runtime has been changed.

## Establish managed-role fixture readiness before Agent stop

CI42505457103 passed core/backend and WMI-owned Agent termination; its other-role fixture failed without proving successful startup. The comparison worker now has valid pipes and explicit readiness. Final bridge CI and primary installer/real migration tests are still pending; main and existing installations remain unchanged.

## Package one primary LightRemote.exe and prove native migration lifecycle

The Windows compatibility bridgee997e14 passed full CI42506546750 (9/9) and its exact installer/artifact hashes were verified. The official V4 candidate now implements one root LightRemote.exe with an in-process WindowsHost library/private runtime, independently preserved Node/RM/helpers, and exact old-primary cleanup. Candidateversion0.10.1-dev.2 is FULL_NATIVE_CI_PENDING. Real installed GUI/restart and bridge/failure/rollback/watchdog acceptance are part of that CI, not inferred from source tests or from the bridge. Stable main, existing ARM/Owner runtime and public feeds remain unchanged at this receipt. Physical Owner/vault/account/B acceptance remains NOT_RUN.

## Verify watchdog recovery by commit evidence and preserve migration failures

The first primary full trial42509136055 proved the single executable native installation/GUI/restart and actual bridge/reinstall/health-failure rollback paths. Overall CI failed in the manual watchdog test's exit-code assumption and subsequent premature cleanup. Corrected proof now follows real transaction/watchdog evidence and preserves original failures. Source is still work-only, not released or promoted; Owner physical acceptance NOT_RUN and feeds HOLD.

## Record Owner pause and exact running primary build handoff

Owner pause on2026-11-09 due quota. Single-primary candidate source1fb8335a21d0a6716df2322c8ed6f19265421421 is on work, CI42511023888 was running at handoff; no PASS/final release/main promotion is asserted. The build is left running. Resume only after a later Owner request, starting with that exact run and its native migration evidence. Stable main is c8d308c; existing ARM/Owner installations and public feeds remain unchanged.

## Resume build28 and wait for final PostgreSQL TCP readiness

Owner resumed build28 after quota. All selected Windows primary executable/migration/watchdog/uninstall gates passed in run42511023888; core source tests and other native/browser jobs also passed. Overall run failed on PostgreSQL bootstrap readiness in the isolated integration fixture. A final-TCP readiness correction and regression are implemented; new full CI remains pending. Work is published while main stays c8d308c, existing ARM/Owner runtime remains unchanged and physical Owner/vault/account/B acceptance remains NOT_RUN.

## Begin internal Desktop backend integration from verified source checkpoint

Owner clarified internal-only test artifacts, with no public binary release. Start actual Desktop/backend/Agent feature integration, Wall B regression investigation and displayed A/B/Desktop naming cleanup on permanent work. Verified full pre-change checkpoint and independent Git restore before edits. Baseline521d04c/tag checkpoint/20261109-before-desktop-backend-521d04c; bundle SHA2565f20de606764ca319b3bfd695c81dda0b08bacac6a3ac831bdc8405e222c2331, independent bare restore/fsck PASS. Read current README/AGENTS/Truth/checkpoint/map/handoff. Actual Windows installation reports0.10.1-dev.2 with root primary and neither old EXE. Source confirms Long Memory/Codex placeholder UI and same-origin /api/status fetch under Tauri. Actual ARM Lab Operator and Plugin serve separate STAGED0.9.0-rc.49 trees; Operator lacks desktop-v4-owner-snapshot.mjs and has Owner-auth/token flags0, Plugin has them1; no READ flag observed. This is confirmed deployment drift, not a conclusion that every backend source feature is absent. Wall B regression remains to reproduce, not marked fixed.

## Implement verified native device API and fix Memory startup and Desktop ACL gaps

Implemented the current Owner/account/device-bound native Agent API and explicit Tauri command/ACL for real local device/module/Memory/sync/Codex/session/job/log controllers. Corrected missing inventory-page ACL and fresh Memory usage schema initialization. Candidate version0.10.1-dev.3, internal testing only; Desktop provider/UI binding and coherent Lab rollout are next. Seven focused tests PASS locally across real SQLite and OS-private socket: modules OFF create no DB, module CAS preserves the other flag and data, immediate first Memory usage works, archive/restore persist, task edits/deletes reject stale versions, native dispatch denies wrong Owner/account/device/extra fields and identity rotation, sync changes recheck identity after async roster, native command ACL covers pagination, and operation contract matches native allowlist. The initial real SQLite test reproduced no such table lm_scopes; source fix initializes scoped schema before usage. Node syntax PASS. Native Rust/build and full regression are CI_PENDING, not inferred PASS. No physical Owner acceptance, serving runtime change or public binary publication.

## Include native device API in Agent package and preserve scoped Owner fence checks

Fix the P1 Agent package import closure: explicitly include both new native device API modules in client/core-files.json. Keep the original F14 Owner verification regression scoped to F14 and independently require the new device command to verify Owner before/after with an exact device for writes. CI35/42556313669 at c6d5735: Node units and web/native macOS PASS; full Core source suite and Windows pre-build crypto/package smoke FAIL because the two new static Agent imports were missing from the explicit packaging manifest. The old verification source assertion also counted the new command as part of F14. Both targeted source regressions now PASS locally; no authority assertion removed or production bypass. New full CI pending; P1 Windows native packaging is not yet PASS.

## Connect Desktop controls to the verified Agent API and unify displayed names

Desktop now uses authenticated same-device native Agent state and controls, not renderer-relative /api/status in Tauri. P1 exact-source CI36 PASS9/9; P2 new UI tests112/112 and production web build PASS. This is source implementation, not deployed backend alignment or Owner physical acceptance. Current live ARM Lab still serves disparate rc49 trees; signed Wall B end-to-end verification and coherent internal backend are next. Internal artifacts only.

## Verify both real B approval flows and classify known Wall rejections

Exact d4efc68 coherent disposable ARM backend21 checks PASS; additional real MCP OAuth issuance -> signed Agent Wall B -> PG durable grant -> MCP attach PASS, and independent Account B PASS. Therefore EXE consolidation alone is not proven to break B. Wrong B was reproduced as503; safe source classification now returns known decisions and retains unknown-outcome behavior for transport errors. The existing mixed rc49 Lab remains unchanged. Extended CI now exercises the native device API against real backend authentication too.

## Preserve explicit Agent start intent and isolate Owner rows during rendering

Current-source coherent ARM backend25/25 PASS includes real signed B in Wall and Account, native Owner-bound Agent IPC, module CAS/SQLite/Codex/Settings; wrong B400. Final UI guards now prevent old Owner rows during the first render before effects, and native Desktop Start/Stop carry explicit intent. Installed Start no-op regression is added to full Windows acceptance. Label cleanup also covers Portal consent and MCP metadata. Existing Lab is prepared/backed up, not yet switched.

## Read pinned migration bridge assets through bounded authenticated GitHub API intake

Final product source35eb962 passed coherent ARM backend25/25. CI38 attempts1/2 were blocked by GitHub504 downloading the existing pinned bridge installer/manifest before migration; no failed assertion was removed or recategorized as PASS. Hosted CI now uses exact release asset IDs through authenticated GitHub API with separate credential-free CDN download, digest checks and bounded attempts. Public binary release/feed remains forbidden.

## Checkpoint all-screen Desktop usability reconstruction from Owner feedback

Owner confirms the installed internal dev.3 Desktop works, but requests user-facing UX across every screen. Work now targets all routes/login/dialogs and browser consent, including reproduced B button/input overlap and populated table layout. See docs/plans/desktop-user-experience/README.md. This feedback is not full physical acceptance of every feature. Existing backend Lab remains at2771f47; no public release/feed.

## Rebuild Desktop as a user workspace and fix populated approval and monitor layouts

Rebuild all Desktop screens, login/link/confirm and browser consent as task-oriented user interfaces. Preserve native APIs/authority/CAS/confirmations. Fix B overlap and populated table spacing; put activity first, bound task rows to10, add filters and reveal IDs/raw events only in details. Reflect real Overview requests/work and hide false unavailable warnings under successful inventories. Scope B and device presentation synchronously to the current Owner. Local React121/121, consent/token36/36 and five unchanged native/Owner/persistence source guards PASS. Production Vite/typecheck PASS. Browser30 entry/unavailable plus140 populated/dialog cases PASS across light/dark,390/768/853/1024/1280 widths and1/1.5DPR,120 synthetic jobs and187 events. B geometry never intersects; deliberate overlap is detected. Readable table padding and no page/card overflow. Actual narrow table-reader-label overflow was caught and fixed with a containing block. Native installer/Actions and Owner physical acceptance for dev.4 remain NOT_RUN. Existing internal Lab remains2771f47/dev.3; no new runtime deployed. Native/backend authority remains unchanged; new consent rendering has no scripts/external assets and retains POST/CSRF/PKCE/CSP.

## Checkpoint Codex Wall and Desktop follow-up from installed dev4 feedback

Owner installed dev.4 and reports six new follow-up groups; implementation is now in progress. See docs/plans/desktop-user-experience/CODEX_WALL_FOLLOWUP.md. Existing CI45 is scoped to its earlier tests and does not establish these regressions are resolved.

## Align follow-up SSO branding and cross-language HMAC revision fixtures

CI57 rejected stale presentation and HMAC-vector fixtures after the intentional removal of visible V4 and endpoint configuration revision3. Both expectations are repaired; explicit revision2 coverage is preserved and revision3/tamper vectors now match Node, Rust and .NET. This is not a native build PASS: complete exact-source Actions and internal artifact verification remain pending; Lab stays947a117/dev4.
