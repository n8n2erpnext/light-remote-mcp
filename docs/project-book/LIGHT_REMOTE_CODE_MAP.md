# Light Remote MCP — Unified Code Map

Status: canonical source navigation, not runtime deployment proof
Edition: 2026-11-09
Codebase: n8n2erpnext/light-remote-mcp; compiled0.10.1-dev.4/source947a117, CI45 PASS; same-source internal Lab
Historical documentation foundation: de7eb2264d88546ecea00991730e596ee42768d3
API contract: [light-remote.api.v1](../../contracts/api.v1.json)
Endpoint catalog: [config/endpoints.json](../../config/endpoints.json)

## Runtime and trust boundaries

| Area | Verified source owner | Boundary / responsibility |
| --- | --- | --- |
| Operator entry and routing | [executor.mjs](../../operator-host/executor.mjs), [account routes](../../operator-host/executor-routes-account.mjs), [runtime routes](../../operator-host/executor-routes-runtime.mjs) | Server-side authority, account-scoped actions, private routes |
| Owner Snapshot | [desktop-v4-owner-snapshot.mjs](../../operator-host/desktop-v4-owner-snapshot.mjs), [activity page](../../operator-host/desktop-v4-owner-activity-page.test.mjs) | Device, grants, usage, jobs and sessions read models; not granting execution |
| A/B authority and sessions | [gold-ab-v2-grant-operator.mjs](../../operator-host/gold-ab-v2-grant-operator.mjs), [pending registry](../../lib/gold-ab-v2-pending-redis.mjs), [session store](../../lib/gold-session-redis.mjs) | Consent, device proof, owner/agent session lifecycle |
| Plugin server and OAuth | [server.mjs](../../plugin-server/server.mjs), [owner token routes](../../plugin-server/desktop-owner-token-v4.mjs), [operator client](../../plugin-server/operator-client.mjs) | External owner-facing endpoints, PKCE/Owner token, private Operator bridge |
| Desktop Wall SSO | [plugin public redeem](../../plugin-server/desktop-wall-sso-public-redeem-v4.mjs), [trusted Operator route](../../operator-host/desktop-wall-sso-signed-route-v4.mjs), [Agent transport](../../device-agent/desktop-wall-sso-agent-transport-v4.mjs), [browser bootstrap](../../device-agent/desktop-wall-sso-browser-bootstrap-v4.mjs) | Local owner consent + signed/device-bound ticket; live E2E incomplete |
| Local Agent A/B native IPC | [desktop-abv2-native-ipc-v4.mjs](../../device-agent/desktop-abv2-native-ipc-v4.mjs), [Windows Host](../../client/windows-native/GptOperator.Client/AgentHost.cs) | Local process/named pipe boundary; not equivalent to remote B acceptance |
| Local Wall & modules | [fleet-wall-runtime.mjs](../../device-agent/fleet-wall-runtime.mjs), [gold-wall-modules.mjs](../../device-agent/gold-wall-modules.mjs), [local activity log](../../device-agent/local-activity-log.mjs) | Device-local Wall, state and module requests |
| Desktop web UI | [App.tsx](../../client/desktop-v4/src/App.tsx), [FeatureScreens.tsx](../../client/desktop-v4/src/FeatureScreens.tsx), [native snapshot](../../client/desktop-v4/src/lib/native-snapshot.ts), [native inventory](../../client/desktop-v4/src/lib/native-inventory.ts) | Owner view; typed native commands, no direct cloud credential in UI |
| Desktop Tauri native | [main.rs](../../client/desktop-v4/src-tauri/src/main.rs), [owner_login.rs](../../client/desktop-v4/src-tauri/src/owner_login.rs), [owner_abv2.rs](../../client/desktop-v4/src-tauri/src/owner_abv2.rs), [owner vault](../../client/desktop-v4/src-tauri/src/owner_vault.rs), [endpoint config](../../client/desktop-v4/src-tauri/src/endpoint_config.rs) | Native storage, HTTP Owner snapshot, B-command preview/approval |
| Windows desktop host/tray | [Program.cs](../../client/windows-native/GptOperator.Client/Program.cs), [AgentSupervisor.cs](../../client/windows-native/GptOperator.Client/AgentSupervisor.cs), [TrayApplicationContext.cs](../../client/windows-native/GptOperator.Client/TrayApplicationContext.cs) | Host process, supervisor, native tray lifecycle |
| Windows updater/installer | [UpdateApplier.cs](../../client/windows-native/LightRemote.Updater/UpdateApplier.cs), [installer](../../client/windows-native/installer/GptOperator.iss) | Installer packaging/update; CI PASS != Owner physical PASS |
| Remote execution/shared services | [native terminal](../../lib/native-terminal.mjs), [SCP file](../../lib/light-scp-file.mjs), [process supervisor](../../device-agent/process-supervisor.mjs) | PTY/job/file execution under active Agent authorization |
| Persistence | [core SQL lock](../../platform-v2/sql/migrations.lock.json), [Owner extension SQL](../../platform-v2/sql/045_gold_single_owner_authority.sql), [project.manifest.json](../../project.manifest.json) | Explicit schema authority; 044 Pro Share remains deferred |
| Deployment & tests | [DEV runner](../../deploy/unified/dev.py), [test runner](../../deploy/unified/test.mjs), [test plan](../../deploy/unified/test-plan.json), [build manifest](../../deploy/unified/build-manifest.mjs) | Isolated candidate, pinned source/artifact proofs |
| Atomic commit gate | [commit-sync-gate.mjs](../../deploy/unified/commit-sync-gate.mjs), [pre-commit](../../.githooks/pre-commit), [CI truth](../../.github/workflows/ci.yml) | Reject code/docs commits lacking staged checkpoint, new handoff+Worklog receipt, exact Git source digest and affected docs; CI checks each new commit |
| Project truth | [truth check](../../deploy/unified/check-truth.mjs), [master checkpoint](../../MASTER_CHECKPOINT.json), [project truth](../../PROJECT_TRUTH.md) | One unified truth, no legacy .light-remote checkpoint |

## Owner Desktop V4 path — source, not a live Lab guarantee

1. [UI App](../../client/desktop-v4/src/App.tsx) reads native [Owner snapshot adapter](../../client/desktop-v4/src/lib/native-snapshot.ts).
2. [Tauri Owner command](../../client/desktop-v4/src-tauri/src/owner_login.rs) invokes the configured endpoint in [endpoint_config.rs](../../client/desktop-v4/src-tauri/src/endpoint_config.rs).
3. [Plugin Owner token route](../../plugin-server/desktop-owner-token-v4.mjs) handles Owner-bound read and calls the private Operator bridge.
4. [Operator account route](../../operator-host/executor-routes-account.mjs) is gated by LR_GOLD_ABV2_DESKTOP_READ_V4, using [Owner Snapshot read model](../../operator-host/desktop-v4-owner-snapshot.mjs).
5. [API contract](../../contracts/api.v1.json) and [endpoint config](../../config/endpoints.json) define routes and flags. Flag state **must** be observed in the deployed runtime; source file presence is insufficient.

## Canonical configured routes

The authoritative machine definitions are [config/endpoints.json](../../config/endpoints.json) and [contracts/api.v1.json](../../contracts/api.v1.json). These are **source declarations**, not proof of the API being enabled or deployed.

| Route key | Role | Method | Path |
| --- | --- | --- | --- |
| ownerAuthorize | owner | GET | /account/desktop/v4/authorize |
| ownerToken | owner | POST | /account/desktop/v4/token |
| ownerRefresh | owner | POST | /account/desktop/v4/refresh |
| ownerSession | owner | GET | /account/desktop/v4/session |
| ownerSnapshot | owner | POST | /account/desktop/v4/snapshot |
| ownerLogout | owner | POST | /account/desktop/v4/logout |
| ownerWallTicket | owner | POST | /account/desktop/v4/wall-sso/ticket |
| operatorOwnerSnapshot | operator/private-unix | POST | /v1/accounts/desktop-v4/snapshot |
| wallApprovePage | local.wall | GET | /approve |
| wallBApprove | local.wall | POST | /api/abv2/approve |
| wallModulesRead | local.wall | GET | /api/gold/modules |
| wallModulesConfigure | local.wall | POST | /api/gold/modules/configure |

Other route families exist; this table intentionally documents the relevant V4 control boundary and is not an exhaustive route/schema inventory. Use actual endpoint config for additions.

## Source status and regression boundaries

- Implemented: source modules above exist in the unified repository.
- Current Windows candidate/build and backend CI: source947a117, full CI45 PASS; [current acceptance](../evidence/desktop-user-experience/ACCEPTANCE.json) and [primary manifest](../evidence/desktop-user-experience/PRIMARY_EXE_MANIFEST.json). Earlier c03b50f evidence remains scoped to its own artifact/deployment.
- Historical reconstruction DEV integrated: [21-check receipt](../evidence/dev-integration.json) for candidate at c03b50f.
- Unknown/not complete: dev.4 Owner physical UAT, full Agent/browser SSO, physical signed remote commands and future public release/feed migration; see [Known Issues](../../KNOWN_ISSUES.md).
- Historical physical Windows proof 4dddf511 belongs to the **old** artifact; do not transfer it to the new build.

## Updating this map

Change this file when executable ownership, route/flag, IPC/transport, SQL or packaging boundary changes. Link to actual files in the **new** repo. Record the milestone in [Worklog](LIGHT_REMOTE_WORKLOG.md) and root [Checkpoint](../../MASTER_CHECKPOINT.json); run the project-book check. Do not paste a 188 KB legacy map or infer present truth from a historical handoff.

## Single-primary-executable work — prototype source boundaries

- [Native host adapter](../../client/desktop-v4/src-tauri/src/windows_host.rs): fixed installed paths and hostfxr ABI, twelve allowed Desktop actions and OS-only worker dispatch before Tauri/Owner initialization. No renderer-selected assembly/method/path.
- [Managed component](../../client/windows-native/LightRemote.WindowsHost/LightRemote.WindowsHost.csproj) and [bounded exports](../../client/windows-native/LightRemote.WindowsHost/EmbeddedHostExports.cs): reuse existing host WMI/Job Objects/native profile; library has no standalone managed entry point. Native Tauri remains the window/tray and Owner-vault authority.
- [Private runtime builder](../../client/windows-native/build-hosted-core.ps1) and [native proof](../../client/windows-native/test-hosted-core.ps1): a framework-dependent component resolves against private Microsoft frameworks, with executable fixture checks on hosted Windows CI. This was the initial proof boundary; the final one-primary package and real updater compatibility now PASS in CI #30.

## Primary migration — compatibility boundaries

- [CoreLayout](../../client/windows-native/Shared/CoreLayout.cs) is shared by updater and AOT installer watchdog. Installer metadata selects only fixed legacy/primary names for the compiled canonical product/profile; VERSION mismatch permits verified old-installer rollback selection, never an arbitrary JSON executable.
- [OwnedAgentHostStopper](../../client/windows-native/LightRemote.WindowsHost/OwnedAgentHostStopper.cs) is an OS-only CLI role. Exact executable/argv/SID/creation-time checks constrain stop to AgentHost. It never kills by port or generic image name, never stops the GUI or a managed command wrapper.
- Full updater quiesce includes exact installed core/legacy Desktop/Node paths. Agent-only restart remains separate. Native background GUI launches preserve an existing hidden window.

## Complete compatibility bridge recovery and installer layout guards

The shared CoreLayout now cleans only the known obsolete LightRemote.exe/primary marker after verified legacy rollback; it never recursively deletes supporting/runtime/data directories. The AOT watchdog quiesces only exact installed core/legacy Desktop/Node paths before restoring a prior installer. Installer SinglePrimaryExe and task marker support are prepared but dormant for the bridge. WMI stop implementation uses explicit System.Management types.

## Fix locatable WMI identity for owned Agent stop

OwnedAgentHostStopper uses EnsureLocatable=true with its bounded projected WQL query. This retains the WMI object identity needed by GetOwnerSid; SID, exact executable/parsed argv and creation-time checks remain mandatory. Diagnostics expose phase/type only, never command lines, SID values, credentials or local state. The source installer guard now requires legacy core, new primary core, legacy Desktop and bundled Node exact paths.

## Bind hosted component activation to the primary executable

In-process component activation and headless worker dispatch are now restricted to the exact primary LightRemote.exe. Legacy LightRemote.Desktop.exe always calls its fixed matching GptOperator.Client.exe bridge; a leftover windows-host DLL from a rolled-back installer cannot opt it into a newer implementation. No renderer/env/path selector was added. Source lifecycle regression requires this isolation.

## Hosted-core other-role fixture readiness

The native hosted-core proof starts a distinct managed-worker role with redirected stdin/stdout/stderr and a child-written readiness marker before calling Agent-only stop. The verified Agent host must exit while this wrapper and its child remain alive. This changes test setup only; the exact path/argv/SID/creation-time production stop guard remains required.

## Package one primary LightRemote.exe and prove native migration lifecycle

The official Windows V4 complete package now stages root `LightRemote.exe` after the same-source native hosted proof. [Stager](../../client/windows-native/stage-primary-core.ps1) removes only the exact old `GptOperator.Client.exe` and `desktop-v4/LightRemote.Desktop.exe`; supporting files and unrelated data remain. [Layout assertion](../../client/windows-native/assert-primary-layout.ps1) checks fixed product/profile/version, no component apphost, retained Node/RM/helper and a recursive EXE/hash/size inventory. The managed component is a library without an entry point; native early worker roles precede GUI mutex/WebView/Owner initialization.

[Installed lifecycle proof](../../client/windows-native/test-primary-installed.ps1) checks actual private CLR loaded in the GUI with global DOTNET_ROOT disabled, task/autostart/shortcut identity, hidden-window singleton behavior, Agent-only restart and GUI survival. [Real migration proof](../../client/windows-native/test-primary-migration.ps1) uses the exact pinned bridge, real controller/installers and fixture canaries, tests incompatible-helper preflight before Core stop, bridge→primary upgrade, reinstall, controlled downgrade, injected post-install runtimeconfig health failure with real rollback, legacy GUI isolation from leftover DLLs, manual failpoint/watchdog recovery and re-upgrade. CI-only fault executables are not included in the product artifact. No API endpoints, Owner/vault identity, grants or A/B authority were changed.

## Verify watchdog recovery by commit evidence and preserve migration failures

Primary migration proof now writes per-stage progress and captures only isolated CI updater status/report/log/watchdog diagnostics. A postinstall failpoint is proven by its actual abort log and independent watchdog recovery; it does not equate an installer process exit0 with a committed transaction. Cleanup waits for owned native watchdog completion and cannot mask the original failure. Shared CoreLayout exposes a compile-time supported-layout capability, so a regular non-V4 helper does not advertise the primary hosted product; updater self-test includes product/profile diagnostics.

## Record Owner pause and exact running primary build handoff

Owner pause receipt only: current executable implementation is work source1fb8335a21d0a6716df2322c8ed6f19265421421. Running CI42511023888 contains the final native migration/watchdog proof; inspect its actual result when Owner resumes. No executable boundary or runtime was changed by this documentation receipt.

## Resume build28 and wait for final PostgreSQL TCP readiness

Owner resumed after quota. deploy/unified/dev.py now waits for the final PostgreSQL loopback TCP listener rather than a default Unix socket, which can belong to the official image's temporary bootstrap postmaster. Initialization SQL still uses its existing local authentication and isolated resource labels; no production DB or Windows runtime changes. test_dev_readiness.py models bootstrap→shutdown→final startup and rejects the old premature-ready behavior; it also verifies bounded failure when final readiness never occurs. Core CI runs this regression before actual backend integration.

## Verified one-primary candidate closeout — 2026-11-09

Compiled source `31f23393aacb89b6d541cebb2cd0c2e1afa64538` passed full CI #30 and is on protected main. No new source boundary changed in this documentation receipt. The fixed-path in-process native/managed boundary, same-file OS roles, exact owned Agent stop, private runtime and independent update/recovery components are documented above. [Verified executable inventory](../evidence/windows-one-primary/PRIMARY_EXE_MANIFEST.json) and actual migration/lifecycle checks supersede historical pending prototype statuses. Existing serving runtime/Owner physical acceptance and public feed remain unchanged.

## Begin internal Desktop backend integration from verified source checkpoint

Owner clarified internal-only test artifacts, with no public binary release. Start actual Desktop/backend/Agent feature integration, Wall B regression investigation and displayed A/B/Desktop naming cleanup on permanent work. Verified full pre-change checkpoint and independent Git restore before edits. Known integration owners: client/desktop-v4/src/{App,FeatureScreens}.tsx; native owner_login.rs/owner_abv2.rs; device-agent/operator-agent.mjs and gold-wall-modules.mjs; plugin-server/desktop-owner-token-v4.mjs; operator-host/desktop-v4-owner-snapshot.mjs. Existing deployed Lab source drift is separate from these canonical source modules.

## Implement verified native device API and fix Memory startup and Desktop ACL gaps

Native command owner_login.rs::desktop_owner_device_request and owner_device.rs resolve only a fixed same-user Agent endpoint. Agent listener desktop-device-native-ipc.mjs verifies current Native Owner and enrolled account/device, and desktop-device-api.mjs projects bounded views/reuses existing controllers. Main/build/permissions explicitly list the command and inventory pagination. local-wall.mjs exposes private in-process activity log control only, with no new unauthenticated HTTP route. Memory usage initializes scoped schema independently of list/create ordering. Node regression tests use disposable real SQLite/socket resources. UI bindings and native CI remain pending.

## Include native device API in Agent package and preserve scoped Owner fence checks

client/core-files.json is the explicit distributed Agent import closure. It now includes desktop-device-native-ipc.mjs and desktop-device-api.mjs. These were implemented in c6d5735 but CI correctly rejected the incomplete package; no installed/runtime change occurred. Owner source check now separately verifies F14 and the added device command, each with HTTPS Owner verification plus generation fences.

## Connect Desktop controls to the verified Agent API and unify displayed names

client/desktop-v4/src/lib/native-device.ts owns typed native projections and stale/backpressure fences; NativeModuleScreens.tsx owns real Memory/Codex/Settings interactions and typed destructive confirmation. FeatureScreens binds exact local session/job controls, App supplies native status and scoped Owner refresh. owner_login checks expectedAccountId before owner_device exchange. Tray title is Light Remote Desktop with V4-title compatibility fallback; identifiers/paths/routes remain stable.

## Verify both real B approval flows and classify known Wall rejections

deploy/unified/dev-device-acceptance.mjs exercises real public MCP PKCE/client registration, synthetic Owner Wall login/CSRF, signed pending/approval, PG grant-backed MCP attach, independent Account B and private Agent IPC with module CAS/SQLite Memory/Codex/Settings. dev-acceptance invokes it before Owner refresh/revocation. dev.py initializes a private disposable OAuth secret and opts in native IPC. local-wall classifies safe B decisions; transport uncertainty never implies a failed or successful grant.

## Preserve explicit Agent start intent and isolate Owner rows during rendering

use-owner-inventory/use-owner-activity derive currently owned pages synchronously before rendering, in addition to async generation fences. NativeModuleScreens sends explicit confirmed Agent start/stop intent through DeviceLinkDialog, both fixed Rust allowlists and the in-process C# host. test-primary-installed.ps1 now proves repeated Start preserves the same actual running Node daemon and GUI. Portal consent/account HTML and MCP descriptions use the shared display naming.

## Read pinned migration bridge assets through bounded authenticated GitHub API intake

CI-only migration intake in client/windows-native/test-primary-migration.ps1 uses installerAssetId/manifestAssetId from config/windows-core-migration.json. windows-native-client.yml supplies its existing contents-read job token to that step only. Native application/updater implementation and product feed are unaffected.

## Record verified internal Desktop backend candidate and coherent Lab deployment

Current accepted2771f47 evidence is docs/evidence/desktop-backend/ACCEPTANCE.json plus exact BUILD_MANIFEST/PRIMARY_EXE_MANIFEST. Desktop native-device/NativeModuleScreens own real local actions; Owner typed page hooks synchronously filter current scope. Local Wall classifies known B rejections and preserves unknown outcomes. Current internal Lab Operator/Plugin are same-source; old enrolled Agent/Wall/supervisor/mTLS transport stay independent and retained.

## Rebuild Desktop as a user workspace and fix populated approval and monitor layouts

Desktop App.tsx retains native Owner/poller/action coordination, with synchronous current-Owner B/device display fences. WorkspaceShell.tsx owns shared navigation/header/account menu; WorkspaceViews.tsx owns Overview/AI Access/Settings presentation; components/ProductUi.tsx owns friendly badges/time/details. FeatureScreens.tsx provides filtered/bounded task/session/device/account views; NativeModuleScreens.tsx retains existing native actions and confirmations behind product controls. plugin-server/desktop-consent-page.mjs is presentation-only; desktop-auth-v4-server.mjs remains the security boundary. e2e/fixtures/user-experience.tsx is synthetic QA only and absent from the production entry/bundle.

## Fix Codex state usage Wall history PTY and responsive Desktop lifecycle

Codex runtime metadata/selection/counters are in [session view](../../device-agent/gold-codex-session-view.mjs) and [app-server RPC](../../device-agent/gold-codex-plus.mjs); [Desktop controls](../../client/desktop-v4/src/CodexControls.tsx), native-device projection/API and [Wall controls](../../device-agent/wall-codex-controls.mjs) share that authoritative state. [History reader](../../device-agent/activity-history-reader.mjs) streams complete retained logs with opaque cursor and1MiB/1000-record page bounds; [history UI](../../device-agent/wall-history-controls.mjs) keeps250 completed rows while paging older work. [PTY reader](../../device-agent/wall-pty-reader.mjs) preserves producer geometry/replay/transcript; native-terminal delays Windows PID fallback until drain opportunity. [Native callback](../../client/desktop-v4/src-tauri/src/callback_page.rs) embeds canonical public distribution CSS/SVG/font; no callback credentials rendered. Native owner auth/browser work is async; installed lifecycle now checks Close/reopen3 cycles and real packaged ConPTY->Wall. Synthetic browser [follow-up QA](../../client/desktop-v4/e2e/wall-followup-smoke.mjs) is not in the production renderer.

## Align follow-up SSO branding and cross-language HMAC revision fixtures

HMAC fixture revisions live in selftest-goldabv2-local-instance-proof-t11.mjs, Rust wall_instance_proof.rs and Windows GptOperator.Client/Program.cs. Revision2 stays explicitly covered; current revision3 uses its own known vector. SSO bootstrap tests assert current product copy, canonical SVG/font and self-only font/script CSP.

## Defer Windows close hide beyond callback and preserve installed responsiveness checks

unified_tray.rs::hide_on_close prevents destruction and defers hide outside the window event callback. test-primary-installed.ps1 retains3 Close/reopen cycles and adds bounded WM_NULL responsiveness receipts native-close.json, even when visibility fails. Gateway oauth.mjs now actually emits the canonical @font-face already imported by its retained OAuth page.

## Restore singleton window through owning Tauri runtime to synchronize visibility

unified_tray.rs publishes/consumes fixed native singleton show event while preserving mutex/title compatibility. signal_existing_gui sends no payload, skips --background, and owning runtime restores via show_main worker to keep cached visibility/minimize state coherent. Installed test requires event existence and bounded restore, then same3s/3cycle hide/WM_NULL/Agent PID proof.

## Reconcile actual hidden window state before singleton restore

unified_tray.rs::show_main worker queries window.is_visible (native OS), normalizes cached hide only when actually hidden, then show/unminimize/focus on owning Tauri runtime. This handles CI60 raw-hide restore while retaining CI59 shortcut Close repair. Installed test code is unchanged in this source repair.

## Bind recovery Wall health proof to validated installed package revision

Shared/WallListenerOwnership.TryInstalledRevision bounds and validates the installed product/profile marker. IsInstalledWall is used only by Updater/InstallWatchdog recovery health; normal IsExpectedWall stays compiled-revision strict. Shared/LocalWallChallengeProof adds explicit expected-revision overload while retaining default compiled revision and nonce/MAC/PID validation. Native fixture Program.cs covers current/legacy marker selection plus wrong profile/oversized marker. CI61 installed Close and real ConPTY were PASS; final cross-revision watchdog must pass on the repaired exact source.

## Align recovery ownership guard with installed revision proof

selftest-goldabv2-wall-listener-ownership-t11.mjs distinguishes normal GUI compiled-revision IsExpectedWall from Updater/InstallWatchdog IsInstalledWall recovery. It still asserts listener PID, exact runtime path, product/profile marker, default strict probe and explicit revision MAC proof.

## Prove native auth UI liveness with synchronized worker release

owner_login.rs auth_ui_liveness_tests now holds native work until an independent async timer releases it. The helper must return the timer-origin signal; emergency release fails the test. This catches inline vault/mutex blocking while avoiding a150ms elapsed threshold affected by shared-runner scheduling. Existing begin/restore/logout owner_work spawn_blocking boundary is unchanged.

## Verified dev5 owner-test handoff — 2026-11-10

Source8e0d932920d218c54f83989978f3866c321e20de, treefec7d9f8a8242358daf44a13faf2735e18520e2b, CI64 PASS9/9. [Acceptance](../evidence/desktop-followup/ACCEPTANCE.json), [build](../evidence/desktop-followup/BUILD_MANIFEST.json), [primary package](../evidence/desktop-followup/PRIMARY_EXE_MANIFEST.json), [actual backend25](../evidence/dev-integration.json). Existing follow-up source maps remain valid. Native actual Close3cycles, real ConPTY and real cross-revision watchdog rollback PASS. Synchronized auth liveness passes45/45 native tests on both Mac/Linux. Work published; main and Lab unchanged. Owner self-install/test next.

## Checkpoint fresh Windows distribution redesign and verified dev5 Lab deployment

New distribution plan: [tray/setup redesign](../plans/windows-distribution/TRAY_INSTALLER_REDESIGN_20261110.md). Current tray boundaries unified_tray.rs vs TrayApplicationContext.VisualFor/TrayIconFactory; installer GptOperator.iss V2 to be replaced by a fresh Moryqa/native design, with stage-primary-core.ps1 empty-directory guard. [Dev5 Lab receipt](../evidence/distribution-redesign/DEV5_LAB_DEPLOYMENT.json) records actual verified server update.

## Implement fresh Moryqa Windows setup uninstall and five-state primary tray

New tray_visual.rs owns pure fail-closed display projection and five exact embedded32px RGBA exports; unified_tray.rs updates its existing TrayIcon on the bounded status worker, no idle pulse. TrayApplicationContext.DesktopBridgeJsonAsync(status) exports its existing VisualFor result. Native LightRemote.Wizard.iss replaces old Windows V2 setup presentation; GptOperator.iss retains installer transaction/recovery and includes the new views. stage-primary-core.ps1 plus Inno dirifempty remove only the empty legacy directory. test-distribution-ui.ps1 exercises actual native six-view flow, font, progress, controls and unrelated-file preservation in isolated Windows Actions. [Moryqa exports](../design/windows-distribution-v3/README.md).

## Native title font measurement in the owning installer

LightRemote.Wizard.iss LRText copies the actual LRTitle TFont to a process-local bitmap Canvas, selects it through TextWidth and resolves it with GetTextFaceW. Only sanitized face/width are logged. test-distribution-ui.ps1 reads that native measurement and retains the strict Google Sans assertion; invalid external HFONT/DC imports are removed. It retains rendered failure PNG/JSON diagnostics and uniquely waits for the final uninstall title. No font fallback is accepted by CI; Owner installation is unchanged.

## Correct native title lines card surfaces and uninstall button selection

LightRemote.Wizard.iss LRText splits explicit title/body lines into accessible native controls with fixed line pitches; original packaged Google Sans remains unchanged. LRSurface/LRView own their panel colors with ParentBackground=False/StyleElements=[], and info/footer text uses matching backgrounds. test-distribution-ui.ps1 restricts actions to native Button/CheckBox classes and verifies painted second-heading ink plus card pixels in actual PrintWindow captures; it uniquely waits for the final is-uninstalled title.

## Retain bottom margin for native Google Sans heading descenders

LRView heading allocation is102px, retaining room below the second native Google Sans line; LRText first-line pitch remains46. test-distribution-ui.ps1 records secondTitleBottomMargin and blocks descender ink touching the label edge, using actual PrintWindow pixels. CI71 remains a verified full baseline; the final exact-source run is distinct.

## Record Owner stop-build instruction and next native acceptance checklist

Owner defers build/test after final source0397d871. Current native map remains tray_visual.rs/unified_tray.rs + VisualFor projection, exact Moryqa assets, LightRemote.Wizard.iss six-view native UI and safe empty-directory cleanup. The final102px title allocation and bottom-margin image assertion await native verification. UI baseline302c662/CI71 proof is retained separately in docs/evidence/distribution-redesign/CI71_NATIVE_UI.json. No final artifact/runtime acceptance is inferred.

## Document RM v2 native cursor preservation, input latency defects and optional GPU roadmap

Read-only RMv2 research at work764e1d7 maps native RobotContext/SystemCursorOverride/NativeInput/DesktopVisual/RobotRpcServer, lib/real-remote-input.cjs + native-desktop.mjs, Plugin tools, Operator executor and Agent visual sessions in [the proposed plan](../plans/RMV2_RESPONSIVENESS_CURSOR_GPU_PLAN.md). Findings distinguish legacy all-role/startup behavior from remaining normal-pointer override, process-local restore state, dropped motion timing, zero-interval defaults, serialized native work and CPU JPEG. No executable ownership, route, API contract or runtime changed; proposed DXGI/video providers are not implemented.

## Extend RM v2 plan with target-verified typing and long logical input

Read-only typing follow-up maps Plugin tools.mjs text/value schema -> shared lib/real-remote-input.cjs normalizer at Operator/Agent -> lib/native-desktop.mjs -> Windows RobotContext/NativeInput and UIA UiSensor/SemanticSessionManager; macOS main.swift/SemanticEngine are a scoped comparison. [Existing RMv2 plan](../plans/RMV2_RESPONSIVENESS_CURSOR_GPU_PLAN.md) records4096limits, semantic slice truncation,10/20s deadline mismatch, event-versus-content receipts and proposed real-control-bound verification/long logical writes. FocusedSemantic literal focused is not a stable control identity. No route, executable, schema or active API contract changed.

## Plan local Memory retention, ChatGPT Claude extension and multi-provider API Worker

[Local Memory/extension/API Worker research plan](../plans/LOCAL_MEMORY_EXTENSION_API_WORKER_PLAN.md) maps local-wall -> Memory scope admin/SQLite/signing; gold-memory-sync -> dedicated signed channel/memoryRelay RAM, separately Plugin gold-memory-bridge -> generic exec -> operations.jsonl script/stdout event persistence. Extension variants local0.2/Lab0.3 are ChatGPT-only/manualstaging. Codex metadata map is NativeModuleScreens codex.read -> cached module view -> plus.snapshot, versus account()/refreshMetadata and Owner local supervisor/coordinator. Public MCP worker/Claude/Gemini adapters remain unimplemented proposals; no route/contract/executable boundary changed in this documentation task.

## Fix native installer surfaces and typography, tune tray and integrate Google sign-in

`device-agent/desktop-wall-sso-agent-runtime-v4.mjs` composes existing signed redemption, live-family verification and OS-private IPC under exact Gold profile/auth/host gates; wired in daemon and wall-only, with cleanup. Client core manifest includes closure without server-only imports. `AuthEntry`/native-owner/owner_login add a fixed Google hint; desktop-auth routes through same-origin existing provider. `google-auth` binds flow to credentials/current callback; admin displays external registration caveat. Native Wizard.iss owns card ancestry and measured title/body layout; distribution proof inspects actual pixels on six views.

## Preserve production Google callback for domain rotation and verify explicit Wall SSO gates

`google-auth.mjs`: saved callback retained and checked against running origin; staged/active metadata contains no secrets. `account-portal.mjs`: unavailable provider retains native next intent. `desktop-wall-sso-agent-runtime-v4.mjs`: independent SSO feature flag; existing Desktop native flag alone creates no pipe or Wall login link. Tests exercise no implicit I/O and race/revocation/bind failures.

## Capture native installer geometry before full builds without weakening UI checks

`client/windows-native/installer/LightRemote.LayoutProbe.iss` and LayoutProbe mode of `test-distribution-ui.ps1` give early CI-only native geometry diagnostics. `windows-native-client.yml` runs it immediately after Inno compile preflight; existing full native installer/lifecycle checks retain authority.

## Fit native Google Sans labels to actual GDI ink while retaining descender padding

Production Wizard LRTextInkHeight uses private GDI bitmap/DrawText/GetPixel with exact caption/font/wrapping; LRText and LRMeasureBlock both consume ink height plus scaled padding. Font asset, native accessibility and transaction callbacks unchanged.

## Record native wordmark capture coordinates while retaining ink assertions

test-distribution-ui.ps1 records wordmark/root/sample coordinates to diagnose native PrintWindow mapping while retaining all ink/geometry/background checks.

## Inspect the active native wordmark and hide covered stock wizard headings

Wizard CurPageChanged hides stock PageNameLabel/PageDescriptionLabel only on branded pages. test-distribution-ui chooses wordmark from same active surface as the second heading and excludes large headlines; actual pixel/descender checks unchanged.

## Keep compile-only cleanup in its owning CI step after native Welcome passes

Windows workflow separates compile-only output/cleanup from payload-free layout probe output; no product code change in this receipt.

## Record CI84 internal installer acceptance, Lab rollout and preserved Google callback

Current installer source uses actual GDI ink measurement plus scaled descender padding, actual colored card parents and hidden stock headings; native proof selects the active branded wordmark. CI84 six views/one primary/migration/lifecycle PASS. Runtime Operator/Plugin pin3064f21; evidence in windows-distribution/20261111-acceptance.json. No RMv2 cursor/typing/GPU or API Worker implementation is included.

## Preserve native RMv2 cursors and honor precise input timing

Native Windows ownership: client/windows-native/GptOperator.RealRemoteV2/ControlActivity.cs handles metadata-only hooks, generation cancellation/desktop fencing; CursorGlowOverlay.cs owns badge/4edges; NativeInput.cs tags packets/cleans only owned downs; RobotContext.cs scopes operations and text receipts; RobotRpcServer.cs adds timing and disconnect watch; SystemCursorOverride.cs is explicit recovery only. lib/real-remote-input.cjs + native-desktop.mjs preserve zero/timing and bridge receipt; Agent visual minInterval0 fixed. Native acceptance is client/windows-native/test-rmv2-phase1.ps1, portable mapper check deploy/scripts/selftest-rmv2-input-contract.mjs.

## Read native cursor bitmap proof without PowerShell GDIplus coupling

RMv2 native proof lives in client/windows-native/test-rmv2-phase1.ps1 and now hashes GetIconInfo/GetBitmapBits data directly; .github/workflows/windows-native-client.yml archives phase1 JSON. Product boundaries remain those of the preceding phase1 implementation.

## Fence Owner input at operation start and repair hosted Ubuntu mirror

ControlActivity.cs now captures generation before quiet preflight, closing the start race, and marks paused-local-input only for actual recent/in-flight control. Native source-only self-test covers passive vs interrupted state. Hosted CI mirror helper is .github/scripts/hosted-apt-mirror.py; only desktop-v4-native-ci.yml invokes it on disposable hosted Linux runners. No product routes/permission boundary weakened.

## Keep RMv2 input hooks independent of overlay rendering

ControlActivity.cs additionally owns a dedicated hook message-pump thread and bounded startup/teardown, separate from CursorGlowOverlay WPF dispatcher. No new endpoints/authority or cross-device routing. Existing generation guards and own injected markers remain.

## Handle observed hosted apt mirror list after Windows RMv2 acceptance

Hosted-only apt helper now covers /etc/apt/apt-mirrors.txt identified in CI89 logs; product/runtime entrypoints unchanged. Native final functional evidence is docs/evidence/rmv2/phase1-ci89.json, explicitly not whole-baseline acceptance.

## CI90 snapshot and DNS recovery

The distribution UI probe filters the branded wordmark before geometry and retries only invalid HWND acquisition with a fresh view within6s. All acceptance assertions remain intact. Hosted apt helper includes actual apt-mirrors.txt, exact Ubuntu HTTPS hosts, upstream bounded acquire settings, and strictly validated two-host HTTPS DNS recovery only after system resolution fails on disposable GitHub runners. No product or ARM runtime path changed.

## Bound smooth-motion wait slices for prompt Owner interruption

NativeInput.Move keeps absolute monotonic pacing but caps individual Thread.Sleep calls at8ms, matching interruptible click/key/drag delays; activity generation is checked after each slice. Dedicated hooks remain independent of UI rendering.

## Keep RMv2 working sessions visible and yield input without failing Agent sessions

ControlActivity owns first-input-armed working-session indicator lifetime and OwnerInputPause metadata. RobotContext converts input yield to paused/sessionRetained data receipt without closing RPC/Agent/session. NativeInput.WriteText retains sent-unit count on yield; no inserted-text proof. CursorGlowOverlay scans visible cursor pixels and sizes real WPF edge content plus physical HWNDs on every monitor; diagnostics reports actual rectangles, painted center alpha and click-through for CI. No new public auth endpoints.

## Keep paused RMv2 session awareness visible during Owner work

ControlActivity.PausedFeedback now stays active while the existing visual/semantic working session remains live, or8s standalone. Locked/disposed/detached state hides it. Source plan records shared foreground pointer/focus and future background-provider boundary. No privilege/input-block/session termination change.

## Record CI94 acceptance and Owner explicit RM session completion contract

Next boundary changes are Agent-owned desktop visual rows/input dispatch, native visual detach/activity lifetime and overlay palette, native bridge scope forwarding, plugin tool lifecycle instructions. Scope ownership must remain A/B session+Agent; close/expiry must fence late responses and input, not revive scopes.

## Require explicit RM task scopes with confirmed close,45s orphan cleanup and sky-blue awareness

[rmv2-task-lifecycle.mjs](../../lib/rmv2-task-lifecycle.mjs) and its unit tests implement owner-bound selection, pending-operation tracking, close acknowledgment and late-response fences. Device Agent visual rows provide45s in-flight-safe timers and task-linked observation cleanup. NativeDesktopBridge forwards Agent-generated private visual ID/token for input/run/semantic actions; Operator normalization preserves public desktopSessionId. RobotContext validates supplied native lease and synchronously hides the ended working scope; VisualSessionManager.IsActive binds indicator to exact lease. Tool descriptors/helper/API contract expose attach/close/reopen requirements. CursorGlowOverlay palette is#DCEEFF/#0F456B/#4AA7DF.

## Package RM task lifecycle module and retain scoped input receipt compatibility

client/core-files.json now includes lifecycle runtime module in the actual Windows Agent package. RobotContext.AddVisualReceipt merges visual lease acknowledgment into existing native input object, preserving previous field paths.

## Acknowledge already-closed RM tasks and protect in-flight resume

rmv2-task-lifecycle exposes bounded owner-bound remember/confirmed close receipts; Agent stores sanitized metadata after native close acknowledgment. resume is a tracked real RM operation, so explicit close drains lease recovery too.

## Add ordered RM work with fast scoped cancel and explicit pointer profiles

RpcWorkScheduler.cs owns bounded native lanes and per-native-scope queued cancellation epochs. RobotRpcServer keeps reading pipe requests while workers run and correlates out-of-order responses by ID; ControlActivity cooperative cancel keeps task/Agent alive. NativeDesktopBridge maps cancel; Operator enforces input capabilities and target platform; device Agent verifies exact RM owner and bypasses lease-resume queue before cancel. Plugin registers new governed tool/helper. InteractionProfile.cs supplies explicit pointer timing defaults.

## Retain explicit legacy RM timing paths alongside opt-in profiles

Compatibility timing stays explicit in NativeDesktopBridge event mapping and NativeInput.Click; opt-in precision/responsive overrides occur only when selected. Program native self-test now includes InteractionProfile behavior plus RpcWorkScheduler concurrency.

## Add target-bound Unicode writes with verified progress and live authority checks

lib/rmv2-text-write.mjs owns device-local async orchestration, full preflight, deadlines, per-chunk authority, dedupe and truthful uncertain-effect receipts; rmv2-text-source.mjs owns pinned read-root-bound UTF8 reference; rmv2-semantic-value.cjs rejects invalid complete semantic values. operator-host/rmv2-work-authority.mjs is called only behind verifiedChannelContext. Device public proxy explicitly whitelists its action. Operator/Plugin named text tools dispatch new text-write-* ops; Agent holds full RM task lifetime and maps private desktop.text.start/chunk/finish. Native LogicalTextWriter.cs and TypingTarget.cs retain target/readback privately on the ordered MTA worker; NativeInput.WriteLogicalChunk coalesces grapheme-safe key-event packets with per-packet focus/owner guards. test-rmv2-text.ps1 is Actions-only real-control acceptance.

## Correct native logical write variable declaration for CSharp

CI102 Windows failed at native compile CS0819 before the new text fixture. Split RobotContext FinishTextWrite local var declarations; no behavioral/test/threshold changes. Core/backend/Web passed for sourceef54911. New Actions proof pending; no CI102 artifact accepted, no Lab/Owner/production changes.

## Reuse fresh RM capture buffers and add crop-aware frame coordinates

GdiFrameCache.cs owns one private bitmap/pixel/codec/stream/encoded entry and fresh-pixel change detection; DesktopVisual.cs validates screen-local crop, pins topology across capture and reports actual limits/mapping/timing. VisualSessionManager retains crop and supplies prior SHA omission hints. RobotContext clears capture cache at final visual close/helper exit. lib/rmv2-capture.mjs validates ROI and converts opt-in exact-latest-frame pixel centers to physical virtual coordinates using Agent-held metadata; real-remote-input.cjs preserves its validated common fields through two normalizers. Agent stores/clears mapping on actual reads/native recovery; native bridge forwards pinned ROI/previous SHA. RobotRpcServer coalesces generic ui.changed events with one-slot channel; semantic events remain separate. test-rmv2-capture.ps1 is Actions-only ROI/JPEG/cache-clear measurement; text fixture and wall-followup browser fixture now synchronize actual responses.

## Bind typing target before cooperative large-text preparation

lib/rmv2-text-write.mjs now separates cheap logicalTextSpec from a shared grapheme generator and asynchronous collector. RmTextWrites.start captures the native target, then the full owner-scoped background promise includes cooperative preparation and input/readback. prepareAndRun reports0 accepted/sent until full validation and handles preparation errors without replay; unexpected run errors remain indeterminate. Agent native adapter renews only the exact existing native visual lease during actual running preparation. test-rmv2-text.ps1 now records safe synthetic failure units/hash/first-difference/final metadata, not raw control content. CI104 capture receipt is pinned separately from its failed overall text run.

## Separate root-guarded UIA observation from ordered input

RpcWorkScheduler adds a separate bounded observation channel and persistent MTA for uia.snapshot, semantic snapshot/events and aliases. SemanticSessionManager pins roots, guards publication/live membership, atomically reads event/root metadata and rejects pre-action root drift; post-action acknowledgement changes carry resync/no-replay. No AutomationElement is transferred between lanes. test-rmv2-text.ps1 records metadata-only progress and kills isolated helper before pipe cleanup; windows-native-client.yml limits that step to eight minutes without changing acceptance criteria.

## Isolate native text acceptance from PowerShell UI runspaces

client/windows-native/TestFixtures/Rmv2TextFixture contains an Actions-only two-control STA WinForms executable, metadata counters and a current-user pipe. test-rmv2-text.ps1 remains the same exact logical-write/offset/full-readback/focus-switch acceptance driver, but delegates only control creation/reset/read/focus to that process. No change to NativeInput, TypingTarget or product logical writer is included in this diagnostic packet.

## Add optional exact-monitor DXGI capture with fresh GDI recovery

DxgiCapture.cs owns optional exact-adapter desktop duplication, bounded staging, validated row-pitch/ROI BGRA-to-BGR conversion, finally release/unmap and default-GDI recovery. Its native selftest covers ROI/channels/padding/negative stride/invalid geometry. DesktopVisual and GdiFrameCache share the existing JPEG/fresh-pixel cache for both providers with serialized capture/clear; RobotContext reports actual/capability distinctions without granting authority. Test-rmv2-capture.ps1 validates both strict default GDI and opt-in DXGI/explicit fresh fallback, and records fallback-only separately. benchmark-rmv2-capture.ps1 alternates same-runner exact prior/current GitHub-built capture samples with source/EXE hashes. New test fixture and baseline comparison outputs stay outside product staging.

## Wait for native text delivery and fence expired input authority

TypingTarget.WaitForDelivery reuses exact prefix/suffix readback with focus/Owner/cancel/deadline guards; empty ValuePattern is a getter preference only. LogicalTextWriter bounds native chunks128 and records historical observed prefix separately. rmv2-text-write orchestrates128-unit grapheme-safe work and fresh authority budgets; native-desktop subtracts startup time, RobotRpcServer binds native queue-inclusive deadlines, and RobotContext forwards only the receiver-bound deadline. Agent adapter recognizes proven pre-admission expiry as no new input. ControlActivity exposes operation/Owner metadata generations for SemanticSessionManager concurrent-read hints. packages.lock.json is imported from verified Actions, locked restore enabled, and DxgiCapture uses explicit native output types.

## Keep RM capture cleanup responsive and correct native measurements

DesktopVisual.ClearCaptureCache now atomically requests cleanup and TryEnter avoids waiting while VisualSessionManager gate is held; Capture drains before/after and CleanupSelfTest validates contention. CaptureCapabilities.cleanupPending exposes deferred cleanup. test-rmv2-capture asserts closed-scope resources clear. benchmark-rmv2-capture uses shared handlerMs, typed closed-pipe disposal catches; test-rmv2-text terminates both processes before pipe disposal. deploy/unified/build-manifest adds native locked dependency hash.

## Amortize verified text windows without dropping target checks

rmv2-text-write.textChunks and LogicalTextWriter.Prepared/Chunk agree on unpaced256-unit windows with max-grapheme128 retained. LogicalTextWriter delegates the verified post-send CheckFull to TypingTarget.WaitForDelivery; TypingTarget.Verify avoids its duplicate initial check only when the same readback performs it. test-rmv2-text honors native bounded window and records per-size elapsed/last handler/queue counters. CI110 timeout and corrected capture comparison are pinned under docs/evidence/rmv2.

## Fence new text packets while completing read-only verification

NativeInput.WriteLogicalChunkCore centralizes actual packet construction/guard/send/delay and is exercised by LogicalPacketSelfTest with a recording sender. Production wrapper retains activity/modifier validation; no test sender is exposed through RPC. LogicalTextWriter uses AdmitPacket before new input and ObserveGuard for post-send/readback, records phase and textTiming plus deadline-at-receipt. Program selftest reports logicalPacketGuardsOk. test-rmv2-text persists actual failure ACK/phase rather than leaving RUNNING unless the external runner forcibly times out.

## Back off delivery observations and diagnose exact fixture content

TypingTarget.PollDelivery isolates the real polling loop for virtual-clock tests; backoff caps120ms and retains guards/exact compare/1500ms. Program selftest reports deliveryPollingOk. test-rmv2-text writes three direct fixture snapshot diagnostics after a failed ACK without sending/replaying input or weakening failure. Rmv2TextFixture declares1M capacity and reports capacity/word-wrap metadata. CI112 text/cursor/DXGI evidence is pinned under docs/evidence/rmv2.

## Verify slow text completion across explicit editor capacities

TypingTarget.PollDelivery uses5second read-only budget and virtual-clock timeout test; mutation packet deadlines unchanged. Rmv2TextFixture supports real classic Edit, genuine Rich Edit1M capacity and optional owned classic WM_CHAR delay, all test-only outside staging. test-rmv2-text records controlKind/wordWrap per exact-size case, adds actual delayed completion proof and keeps classic wrapped262K explicitly NOT_ACCEPTED. CI113 late-delivery evidence is pinned.

## Align keyboard indicators and explicit text acceptance layouts

RobotContext.HandleAsync binds logical keyboard activity screen before Begin, retaining existing mutation target guards. LogicalTextWriter.MaxChunkUnits and TypingTarget.DeliveryWaitMs feed both behavior/status. test-rmv2-text asserts status/prepared agreement and full line-ending-only content match for explicit paragraph layout; docs/evidence/rmv2/text-ci114.json pins actual failing giant Rich Edit paragraph plus classic positive receipts.

## Deliver line breaks only to bound native multiline editors

NativeInput.WriteLogicalChunkCore handles native multiline line breaks inside the same guarded packet loop. TypingTarget.NativeLineBreakPolicy binds/checks native HWND class and ES_MULTILINE+ES_WANTRETURN; Metadata reports capability. Program native selftest requires nativeLineBreakPolicyOk and extended logicalPacketGuardsOk. Rmv2TextFixture explicitly declares WANTRETURN; test-rmv2-text tests6LF/CRLF/CR cases before sizes. CI115 scoped evidence pinned.

## Separate native Edit acceptance from managed editor stress cases

TestFixtures/Rmv2TextFixture.NativeEdit creates a genuine Windows EDIT HWND with CreateWindowExW; NativeWindow records counters, default native WndProc/UIA provider remains. Managed controls remain separate. test-rmv2-text runs9newline cases and delayed completion before sizes, tests262K only on declared pure native EDIT paragraph layout, and records all managed262K limitations. CI116 native/capture/text evidence is pinned.

## Allow full native text completion and retain macOS checks

windows-native-client workflow IDs text acceptance, gives real-keyboard stress40minute CI budget, classifies unfinished receipts as INCOMPLETE, and rejects successful-step/missing/nonPASS receipt inconsistencies. Whole Windows job bounded110minutes for text plus installer/rollback. desktop-v4-native-ci pins macos-15-intel for same Darwin tests due verified hostedARM64 capacity failure; no source/runtime or branch-gate change.

## Record verified dev11 candidate and scoped remaining RM work

Current native logical typing/scheduler/capture and lifecycle boundaries are summarized in the single Master Checkpoint and docs/evidence/rmv2/acceptance-ci118.json; historical flat source/CI fields were moved to history.

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
