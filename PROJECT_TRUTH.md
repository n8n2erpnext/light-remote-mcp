# Light Remote MCP — Project Truth

Internal **0.10.1-dev.5**, one primary **LightRemote.exe**. Compiled source `8e0d932920d218c54f83989978f3866c321e20de`, tree `fec7d9f8a8242358daf44a13faf2735e18520e2b`. [CI64:9/9 PASS](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42803494868) · [internal installer](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42803494868/artifacts/13758302838) · [acceptance/manifests](docs/evidence/desktop-followup/ACCEPTANCE.json). Installer SHA256 `f48d002dfe94b408c968740e7db4cd7758146b707559159086999e2afee880af`, bytes168947869. The delivered installer remains pinned to that compiled source; this documentation receipt has its own Git SHA.

Codex state/copy, runtime model/reasoning and scoped token/quota; canonical auth logo/fonts; short Agent summaries; PTY rendering/replay/transcript; pageable retained activity beyond200; responsive native X with preserved Agent; first-row COMMAND/DANGER/SYSTEM/FS WRITE labels.

Exact-source CI64 PASS9/9: Node284, portable suite70, React125, browser170 plus4 actual-server Wall groups, private backend25 checks including both B paths. Windows build/install/private CLR/Close3cycles/WM_NULL/real ConPTY/bridge upgrade/reinstall/rollback/watchdog/uninstall PASS. Linux/macOS native tests45/45 each, including synchronized async timer/worker liveness. Full Mac/Linux installers and Owner physical acceptance are not inferred.

Lab Operator/Plugin now serve exact GitHub8e0d932/dev5 after CI64/artifact verification and private backups. Public/private health/API and unauthenticated snapshot401 PASS; persistent counts and independent Agent/Wall/supervisor/mTLS PIDs are preserved. No SQL migration or Owner Windows change. Prior947a117 runtime remains for rollback. Remote consent branding is deployed. Main remains8ac6273; permanent work is active. Dev6 tray/installer source through0397d871 is implemented; final heading correction has no native acceptance. CI72 was cancelled at Owner request; CI73 was documentation-only with native/core jobs skipped. No dev6 deployment or Owner installation change occurred.

Current task: RM v2 cursor/input/capture research is complete against work764e1d7; see [the proposed plan](docs/plans/RMV2_RESPONSIVENESS_CURSOR_GPU_PLAN.md). No RM implementation, benchmark, native build/test or deployment was performed. Next proposed implementation is native Windows cursor preservation with AI badge/border and input contract/timing fixes, followed by optional DXGI capture and later video. Wait for Owner instruction before implementation/build; keep the deferred installer/tray acceptance checklist and all identity, session and recovery boundaries.

Current authority is this lead, the single Master Checkpoint and latest Task Receipt. Earlier entries below are historical; failed CI57–63 remain recorded.

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

## Defer Windows close hide beyond callback and preserve installed responsiveness checks

CI58 passed all284 Node units,70 portable suite entries and backend integration; Windows built/installed but actual WM_CLOSE failed, so the candidate is not accepted. A native repair now queues hide from a worker after the close callback returns. The same3s/3cycle integration assertion remains, with bounded WM_NULL responsiveness evidence. Full repaired Actions/native acceptance is pending; runtime947a117 is preserved.

## Restore singleton window through owning Tauri runtime to synchronize visibility

CI59 d6f8eb8 is not an accepted candidate: core/browser/Linux/macOS passed, actual Windows Close0 hid and remained responsive, but Close1 after shortcut stayed visible and responsive. Native singleton show now goes through the existing GUI runtime; background relaunch never signals. Exact-source installed acceptance remains pending; Lab947a117 unchanged.

## Reconcile actual hidden window state before singleton restore

CI60 is not accepted: core/browser/Linux/macOS and Windows compile/install passed, but initial shortcut restore after the existing raw Win32 hide precondition failed. Restore now reads actual OS visibility and normalizes cached hidden state only when already hidden before owning-runtime show. All existing installed tests/deadlines, including raw-hide/background and3 Close cycles, remain unchanged. Full native acceptance is pending; Lab947a117 remains.

## Bind recovery Wall health proof to validated installed package revision

CI61 verified actual installed Close/shortcut/background3cycles, same GUI/Agent and WM_NULL responsiveness; real packaged ConPTY executed output/Unicode/offset/EOF PASS. Full run still failed final manual watchdog rollback health across revisions3->2. Source repair binds recovery-only health to the validated installed package marker revision, with all nonce/MAC/PID/path/profile checks retained and normal GUI/client compiled revision strict. Full repaired CI pending; Lab947a117 unchanged.

## Align recovery ownership guard with installed revision proof

CI62 exposed a stale ownership source assertion after the recovery-only API split. Update Updater/watchdog assertions to IsInstalledWall and explicitly retain ordinary GUI compiled-revision checks plus installed-revision and PID/MAC proof paths. Run the entire portable source suite before publishing; no production implementation or acceptance gate removed.

## Prove native auth UI liveness with synchronized worker release

CI63 macOS failed a 150ms wall-clock assertion in the async native-work fixture while core, web and Linux passed. Replace that scheduler-sensitive elapsed sample with causal synchronization: the blocked worker cannot finish until the async25ms timer releases it; a separate5s emergency release makes an inline-blocking regression fail without hanging. Keep real Windows Close3cycles/3s, responsiveness, Agent lifetime, ConPTY and watchdog recovery gates unchanged. Production implementation is unchanged.

## Implement fresh Moryqa Windows setup uninstall and five-state primary tray

Internal dev6 source implements the fresh Moryqa Windows distribution V3, real five-state unified tray, privately packaged Google Sans and empty-only legacy directory cleanup. [Design/code mapping](docs/design/windows-distribution-v3/README.md). Exact-source native CI/artifact is PENDING; previous dev5 accepted build and deployed Lab evidence remain pinned. No Owner install/public Release/feed.

## Inno6.7.1 native distribution compile follow-up

CI68 Windows native app and48 Rust tests PASS; Inno installer compilation stopped on unsupported NativeUInt. The source uses released UINT_PTR pointer/handle types and an early compile-only Actions fixture, which is never executed or uploaded. New full exact-source CI and actual six native views remain pending. Previous dev5 Lab/runtime/artifact and rollback are preserved; no Owner install or public release.

## Measure installer Google Sans in its owning GDI process

CI69 compiled the full dev6 installer; native UI acceptance stopped at an invalid external GDI font measurement. The observer is replaced by an in-process GetTextFaceW measurement using the exact title TFont, with strict Google Sans requirement retained. No installer is accepted until fresh six-view UI/lifecycle/migration CI passes. Server5 and Owner installation remain unchanged.

## Correct native title lines card surfaces and uninstall button selection

CI70 installed dev6 with three actual native views/font/progress/Finish and fresh empty-directory cleanup PASS. Uninstall selector ambiguity and actual screenshot fidelity gaps are corrected: explicit accessible title/body line placement, opaque native card/footer colors and button-class selection. New screenshot checks require second-title ink and card pixels. A new full exact-source run must pass before artifact/deployment acceptance.

## Retain bottom margin for native Google Sans heading descenders

CI71 source302c662 is full9/9 PASS with six actual native views and real migration/watchdog. Final pixel inspection found a narrow bottom clipping boundary for Google Sans descenders. Heading allocation grows92→102px (body starts at218, so no overlap); a new native screenshot assertion requires bottom ink padding. Follow the new exact-source run before final dev6 artifact acceptance.

## Record Owner stop-build instruction and next native acceptance checklist

Owner explicitly deferred all further native builds/tests. Source/design/branding/tray/installer and empty-folder fixes are published through0397d871. CI72 cancel requested; no final dev6 artifact accepted and no dev6 runtime deployment. CI71 source302c662 full9/9 and six UI views remain historical baseline evidence, not acceptance of the later heading-margin fix. Next native acceptance is deferred until Owner instructs build/test.

## Extend RM v2 plan with target-verified typing and long logical input

The existing [RMv2 plan](docs/plans/RMV2_RESPONSIVENESS_CURSOR_GPU_PLAN.md) now includes Owner-requested verified typing and larger logical input. Windows currently confirms events, not content; focus/title checks do not guard the whole text loop. Source4096UTF16 limits, silent semantic truncation and input10s versus nominal16.384s long-text pacing require coordinated design. Proposed target/readback/progress/chunk/cancel semantics preserve native best-effort and do not imply universal exact verification. Research only; no RM implementation, benchmark, native build/test, deploy or new physical acceptance. Owner no-build instruction and existing deferred dev6 native checklist remain active.

## Plan local Memory retention, ChatGPT Claude extension and multi-provider API Worker

Owner chose research/plan only for [local Memory, extension and API Worker](docs/plans/LOCAL_MEMORY_EXTENSION_API_WORKER_PLAN.md). Source confirms dedicated encrypted device sync uses volatile TTL relay, while MCP Memory exec script/stdout can place content in Operator event logs; no live Owner log/DB inspected. Recovered extensions are ChatGPT-only with fixed profile targets and no restore-to-chat. Desktop cached metadata needs explicit account bootstrap; Refresh may use30s cache.69remaining/31used screenshots are consistent; token lifetime is separate. Local single-worker Codex delegation exists; public MCP reasoning tool and Claude/Gemini/multiworker adapters are proposals. No implementation, functional/native test/build, authentication/inference, install or deployment performed. RMv2 typing planad3db2f/CI76 docs-only and deferred dev6 acceptance remain retained.

## Fix native installer surfaces and typography, tune tray and integrate Google sign-in

Installer/tray/Google follow-up is implemented; portable37 tests and distribution source guard PASS. Exact-source native CI/artifact, six rendered native views, Lab configuration/rollout and physical acceptance are pending. Connected glyph is now product-tuned #167A58 with honest derived-asset provenance. Production is read-only; no public release/feed.

## Preserve production Google callback for domain rotation and verify explicit Wall SSO gates

Owner supersedes temporary Gold OAuth callback proposal: keep production callback/client, preconfigure Gold only. Saved credentials stay inactive when callback and running public origin differ; `/admin` says awaiting domain switch. No additional Google callback requested, production untouched. Wall SSO now requires an independent explicit flag plus exact native/host/auth gates; do not infer ENABLED from implementation or Desktop login.

## Capture native installer geometry before full builds without weakening UI checks

Native installer compile is distinct from visual acceptance. CI78 failed actual Welcome geometry; no new installer accepted. A payload-free CI-only Welcome probe now captures geometry/screenshots before all visual assertions and expensive native build steps. Full six-view setup/uninstall and installed lifecycle remain required.

## Fit native Google Sans labels to actual GDI ink while retaining descender padding

CI80 native probe measured actual overlap from oversized full GDI font boxes. Corrected Wizard measures exact raster ink plus8 logical pixels; preserves original Google Sans file and native controls. Corrected native proof is pending; no installer accepted.

## Record native wordmark capture coordinates while retaining ink assertions

CI81 GDI ink sizing fixed native layout geometry. Actual screenshot is visible; wordmark ink-region check still fails and remains enforced. Exact coordinate/count diagnostics added; no installer accepted.

## Inspect the active native wordmark and hide covered stock wizard headings

CI82 wordmark failure was measured against covered stock Inno PageNameLabel, not the visible wordmark. Ink proof now selects active branded-surface wordmark; hidden stock headings are excluded from accessibility while branded pages show, restored for native error/prerequisite pages. Native full acceptance remains pending.

## Keep compile-only cleanup in its owning CI step after native Welcome passes

CI83 actual native Welcome probe PASS, including wordmark/heading ink and descender margins, card child backgrounds and geometry. Post-probe CI cleanup scope error fixed. Full product six-view round-trip and artifact acceptance remain pending.

## Record CI84 internal installer acceptance, Lab rollout and preserved Google callback

Completed installer/tray/Google follow-up: actual card ancestry removes white bands; exact GDI ink sizing preserves Google Sans descenders without oversized line boxes; hide covered stock headings; Connected LR glyph is darker #167A58. CI84 full9/9 and six native views PASS, verified internal artifact, same-source Lab Operator/Plugin deployed. Original production OAuth client/callback saved in Gold PG and intentionally inactive until Owner domain-role rotation. Source3064f21, tree d39c48f, version0.10.1-dev.6; CI42989298732 all9 PASS; native6 views at96DPI visually reviewed, descender margins8–9px, gray card child backgrounds; primary migration/rollback/close-reopen/ConPTY PASS. Installer170519556bytes SHA256187ab6bf9b6d5a5487b7898aaf03ef3b053fbad046afa2044aa13aca81a60938; artifactZIP169963254bytes SHA2565a875f96215216d972e2676b52b456cb0fb4b98149696fa8707710de629c1d8c. Independent ARM verification PASS. Lab public health/API contract PASS; counts2 accounts/8 devices/35 grants/1 Owner unchanged; independent PIDs preserved; no schema migration. Google public status saved=true/configured=false/pendingDomainSwitch=true; original callback retained, production equality HMAC PASS, no credential export. Physical Owner/real Google round-trip remain pending by design. This documentation receipt pins compiled3064f21; it is not a new native build.

## Preserve native RMv2 cursors and honor precise input timing

Implement RMv2 phase1: preserve all native Windows cursors, activity-only AI badge/four thin click-through edges with embedded product font, physical Owner interruption and owned-input cleanup, disconnect/desktop-switch stop, explicit restore only, move timing/steps/zero forwarding and additive timing/unverified-text receipts. Bump internal source to dev.7. Owner reported previous CI84 installer PASS; no unreported physical matrix inferred.

ARM portable71 source groups PASS; all299 unit cases PASS across path-compatible batches (292 regular units with contained short socket path,7 artifact preflight with canonical path). Security/path limits unchanged. Final local helper lifecycle, double-normalization/native mapper and cursor contract PASS. Native compile/actual Windows cursor, tiny moves, badge/timer and installer regression remain pending exact-source Actions. No before/after speedup or RM physical acceptance claimed.

Lab Operator/Plugin remains GitHub3064f21/dev6; independent Agent/Wall and production preserved. No runtime deployment or Owner installation by RM phase1 implementation.

## Read native cursor bitmap proof without PowerShell GDIplus coupling

CI86 product RMv2 compile and native self-tests PASS; cursor probe failed before assertions from .NET10 GDIPlus reference coupling. Probe now hashes real Win32 cursor masks/colors/hotspots directly; all11role, tiny endpoint and indicator/idle/restore assertions retained. Full exact-source native/installer acceptance pending; no artifact/deployment claim.

## Fence Owner input at operation start and repair hosted Ubuntu mirror

CI87 actual RMv2 native acceptance PASS at7f29e2a; evidence docs/evidence/rmv2/phase1-ci87.json is native-only, not full artifact acceptance. Review hardening now captures input generation before quiet-time check and keeps passive Owner motion observational. New full CI required. Hosted runner apt mirror DNS failure is repaired without package trust or UI-test changes.

## Keep RMv2 input hooks independent of overlay rendering

RMv2 hooks now have their own message-pump thread instead of WPF UI thread, following the Win32 low-level-hook contract. Input observer cannot wait behind our overlay/font rendering. No measured before/after speed claim; final source needs native/lifecycle/full CI again. Prior7f29e2a native functional evidence remains separately pinned.

## Handle observed hosted apt mirror list after Windows RMv2 acceptance

CI89 e4e376f full Windows native/installer/migration/rollback/lifecycle PASS and RMv2 dedicated-thread acceptance PASS. Full baseline fails hosted browser apt DNS because mirror list is /etc/apt/apt-mirrors.txt, missed by the prior selector. Selector now covers observed path and an integration fixture. No product code change; all UI/package trust gates retained.
