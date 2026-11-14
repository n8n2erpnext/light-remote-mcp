# Light Remote MCP — Project Truth

Nội bộ **0.10.1-dev.11**, một **LightRemote.exe** chính. Source `1bd6fcc7ea4d5aa48a0c460f9c90d9501e9500e9`, tree `e030a88a578228ee08b7998d1fabfa68c93989ec`. [CI127:15/15 PASS](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/43564848850) · [bộ cài nội bộ](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/43564848850/artifacts/14103290306) · [bằng chứng](docs/evidence/rmv2/acceptance-ci127.json). Installer SHA-256 `d9b84b6df878c1abc1c11feb8b378520a26ba34b69133a2e580c10eaddf452a8`. Commit docs này ghi nhận source đã build, không phải một bản native được build lại. **Owner physical UAT: PENDING.**

Đã triển khai và có bằng chứng CI: cursor Windows nguyên bản; nhãn AI/viền xanh nhẹ; đóng task RM có xác nhận trước báo cáo và fallback45giây yên lặng; input có thứ tự, status/cancel riêng; nhập Unicode bind target với readback toàn nội dung khi capability hỗ trợ; năm ca262K Rich Edit/Classic/Win32 và smoke16K/64K; crop/ROI/mapping; DXGI/D3D11 crop+resize trước readback nhỏ, fresh GDI fallback; H264 Media Foundation ưu tiên hardware và software fallback; relay video RAM giới hạn không lưu pixels vào DB/jobs; Owner WebCodecs viewer không capture/renew quyền. Frame đến muộn sau close bị chặn. H264 là pull/independent-IDR có backpressure và CPU NV12, không zero-copy hoặc cam kết FPS. CI đã dùng software encoder/fallback; GPU adapter/encoder vật lý, mixedDPI và ứng dụng thật chờ Owner. Windows vẫn có một focus/con trỏ hệ thống; input đã vào OS queue có thể race với đổi focus, không tự replay hoặc giả verified.

Gold Lab Operator/Plugin đã chạy exact source `1bd6fcc7ea4d5aa48a0c460f9c90d9501e9500e9` /dev11; health/API PASS, không migration DB; giữ nguyên Agent/Wall/supervisor/mTLS và dữ liệu. Production/domain/Google callback, protected main, public feed và Owner installation không đổi.

Current development source: Complete internal RM implementation and exact-source acceptance: source1bd6fcc7ea4d5aa48a0c460f9c90d9501e9500e9, CI127 all15jobs PASS, all five real keyboard262K editor/layout cases PASS on the identical helper staged in the one-primary installer, actual D3D11/WARP shader and reduced-readback DXGI probe PASS, native H264 plus production WebCodecs16color frames and lease/close/resource checks PASS. Independently verify installer/source/tree/hash and deploy only isolated Gold Lab with recovery, no DB migration or independent Agent/session/grant disruption. Owner physical GPU/mixedDPI/app acceptance remains pending, no public release or production/domain/callback/main/feed change.

Các mục bên dưới là lịch sử theo thời điểm; current source/evidence ở phần đầu và Master Checkpoint.

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

## CI90 recovery scope

RMv2 phase1 native checks pass in CI90, but whole baseline is not accepted: hosted Ubuntu DNS and transient installer-probe HWND failed. CI-only snapshot and tightly scoped hosted DNS recovery retain package trust and every UI/layout assertion. Product source remains unchanged since CI89 full Windows acceptance e4e376f. Exact-source all9 CI and verified artifact are required before Lab rollout; production and Owner installation remain unchanged.

## Bound smooth-motion wait slices for prompt Owner interruption

Final phase1 review bounds Smooth Move sleep slices to8ms, correcting a sparse-frame cancellation delay up to249ms. Monotonic movement deadlines, easing, duration/defaults and exact endpoints remain unchanged. Exact-source full CI is required after this native change.

## Keep RMv2 working sessions visible and yield input without failing Agent sessions

Owner physical build92 indicator FAIL supersedes native flags-only awareness acceptance. dev8 repairs lifecycle, visible cursor tail and full painted all-monitor edge surfaces. Local input produces paused/sessionRetained receipt, not Agent/session termination; no input block/replay/refocus. Background jobs continue independently. Same foreground Windows session still has shared pointer/focus; per-window background automation and verified long typing remain future capability work. Internal only, native/full CI pending.

## Keep paused RMv2 session awareness visible during Owner work

Owner shared-desktop clarification: keep paused awareness throughout an existing RM working session; do not hide AI/glow while the user works and Agent remains connected. This retains paused input, not independent foreground automation. Public Codex docs confirm Windows foreground input; no internal1:1 implementation claim. Physical UI acceptance stays FAIL/pending retest.

## Record CI94 acceptance and Owner explicit RM session completion contract

CI94 dev8 full9/9 PASS and source/artifact verified, but Owner reports overlay stuck after task completion. Physical lifecycle is FAIL/pending new fix. Latest Owner decision: explicit RM close before final report; next input requires reopen;45s quiet orphan fallback excludes active RM jobs; capture/input renew, generic status/heartbeat do not. Light Outlook sky blue replaces brown. A/B stays separate.

## Require explicit RM task scopes with confirmed close,45s orphan cleanup and sky-blue awareness

dev9 implements explicit owner-bound RM task scope using existing desktop_attach/detach. Agent must confirm taskEnded/scopeClosed before final report; public input requires open scope and rejects closed/expired IDs.45s quiet fallback ignores status/heartbeat, protects in-flight work and renews on actual RM device activity. Native scope close hides indicator despite other retained read-only observers; linked task observation children are cleaned. Outlook-light-blue active/paused palette replaces brown. Implemented, not yet native/full/physical accepted.

## Package RM task lifecycle module and retain scoped input receipt compatibility

CI96 was rejected by actual client static-import package closure: rmv2-task-lifecycle runtime module now added to client/core-files.json. Scoped native input now retains existing flat fields with additive visual metadata. No test or policy weakening; exact-source native/full CI retry required.

## Acknowledge already-closed RM tasks and protect in-flight resume

dev9 also acknowledges already-closed task IDs to their original session+Agent for15minutes (max256 metadata-only records), enabling required close confirmation after fallback/lost response. This does not reopen or authorize input. Explicit resume joins in-flight accounting. Exact final native/full CI remains pending.

## Add ordered RM work with fast scoped cancel and explicit pointer profiles

Current development candidate dev10 phase2a has ordered MTA input/state, independent capture and bounded fast status/cancel plus explicit pointer profiles. Native compile/full CI pending; previous compiled dev9/CI98 remains the verified artifact. Owner deferred physical UAT until remaining plan is implemented. No runtime/Owner install/production changes.

## Retain explicit legacy RM timing paths alongside opt-in profiles

CI100 failed retained default timing path checks before native compile. Source now retains explicit legacy90ms/8step and35/40ms branches, with opt-in fast overrides afterwards. Tests were not weakened; native profile self-test added. dev10 native/full CI still pending; do not use CI98 proof for dev10.

## Add target-bound Unicode writes with verified progress and live authority checks

Implement dev11 Windows target-bound logical Unicode writes with async writeId/progress/cancel, grapheme-safe bounded packets, same-control readback and no replay. Inline262144 UTF16 units or pinned16MiB UTF8 local reference under Owner read roots. Recheck local identity/policy per chunk and signed server A/B/account/connection/capabilities at most1s between snapshots. Bounded monotonic10min deadline selectable up to1h. Stop unsent text on focus/Owner input/task close/revoke. Remove semantic-value silent4096 slicing; preserve existing macOS HID/AX path. Native Windows readback/focus-switch fixture added in Actions. CI101 dev10 all9PASS recorded independently; dev11 native CI pending. Lab Operator/Plugin remain3064f21/dev6; production/domain/Google callback, independent Agent/sessions/grants/DB and Owner installation unchanged. Full plan remains incomplete: capture/ROI/freshness/DXGI/media and consolidated physical UAT are not PASS. New backend signed authorization route must be deployed from the final verified GitHub commit before new client long-write integration.

## Correct native logical write variable declaration for CSharp

CI102 Windows failed at native compile CS0819 before the new text fixture. Split RobotContext FinishTextWrite local var declarations; no behavioral/test/threshold changes. Core/backend/Web passed for sourceef54911. New Actions proof pending; no CI102 artifact accepted, no Lab/Owner/production changes.

## Reuse fresh RM capture buffers and add crop-aware frame coordinates

Phase2c dev11 source adds one bounded private current-pixel GDI bitmap/codec/JPEG/base64 cache, early native unchanged-payload omission, screen-local ROI pinned to visual scope, effective limits/timings/counters and opt-in exact latest-frame coordinate mapping with age/topology guards. Capture still reads current pixels on every call; no stale timer screenshot. Generic ui.changed hints coalesce in one pending slot at40ms rather than one unbounded Task per WinEvent; semantic journal path retained. CI103 compiled native and passed selftest/cursor lifecycle, but text fixture stopped after100 interleaved UI events; fix reader to a whole-request deadline. Web test waited only for selected DOM value before async save; now awaits the actual canonical preferences POST response and retains max-value assertion. New native ROI/JPEG/cache-clear and cold/warm capture-only probe is Actions-only and pending. Lab Operator/Plugin remain3064f21/dev6; production/domain/Google callback, independent Agent/session/grant/DB and Owner installation unchanged. Full RM plan remains unfinished; optional GPU/video and consolidated physical UAT are not PASS.

## Bind typing target before cooperative large-text preparation

Make large logical-text preparation cooperative: cheap full transport/Unicode/options checks first, bind native target before expensive grapheme validation, return preparing writeId, yield after8192 units or8ms, recheck authority/cancel/task/deadline and maintain only the exact native lease while preparing. No input until the whole grapheme/pacing preflight passes; acceptedUnits stays0 until then. Reject pacing that cannot fit the chosen deadline before input, bounding useless chunk allocation. Target changes during preparation stop before typing. Portable17 cases PASS. CI104 capture proof independently SHA-verified; fullCI remains FAIL because real16K native text readback mismatched, so add metadata/hash/count-only failure evidence to diagnose, not relax acceptance. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged. No complete accepted installer exists for this source yet; do not give it to Owner as a finished candidate.

## Separate root-guarded UIA observation from ordered input

Move read-only uia.snapshot and semantic snapshot/events to one separate windowless MTA with a bounded two-entry queue; input/mutations/attach/detach remain ordered. Pin semantic root/epoch metadata before traversal, verify the same live session/root afterward, report concurrent input/UI changes and require reobservation rather than mixing trees/root metadata. Keep AutomationElements on their creating worker. Guard resolved mutation root before applying; changed acknowledgement metadata never triggers replay. Scheduler selftest checks observation during held input and input/status during held observation. CI105 Core/Web/Linux/macOS/native compile/cursor/capture passed, but text fixture hung and Windows job was cancelled without final text receipt. Add no-content progress checkpoints and an eight-minute fixture step timeout; actual16K text mismatch remains unresolved, not PASS. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Isolate native text acceptance from PowerShell UI runspaces

CI106 native compile and UIA scheduler selftest/cursor/capture passed. Safe exact-source text evidence shows16384 sent events versus7406 actual UTF16 units, mismatch at index0; cause is still under investigation. The PowerShell-hosted WinForms fixture then hung during cleanup. Replace only that fixture with a separate ordinary STA WinForms test process and current-user pipe; record WM_CHAR/key-down counts without raw logs and use bounded process cleanup. Preserve exact16K/64K/256K text and required native readback assertions. No product typing behavior or success criterion changed in this packet. Optional GPU code/benchmark work remains local-only until this diagnostic is resolved. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Add optional exact-monitor DXGI capture with fresh GDI recovery

Add opt-in on-demand DXGI/D3D11 desktop capture under the existing authorized JPEG image path; GDI remains default. Match the exact display name, adapter and geometry; identity rotation only, bounded staging,16ms frame acquisition and explicit fresh-GDI fallback on timeout/unavailable/access loss. Never return a cached desktop as a fresh GPU frame. Copy validated BGRA ROI to the existing bounded BGR/JPEG cache; resize/encoding remain CPU, not zero-copy video. Clear GPU resources with the last visual scope/helper cleanup, recover with bounded backoff and keep status nonblocking during driver work. Pin direct NuGet versions and include full MIT notices. Actions will publish resolved NuGet graph for final source lock, probe actual DXGI or explicit fallback and record same-runner ABBA capture/pipe measurements against exact prior GitHub source241359b. No local/ARM native build, enabled GPU default, hardware acceptance or speedup claim. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Wait for native text delivery and fence expired input authority

Address real native text backlog: CI107 ordinary STA fixture received only4205 exact-prefix WM_CHAR units after16384 events were accepted, so sending is not delivery. Use grapheme-safe128-unit logical chunks and wait for full expected prefix/suffix readback before admitting the next chunk when verification is available. Initial empty ValuePattern is an unambiguous readback source; no semantic SetValue/clipboard/DOM replacement is used. Keep full final verification, no replay/refocus and cancellation/focus/Owner guards. A stalled/mismatched prefix stops unsent suffix and reports historical observed units separately from final verified content. Preserve inline262144/reference8M units; only internal per-chunk/grapheme budget becomes128. Propagate remaining<=1000ms authorization budget, subtract helper startup time, bind a receiver-owned monotonic deadline including native queue delay, reject expired work before input and check during guarded work. Refresh near-expiry snapshots. Mark UIA concurrentInput for physical/direct typing too. Fix CI108 DXGI overload by explicit output types, commit SHA-verified Actions-resolved NuGet graph and enable locked restore. All new native behavior remains CI-pending, not Owner PASS. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Keep RM capture cleanup responsive and correct native measurements

CI109 sourcef7e9507 passed native compile/selftest, cursor/lifecycle, GDI capture and actual DXGI/fresh-GDI-fallback probe. Its controlled benchmark recorded results but failed writer cleanup before native text acceptance; missing prior-source captureDurationMs also produced invalid zero capture timings. Use shared positive nativeTiming.handlerMs, label that boundary accurately and tolerate only expected closed-pipe disposal exceptions after bounded isolated process termination. Preserve exact16K/64K/256K text/readback assertions and allow15minutes for cumulative real keyboard delivery. Remove capture-lock waits from status/expiry/detach cleanup: request cleanup atomically, drain under capture gate before/after in-flight capture, expose cleanupPending, and test nonblocking cleanup plus cleared idle resources. Include committed NuGet lock hash in build provenance. No Owner/native text/full installer PASS is inferred. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Amortize verified text windows without dropping target checks

CI110 source3e4a186 verified real16K and64K Unicode text end-to-end, then reached174576/262144 acknowledged units before the unchanged15minute step budget expired. No mismatch/full256K PASS is claimed. Amortize unpaced target/readback checks over bounded256-unit windows instead of128; paced windows/max indivisible grapheme stay128, native input packets retain32-unit checks except one allowed larger grapheme, signed authority deadline remains<=1000ms and each window still needs complete expected prefix/suffix readback before later input. Remove duplicate CheckFull calls immediately before WaitForDelivery, which already checks the full target before every read; unverified paths retain their post-input check. Keep all full-content/focus-switch assertions and timeout unchanged. Add metadata-only per-size elapsed time/last native handler+queue timing to pinpoint remaining costs. Pin corrected CI110 capture comparison and text-timeout evidence. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Fence new text packets while completing read-only verification

CI111 real16K/64K exact native+fixture readback passed in22.49s/86.42s. At65946/262144 accepted units, the one-second authority guard interrupted a fully sent255-unit window before observed-prefix confirmation (handler1043ms, queue0.026ms); prior code did not distinguish sending from completion. Keep<=1000ms authority admission and native queue fencing, and check deadline immediately before EVERY new packet, including after target validation. After an admitted packet use cancel/Owner/focus/desktop checks without granting further input authority; bounded read-only delivery verification can finish existing effects, and the next window still requires fresh Agent authority. No new packet is sent after the deadline. Add a recording-sender selftest of the actual packet loop: expired-before-first sends0, expiry after packet1 blocks packet2 with known32units, expiry after the final packet preserves its count, partial SendInput remains unknown/no replay. Add separate preflight/send/readback timing and persist exact failure ACK/stage metadata. Keep256-unit unpaced windows,128 maximum grapheme, paced limits and all content/timeout assertions unchanged. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Back off delivery observations and diagnose exact fixture content

CI112 passed actual admission packet-loop selftests, cursor/lifecycle, GDI/DXGI and other platform checks. Real16K/64K exact text passed;256K stopped after97641 accepted/97385 observed units in delivery-readback, not sending (target5.14ms,send55.05ms,readback1501.96ms). Keep failure classification honest: current evidence does not distinguish target lag, provider lag or actual dropped characters. Back off unmatched read-only UIA polling15/30/60/120ms (cap120), with the SAME1500ms wait and full expected prefix/suffix comparison, cancel/Owner/focus/desktop guards. This reduces competing provider calls; starvation is a hypothesis, not a confirmed cause. Add pure native polling tests for bounded timeout, eventual match and cancellation. On a failed native ACK observe the owned fixture three times without any further input, record exact-prefix/hash/first-difference/WM_CHAR/key-down/other-control counters; a late match still leaves the native test FAILED. Declare fixture-only capacity1048576 explicitly, preserve word wrap and real keyboard injection. Product never changes an application text limit. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Verify slow text completion across explicit editor capacities

CI113 direct post-stop snapshots prove target lag for the failed window: native stopped at73614accepted/73359observed after1.637s readback; fixture initially had73575units, then exactly73614 with matching full-prefix hash by+1.209s, stable at+2.162s, no replay/new input. Raise ONLY bounded read-only completion polling to5seconds, below the existing10second Agent chunk RPC budget; retain one-second native queue/new-packet authority, focus/Owner/cancel guards, exact full-content comparison and no replay. Keep classic Edit16K/64K; declare and test262K on a genuine large-capacity wrapped Rich Edit as editor-specific positive coverage. Classic wrapped262K remains NOT_ACCEPTED, never relabeled PASS. Add an actual classic fixture with80ms-per-WM_CHAR delay: required exact keyboard readback must succeed after>1.5s and after input-authority expiry, proving completion does not authorize another packet. Pure packet expiry selftests remain. No app text limit is changed by product code, no clipboard/SetValue/DOM substitution. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Align keyboard indicators and explicit text acceptance layouts

Bind logical keyboard indicator screen to the current foreground target before showing the activity overlay; raw mouse/drag already set their explicit target screen. Replace stale native status128 with shared256 unpaced-window constant and shared5second completion constant, report paced128/grapheme128/packet32, and assert actual status/start agreement in native acceptance. Preserve CI114 failure evidence: classic16K/64K exact PASS, giant wrapped Rich Edit paragraph262K failed at59556accepted/59301observed; subsequent fixture reads still advanced but did not complete. Exercise262K separately as genuine paragraph-structured Rich Edit input using CR paragraph separators, with full native and fixture content comparison allowing line-ending equivalence only. Both giant single-paragraph262K editor cases remain explicitly NOT_ACCEPTED. This changes no product text payload, mutation/authorization budget, packet sender, target capacity or replay behavior. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Deliver line breaks only to bound native multiline editors

CI115 exposed a real newline bug: native sent256 Unicode events, fixture received256WM_CHAR but text255units stably missed CR at144; correct readback stopped before success. Add source-newline handling ONLY for bound known native Edit/RichEdit classes explicitly ES_MULTILINE+ES_WANTRETURN: CR,LF,CRLF become one guarded Return pair per logical newline, with original source-unit accounting and no replay. Arbitrary fields keep existing Unicode packets and receive no new Return behavior. Recheck native editor policy in target guards. Recording-sender packet tests cover3logical newlines/CRLF accounting and unchanged legacy Unicode path; policy selftest rejects single-line, missing WANTRETURN and unknown/browser HWND classes. Real Actions fixture explicitly declares native WANTRETURN and tests LF/CRLF/CR on both classic and rich before large sizes, full native+fixture comparison. No clipboard/SetValue/DOM, no product capacity or authority change. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Separate native Edit acceptance from managed editor stress cases

Separate genuine Win32 EDIT large-input acceptance from managed editor stress limitations. Test fixture creates a real EDIT HWND with CreateWindowExW and declared multiline/WANTRETURN/1M capacity, assigns NativeWindow only for event counters and uses built-in Windows control/provider; it has no managed TextBox/RichTextBox accessibility object. Reset/read are test-fixture-only; actual input still goes through product native keyboard packets and UIA full readback. Keep managed classic16K/64K and managed classic/rich small newline cases; add nativeLF/CRLF/CR cases, use explicitly paragraph-structured nativeEDIT262K, and serialize all newline cases even on failure. Run actual delayed delivery before expensive sizes. CI116 managed rich paragraph262K remains NOT_ACCEPTED alongside both giant-paragraph cases. No product mutation/verification/timeout behavior changed by this fixture update. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Allow full native text completion and retain macOS checks

CI117 native Win32 paragraph stress progressed with exact acknowledged/observed content to126916source units, but external15minute step timeout cut it off. Nine real native/managedLF-CRLF-CR cases, delayed completion control flow and managed16K/64K passed; final262K was not accepted. Increase only bounded hosted Windows test budget15->40minutes and whole job80->110 to allow full completion plus installer/rollback; product input authority<=1000ms, read-only delivery5s and chunk RPC10s are unchanged. Add always-run receipt classifier: unfinished RUNNING becomes INCOMPLETE, and a successful text step without complete PASS/missing receipt fails. GitHub check annotations prove macOS arm64 job never acquired a runner due capacity. Pin standard macos-15-intel for the same Darwin source/vault tests instead of floating macos-latest; AppleSilicon/arm64 acceptance remains pending. No required test or branch protection disabled. Lab Operator/Plugin remain3064f21/dev6; production/domain/callback, independent Agent/sessions/grants/DB and Owner installation unchanged.

## Verify native editor delivery without creating UIA providers

Resume full RM plan before acceptance. Empty supported Unicode Edit/RICHEDIT50W targets bind/read with bounded read-only User32 messages before any UIA activation; nonempty selection-aware documents retain UIA. Require stable before/after lengths, complete copied count and full content equality; reject truncated/unstable reads without replay. Bind native class/thread/process/focus and tracked destroy generation. Keep 1000ms mutation admission,5s read-only completion and existing cancellation/Owner guards. Reinstate all four previously unaccepted managed262K cases as required positives alongside16K/64K/pureWin32 and newline tests; assert native readback does not create managed accessibility providers and retain nonempty UIA regression. No managed262K PASS or speedup claimed before Actions proof. Full checkpoint checkpoint/20261114-before-rmv2-complete-plan-1c27f62 bundleSHA 882a35850f0d06c1841690f51451a61fbe1c19019105881467df2ec82ad6c781 archiveSHA 6fdf502a6d077f0e4de8d7a0f4c0932333077998661677edb49e5782bb7d0ea7 independent bundle/restore/fsckPASS. PowerShell text matrix AST PASS; native code/build and OS tests remain Actions-only. User32 source: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw and /windows/win32/winmsg/wm-gettext (older RichEdit64K limitation is fail-closed, not assumed supported). Lab remains exactf109260/dev11; no deployment, DB/Agent/session/grant/Owner installation/production/domain/callback/public-feed changes. Protected main unchanged. Next: Follow exact native Actions managed262K results and fix actual failures. Implement/test actual GPU resize and encoded video with authorized bounded transport/viewer before consolidated Owner download/acceptance. CI118 is comparison/rollback only, not the finished-plan candidate.

## Resize DXGI textures on D3D11 before CPU readback

Implement optional DXGI GPU crop/bilinear resize before CPU readback. D3D11 compute samples a bounded source texture, writes output-sized RGBA UAV, maps only reduced staging pixels and copies channels into the JPEG bitmap; CPU JPEG remains explicit. One bounded resource set is released on scope cleanup/topology/device loss. GDI stays default and copies current pixels on any DXGI/compute failure with reason/backoff, never stale pixels. Native selftest requires actual shader dispatch/readback via WARP with cropped colors, changed/odd dimensions and channel checks; WARP is software correctness evidence, not physical GPU performance. Actual capture probe checks downscaled JPEG dimensions and only reports gpuResize on successful DXGI dispatch. Full checkpoint checkpoint/20261114-before-rmv2-gpu-a686ef2 bundleSHA b5b03ab156354d0eebd9704788192212a2c8d80d1f6da2621b5a507f495ae8dc restore/fsckPASS. Pinned Vortice3.8.3 APIs and Microsoft D3DCompile contract reviewed. Native compilation/compute/capture tests run only Actions; no GPU PASS or speedup inferred from source. Lab remains exactf109260/dev11; no Owner install, runtime/DB/Agent/session/grant/production/domain/callback/main/public-feed changes. Next: Follow native text and GPU Actions results, fix failures. Implement encoded video pipeline and authorized bounded transport/viewer; then verify the combined candidate before Owner download/UAT. CI118 remains comparison/rollback, not completed RM plan.

## Check native readback capacity conversion before allocation

CI120 stopped at native compile: readback length is long while StringBuilder capacity and consistency budget require int. Existing bounded before<maximum<=20M permits a checked int conversion before adding spare capacity. Fix both CS1503 failures without changing message/readback/input budgets. Text stress has NOT_RUN, not failed or passed execution. GPU source3a240c4 remains native-CI pending; encoded video work continues. No deployment or Owner installation change.

## Measure real accessibility creation in isolated native text fixtures

CI122 compiled native RM and passed actual compute shader/WARP correctness, original cursor/lifecycle, GDI capture and DXGI reduced-readback probes. Its text fixture then failed CS1061 because IsAccessibilityObjectCreated is not a public TextBoxBase member. Track actual accessibility creation by overriding the protected factory in the isolated measured controls instead. Keep the same required four managed262K cases and no-provider-activation assertion; no product typing/input budget change and no text PASS inferred. CI122 exactda99762 Windowsjob132284207643 logs: native selftest all true; DXGI probe13DXGI frames18explicit freshGDI fallbacks and downscale43200output/readback pixels; no physical GPU speedup claim. Managed text NOT_RUN due fixture CS1061, now corrected protected factory measurement. Before checkpoint checkpoint/20261114-before-rmv2-media-da99762 bundleSHA d35252665a10bd2a73d8724c7b0666ab42a8534ac51007d3eb2f5e7802595fdb restore/fsckPASS. No runtime or Owner install change; finish text/video before acceptance.

## Add scoped H264 video with ephemeral relay and authenticated viewer

Implement optional Windows H264 video end to end: explicit video-frame uses the existing owned A/B RM task and desktop read policy, D3D11 crop/resize preference with current GDI fallback, Media Foundation hardware encoder preference with software fallback, bounded CPU NV12 conversion and independent AnnexB IDRs/SPS/PPS. Native capture lane stays bounded and input/status lanes independent; close/topology/lease checks fence late output and release codec/GPU resources. Encoded pixels go through a separate signed actor-bound2s16MiB RAM relay and authenticated same-device WebCodecs viewer; capture jobs store metadata only, never media. Private video_read rechecks account/Agent/device connection/A/B grant without renewing RM control. Owner viewer only observes recent already-captured packets, suppresses duplicate payloads and clears stale/hidden/closed views. Central endpoint catalog, contracts and packaged Client Core include the feature. No zero-copy, physical hardware, native video or completed-plan PASS is claimed before exact Actions proof. Portable video/auth/relay/Owner HTTP tests13/13PASS; native input contract, Client Core closure93files, canonical endpoint Node/.NET/Rust/updater contractsPASS; video PowerShell ASTPASS. Native video has not yet run. Full checkpoint checkpoint/20261114-before-rmv2-encoded-bf97488 bundleSHA 516b929e67de6b6e96e1a33c94915bad819dfbdb8ad4024aecce24161633b5ab archiveSHA faa87321bae49fb9f74f577ccced6fc12c190246d2903904a6883284712fbbf0 restore/fsckPASS. CI122 exactda99762 passed native shader/WARP and actual DXGI reduced-readback probe; CI123 bf97488 managed text is running, no result inferred. Lab remains verifiedf109260/dev11. No Owner install, production/domain/Google callback/main/feed change; no DB migration. Native builds/tests only Actions from exact committed source. Fast media diagnostic workflow is not installer acceptance and does not replace the full9-job baseline. Next: Run exact-source native H264 encode, live scoped capture/bad-lease/closed-lease/resource cleanup, production WebCodecs full color decode and required managed262K matrix. Fix all actual failures, verify complete installer and independent source/hash receipts, integrate isolated Lab with rollback only after full CI. Do not give Owner a combined acceptance download until managed262K, GPU resize and video are implemented and checked together.

## Gate five isolated RM text stress cases on the exact installer binary

Complete the required CI graph without dropping real keyboard stress: publish one source/tree/hash-bound native RM helper and isolated editor fixture, reuse exactly those bytes for five isolated Windows262K stress jobs and the installer. Preserve all native/managed full readback, accessibility, newline, delayed-delivery, focus-switch and close assertions; only move the five long cases out of the serial installer job. Add strict native artifact source/file/hash intake and tamper regression. Fix H264 fixture missing System.IO and catalog revision3-only regression assertions while preserving fixed revision3 HMAC vector plus live current-revision checks. Recheck local desktop capability after video capture and remember confirmed native task close before awaiting bounded RAM relay cleanup. CI123 sourcebf974886fdad20ea996f9551913f95f3233e65c2 receipt artifact14094184006 SHA46332ca7524cdb71dc5711b126f7720361eb47beebeefedee9aab8ada9810e99 independently verified: RichEdit262K paragraphs444401ms, RichEdit262K single624994ms and Classic262K single1155132ms all full native/fixture readback with accessibility not activated. Serial40minute external timeout interrupted Classic paragraphs and prevented Win32 paragraphs; those two remain INCOMPLETE, not PASS. CI124 and fast media probe did not reach native video due compile/catalog test failures corrected here. Local native artifact tamper, proof contract/actual loopback HMAC and PowerShell AST checks PASS. Pre-change full checkpoint checkpoint/20261114-before-rmv2-resume-18a9b16 bundleSHA fe9db1ad53fe8d9feeefcf6deb90353f55526cf91a2ec2dfffbc4631691c854a archiveSHA bbc56daea350cb351e7773820b4791fc4b70b5a1af5023733be3763f95d67a55 independent restore/fsckPASS. Lab remains f109260/dev11; no runtime/DB/session/grant/Owner installation, production/domain/Google callback/main/feed change. Native .NET/Rust/Inno build and execution stay in Actions only. Hardware performance and physical Owner acceptance are not inferred from CI. Next: Require all15 full CI jobs including five262K stress cases on the identical installer helper bytes. Follow fast exact-source H264 encode, scoped live capture/close/resource checks and actual production WebCodecs synthetic-color decode; correct failures without relaxing product deadlines. Verify all text/media/source/hash receipts and combined installer, then isolated Lab integration with rollback. Owner acceptance download only after all requested features pass together.

## Verify native Wall proof vectors separately from the current catalog revision

CI125 reached the native Windows wrong-listener proof fixture and exposed its stale revision3 HMAC attached to revision4 metadata. Preserve the independently known revision3 and legacy revision2 vectors, add separate current-catalog HMAC/payload verification, retain nonce/PID/product/revision tamper assertions, and require currentRevisionProofOk in Actions. Production proof code and authority remain unchanged. Exact-source4373035 media diagnostics already PASS native software H264, hardware-preference fallback, scoped DXGI/GDI capture, lease/close/resource fences and16 real production WebCodecs color decodes. Native media run43563637077 artifact14101586328 SHA f2342a9176cae41d02ee5edfb30add0725b8db393ea3bf7c85c2a1f89161c274 independently verified PASS; physical hardware NOT_RUN. CI125 full run43563637175 failed Windows wrong-listener fixture before RM acceptance; five isolated text stress cases continue independently. Native source proof contract PASS after correction; no full installer or complete-plan PASS inferred. Full checkpoint checkpoint/20261114-before-rmv2-combinedproof-4373035 bundleSHA 34abb347986f4eeb0abca101e91f944ee4a2fbc185a43a3111f645eb825b9ced archiveSHA 3577f65e787db7650c5943daab450e2e49546769896c8672abd29c8c7090bce1 independent restore/fsckPASS. Lab remains f109260/dev11; no runtime/DB/session/grant/Owner installation, production/domain/Google callback/main/feed change. Native .NET/Rust/Inno build and execution stay in Actions only. Hardware performance and physical Owner acceptance are not inferred from CI. Next: Require all15 full CI jobs including five262K stress cases on the identical installer helper bytes. Follow fast exact-source H264 encode, scoped live capture/close/resource checks and actual production WebCodecs synthetic-color decode; correct failures without relaxing product deadlines. Verify all text/media/source/hash receipts and combined installer, then isolated Lab integration with rollback. Owner acceptance download only after all requested features pass together.

## Reject delayed encoded frames after RM video scope close

Close the encoded-video relay race: native close already releases control, but a previously signed in-flight frame could arrive on another connection after the relay delete and repopulate the Owner video. Retain exact actor/task closed keys for120s in bounded RAM (max1024, no pixel data); late frames including changed epochs are rejected. If close-key capacity is exhausted, bounded temporary video-push refusal preserves close rather than evicting protection. New unique task scopes work normally outside that rare overload condition; pixel TTL2s/16MiB/32latest and all A/B authorization remain unchanged. Real relay unit tests7/7 and signed push/private read route testPASS, including close followed by late newer frame, different epoch, no pixels/read after close, tombstone memory bound, expiry and fresh unique task recovery. Exact-source4373035 Windows media diagnostics PASS with real native H264 and16 WebCodecs decoded color frames; no full new installer acceptance is inferred. Native Windows proof revision fixture fix is in sourcef5c62fa; fullCI126 is running and will be superseded by complete exact-source CI for this race correction. Full checkpoint checkpoint/20261114-before-rmv2-finalproof-f5c62fa bundleSHA 758c429dd43b3c824bb52a84c1a06ba0dfc970ec6f652f070bb5a496e0cc12b3 archiveSHA 56ece0db0cf1ce92a26cc1650435142e2c17cca79116b216c84dd879188b6010 independent restore/fsckPASS. Lab remains f109260/dev11; no runtime/DB/session/grant/Owner installation, production/domain/Google callback/main/feed change. Native .NET/Rust/Inno build and execution stay in Actions only. Hardware performance and physical Owner acceptance are not inferred from CI. Next: Require all15 full CI jobs including five262K stress cases on the identical installer helper bytes. Follow fast exact-source H264 encode, scoped live capture/close/resource checks and actual production WebCodecs synthetic-color decode; correct failures without relaxing product deadlines. Verify all text/media/source/hash receipts and combined installer, then isolated Lab integration with rollback. Owner acceptance download only after all requested features pass together.
