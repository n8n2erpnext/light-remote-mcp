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
