# Build and deployment

## Current internal candidate — 2026-11-10

Internal **0.10.1-dev.5**, one primary **LightRemote.exe**. Compiled source `8e0d932920d218c54f83989978f3866c321e20de`, tree `fec7d9f8a8242358daf44a13faf2735e18520e2b`. [CI64:9/9 PASS](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42803494868) · [internal installer](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42803494868/artifacts/13758302838) · [acceptance/manifests](docs/evidence/desktop-followup/ACCEPTANCE.json). Installer SHA256 `f48d002dfe94b408c968740e7db4cd7758146b707559159086999e2afee880af`, bytes168947869. The delivered installer remains pinned to that compiled source; this documentation receipt has its own Git SHA.

Exact-source CI64 PASS9/9: Node284, portable suite70, React125, browser170 plus4 actual-server Wall groups, private backend25 checks including both B paths. Windows build/install/private CLR/Close3cycles/WM_NULL/real ConPTY/bridge upgrade/reinstall/rollback/watchdog/uninstall PASS. Linux/macOS native tests45/45 each, including synchronized async timer/worker liveness. Full Mac/Linux installers and Owner physical acceptance are not inferred.

Lab Operator/Plugin now serve exact GitHub8e0d932/dev5 after CI64/artifact verification and private backups. Public/private health/API and unauthenticated snapshot401 PASS; persistent counts and independent Agent/Wall/supervisor/mTLS PIDs are preserved. No SQL migration or Owner Windows change. Prior947a117 runtime remains for rollback. Remote consent branding is deployed. Main remains8ac6273; permanent work is active. New task: restore tray state icons and redesign Windows install/uninstall in Moryqa, reuse STOCK logo, remove only empty desktop-v4 directories, then build internal dev6.

Owner downloads and tests this exact internal artifact. Native builds remain Actions-only. Dev5 Lab deployment is complete; new tray/setup build and main promotion are pending. No failed candidate is accepted.

Earlier candidate records below retain their original scope.

One entrypoint: `.github/workflows/ci.yml`. Reusable Desktop QA and full Windows build/installer workflows share the exact checkout SHA and `goldabv2-desktop-v4` profile. Old branch-triggered workflows are historical recipes only. No automatic production publishing or update feed activation exists in this baseline.

Portable verification: Node 22, `npm ci --ignore-scripts` at root/Plugin, `npm test`, `npm run check:truth`. Desktop web: `npm ci` and `npm test` / `npm run build` under `client/desktop-v4`. Native Windows builds use CI's .NET/Rust toolchain, not old VPS stages. Windows keeps the complete Agent, tray, RM V2, updater, rollback, install/uninstall staging checks.

`deploy/unified/build-manifest.mjs` requires an exact clean Git HEAD and records source commit/tree, version, contract, feature profile, dependency/config hashes, platform/run identity and supplied artifact SHA-256. Package `BUILD_MANIFEST.json` beside the installer. Signing and physical acceptance remain false unless independently proven.

`python3 deploy/unified/dev.py test` builds from `git archive HEAD`, starts private PG/Redis/runtime resources, migrates only the fresh marked fixture database, runs real integration and removes only its own labelled disposable resources. `start` retains a successful private candidate; `status`/`stop` check ownership labels. Raw private logs and credentials are excluded from CI artifacts. Only sanitized reports and build manifests are uploadable.

The official GitHub repository is now new repository ID 1450214328. Historical CI validation branches exist only in the archived old repository. Source publication uses Git-over-SSH from ARM; active controller branches are main and codex/**.

Repository conversion is complete with Owner authorization and verified recovery. Old repository history is retained in the read-only archive; the official URL has a new repository ID and fresh history. New builds use exact commits in this repository. Clone/fetch into new candidate directories and verify source/artifact/schema; never synchronize over old source/runtime. Production/data/traffic cutover remains a separately controlled step.

Native dependency resolution is checked before expensive builds. Tauri forwards `-- --locked` to Cargo ([official CLI reference](https://v2.tauri.app/reference/cli/)); native Rust tests also use `--locked`. A resolver failure uploads a candidate lock/diff for review and blocks native jobs. Commit that reviewed lock before retrying. A post-build tracked-source drift still fails provenance and lists changed paths; no reset/ignore operation hides it.

Accepted build source and artifact hashes are in docs/evidence/windows-build-manifest.json. Dependency hashes in build manifests describe the target checkout bytes; Windows CRLF can differ from canonical Git text hashes. The source commit/tree and clean-source gate identify the Git inputs, and MIGRATION_PROVENANCE.json names its canonical digest scope explicitly. Current CI requires no repository secrets; production signing/feed secrets and restore capability are separate and unproven.

Current accepted CI candidate: `c03b50f4328e07138f350532c31dfc8b260311ce`, [run 42475715858](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42475715858), 9/9 PASS; Windows artifact 13615761284. Signed legacy channel files are compatibility/history inputs, not a release of this baseline. Fleet Wall old GitHub asset URL needs controlled signed-feed migration; do not silently re-sign/promote feeds. main enforces baseline-required; documentation-only commits run the smaller truth/changes/aggregate scope.

## Single-primary-EXE proof build (work, not yet installer switch)

The Windows workflow assembles an isolated hosted-poc stage with `LightRemote.exe`, no `GptOperator.Client.exe` or `desktop-v4/LightRemote.Desktop.exe`, and `windows-host/LightRemote.WindowsHost.dll` plus private .NET 8 frameworks. The regular staged installer remains unchanged until updater/task migration is implemented. `build-hosted-core.ps1` builds the managed component as a framework-dependent library without an apphost; `hostfxr_initialize_for_runtime_config` uses a fixed private dotnet_root. A self-contained apphost is not substituted for this library ([Microsoft native-hosting documentation](https://learn.microsoft.com/en-us/dotnet/core/tutorials/netcore-hosting)).

The new native proof disables global DOTNET_ROOT, checks assembly entry point absence and actual runtime location, and exercises real WMI/stdio/exit code/managed Job Object/supervisor fixtures. Artifact `light-remote-one-core-proof-<sha>` contains evidence only. Native proof, final layout migration and physical acceptance have separate statuses; this prototype does not promote update feeds. Runtime/DLL footprint will be measured; no RAM/latency improvement is claimed before measurements.

## Primary EXE compatibility bridge (candidate0.10.1-dev.1)

Native hosting PoC source9248b29 passed [CI42501889183](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42501889183). The bridge still installs the old two-file layout and upgrades the independent updater to understand both layouts. Its version/source/hash must be retained before the primary-layout candidate0.10.1-dev.2 is built. Do not direct old hardcoded helpers to a primary installer: verify bridge helper coreLayoutContract1 first. No public manifest/feed is promoted in this task. Executable resolver fixtures and Agent-only stop isolation run on hosted Windows; these are CI proof, not Owner physical acceptance.

## Complete compatibility bridge recovery and installer layout guards

The compatibility bridge0.10.1-dev.1 remains the legacy package layout. Its installer can quiesce both known layouts and restore the old layout without leaving the new primary file; the updater/watchdog also handle verified old-installer rollback cleanup. A primary installer must verify independent helper coreLayoutContract1 before stopping or replacing an existing Core. Fresh install can bootstrap the packaged helper. The SinglePrimaryExe installer define is not enabled until the next primary candidate and its native proof. The task installer accepts only the fixed canonical product/profile/version/entry and preserves task names/principals. No public update feed or existing installation was changed.

## Fix locatable WMI identity for owned Agent stop

Bridge native CI42504277501 caught an actual GetOwnerSid failure after projected WQL lost locatable object metadata. A read-only self-process reproduction showed failure without EnsureLocatable and matching SID/file/creation with it enabled. Microsoft documents that EnsureLocatable supplies non-null __PATH/__RELPATH/__SERVER ([EnumerationOptions](https://learn.microsoft.com/en-us/dotnet/api/system.management.enumerationoptions)). The hosted Windows stop/other-role isolation fixture still must PASS on the next exact bridge commit; no test or identity guard was removed.

## Bind hosted component activation to the primary executable

The final compatibility bridge is still0.10.1-dev.1. Its native Desktop is explicitly bound to the legacy bridge whenever it runs under the legacy executable name; DLL presence is not a migration switch. This preserves rollback behavior even when old installers leave unknown supporting files. The following primary0.10.1-dev.2 candidate enables hosted operation only after the proven native file is staged as LightRemote.exe. Preserve the final bridge installer by exact source and SHA-256 before enabling that layout.

## Establish managed-role fixture readiness before Agent stop

The same-executable other-role isolation fixture must first establish valid inherited stdio and a live managed child. It now redirects stdin/stdout/stderr, waits for a child-written readiness marker, and only then calls --stop-agent-host; wrapper and child must survive. A worker that failed before the operation is a fixture failure, not stop-isolation evidence. The actual primary GUI/hidden-window restart acceptance remains an additional installed-package test.

## Package one primary LightRemote.exe and prove native migration lifecycle

Candidate0.10.1-dev.2 uses `/DUnifiedDesktopV4=1 /DSinglePrimaryExe=1` for the complete Windows installer. Its single primary file is `{app}/LightRemote.exe`; GUI, `--agent-host`, `--managed-process`, health/boot/Wall probes and bounded Desktop bridge share that native file. `windows-host/LightRemote.WindowsHost.dll`, fixed `hostfxr.dll` and private Microsoft .NET8 frameworks are supporting files. Node, RM V2, independent updater/watchdog, uninstaller and PTY/runtime tools remain separate by design. The old two primary EXEs are absent from the final stage and installed primary layout. Legacy C# apphost source remains for the compatibility build/regressions; it is not shipped as a primary executable in this candidate.

The separately built compatibility bridge0.10.1-dev.1 sourcee997e149d7494ef86eeb95da759bb324bf4b1b13 passed CI42506546750, artifact13627977718. Its installer SHA-256 is d909f6253b61b39d15fae08f586199c7f6c83ec160cccdd3c8eb841dfd6ca69c. [Migration pin](config/windows-core-migration.json) is a CI/recovery input with fixed source/version/installer+manifest hashes, not a product update feed. A pre-existing incompatible helper blocks the primary installer before Core stop or replacement; install the bridge first, then the primary package. Fresh primary installations bootstrap the packaged independent helper. Helper promotion still follows Core health and rollback preflight remains mandatory.

Only the primary native filename activates the hosted DLL. Legacy GUI rollback stays bound to its matching legacy C# bridge even if newer supporting DLLs remain. Task names, AppId, profile/state/connection paths, native mutex/IPC names, Tauri identifier, Owner credential service/account/client ID and public feed HOLD are preserved. Agent-only restart excludes GUI/other roles through exact executable, parsed argv, SID and creation-time checks. Full update quiesces exact installed runtime paths. Never delete a whole old Desktop/data directory.

Windows CI builds the private component, actual installed GUI/private CLR and singleton/restart behavior; it also runs real fresh/reinstall/bridge upgrade/rollback/watchdog fixtures and uninstall. `PRIMARY_EXE_MANIFEST.json`, `BUILD_MANIFEST.json`, SHA256SUMS and native evidence record exact source/run/version, every packaged EXE hash and measured staged/private-framework bytes. No RAM/latency improvement is claimed without measurement. Full primary CI remains pending for this commit; hosted CI is not physical Owner/vault/account/B acceptance. Existing ARM/Owner installations and public update feeds were not changed.

## Verify watchdog recovery by commit evidence and preserve migration failures

Primary trial source727b841, CI42509136055, passed real one-primary installation, actual private CLR in the GUI, hidden-window restart/singleton/shortcut, bridge upgrade/reinstall, real injected post-install runtimeconfig failure with successful legacy rollback, and legacy GUI isolation from leftover DLLs. It is not a releasable PASS: the last manual watchdog fixture expected a nonzero process exit after an ssPostInstall exception, while Inno logged abort and returned zero. Its acceptance now requires the logged injected failpoint/abort, restored old version/task/Wall, actual watchdog rollback_restore_wall_healthy and completed watchdog before uninstall. Original failure/progress and isolated recovery evidence survive cleanup. No production installer semantics were weakened and no native assertions were dropped. Full rerun remains pending.

## Record Owner pause and exact running primary build handoff

Owner explicitly paused this task due quota while [CI42511023888](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42511023888) builds code1fb8335a21d0a6716df2322c8ed6f19265421421 on work. Do not infer the result from the handoff timestamp. This documentation receipt changes no code and leaves that build running.

The verified compatibility bridge is retained at [compatibility/windows-oneexe-0.10.1-dev.1](https://github.com/n8n2erpnext/light-remote-mcp/releases/tag/compatibility/windows-oneexe-0.10.1-dev.1), sourcee997e149d7494ef86eeb95da759bb324bf4b1b13, full CI42506546750 PASS9/9. Inner installer SHA-256 d909f6253b61b39d15fae08f586199c7f6c83ec160cccdd3c8eb841dfd6ca69c, artifact13627977718, ZIP SHA-256 e5ad85269711a4dcaf96206052d3cef8dfbfdfc17f8369a4a48a845f6ef78665. This is the migration bridge, not the final primary package; no primary candidate release has been published.

Primary trial727b841 / CI42509136055 produced actual one-primary stage/install and GUI/restart evidence plus a successful real cross-layout health-failure rollback report. Overall result FAIL was the final manual watchdog fixture's exit-code assumption and premature cleanup. Current1fb8335 follows actual failpoint/abort and watchdog recovery/health, waits for watchdog completion before uninstall, preserves original errors, and adds per-stage progress/recovery evidence. Resume diagnostics should read the `light-remote-one-primary-migration-proof-<code-sha>` artifact: migration-progress.json, migration-failure.json, cleanup-errors.json, recovery-update.log, recovery-status.json, recovery-pending-report.json and watchdog-*.log as available. Do not hide a failure by removing assertions.

Observed727b841 stage sizes: primary native EXE8356864 bytes, total staged files441770686 bytes, private frameworks167323268 bytes (.NET8.0.33). These are that trial's measurements, not a final artifact hash or RAM/latency promise. Physical Owner/vault/account/B tests are NOT_RUN. No Owner Windows install, ARM runtime cutover, main promotion or public feed activation occurred. Next work begins only when Owner resumes.

## Resume build28 and wait for final PostgreSQL TCP readiness

Build28 / CI42511023888 source1fb8335 passed the complete Windows job128823990554, including real primary installation, private CLR in GUI, singleton/background/Agent restart, actual bridge/reinstall/rollback/manual watchdog/uninstall and exact-commit installer manifest upload. Its overall failure was isolated backend setup: Unix pg_isready could see the temporary postmaster, then psql hit the shutdown gap. The [official PostgreSQL17 entrypoint](https://github.com/docker-library/postgres/blob/master/17/alpine3.23/docker-entrypoint.sh) starts bootstrap with no TCP listener and stops it before exec of the final server. The fixture now probes127.0.0.1:5432 with a bounded pg_isready timeout, and retains its existing local SQL/auth and internal Docker network. Tests prove bootstrap is not accepted and absent final readiness fails before SQL. A new full exact-source run remains required before main promotion; this fix does not reclassify build28 overall as PASS.

## Begin internal Desktop backend integration from verified source checkpoint

Owner clarified internal-test-only installers; no public GitHub binary release or signed-feed activation is requested. This task will build from one exact clean official GitHub commit and verify App/backend contracts in isolated integration before any controlled internal Lab runtime change. Preserve current sessions, account/device identities and recovery artifacts.

## Implement verified native device API and fix Memory startup and Desktop ACL gaps

Development candidate0.10.1-dev.3 adds native device API without changing primary layout, credential/profile/resource IDs, dependency package versions or the verified compatibility bridge pin. Every native build remains exact clean GitHub source in Actions. No public Release/feed requested. Existing installed/runtime source remains unchanged until separately tested integration work.

## Include native device API in Agent package and preserve scoped Owner fence checks

Fix the P1 Agent package import closure: explicitly include both new native device API modules in client/core-files.json. Keep the original F14 Owner verification regression scoped to F14 and independently require the new device command to verify Owner before/after with an exact device for writes. CI35 is a failed development trial, not a releasable internal installer. Exact-source native rerun remains required before acceptance.

## Connect Desktop controls to the verified Agent API and unify displayed names

Candidate0.10.1-dev.3 remains internal-only. Native window title is Light Remote Desktop; the old title remains only a compatibility single-instance lookup. No executable/profile/path/vault rename or update feed activation accompanies the display-name change. P1 package/native CI36 PASS9/9; P2 rebuilt native candidate must pass its own full CI before artifact acceptance.

## Verify both real B approval flows and classify known Wall rejections

The disposable coherent backend is built only from a clean identified GitHub commit with private PG/Redis and no host ports. Extended acceptance now includes real OAuth MCP and native Agent IPC, not stubbed controllers. Synthetic private OAuth key material stays in .unified fixture state, never Git or reports. Internal-only Windows installer still needs full current-source CI and hash acceptance.

## Preserve explicit Agent start intent and isolate Owner rows during rendering

Final candidate remains0.10.1-dev.3 internal-only. Native installed lifecycle now includes explicit-start-is-idempotent-preserves-running-agent. CI38 initial Windows failure was GitHub504 while fetching the pinned compatibility manifest, after native build/fresh installation/GUI restart; it is not a proven migration failure. Only rerun success may accept it. Lab staging714 has exact Git source and same-lock ARM Node22 dependencies from the coherent candidate, private service/key/DB backups and read-only schema43 verification. Final source and CI must be staged/verified before cutover; no SQL migration was needed.

## Read pinned migration bridge assets through bounded authenticated GitHub API intake

test-primary-migration.ps1 receives the workflow contents-read GITHUB_TOKEN only for api.github.com/releases/assets/<pinned ID>. A signed redirect must be HTTPS release-assets.githubusercontent.com or objects.githubusercontent.com; its download client has no API bearer. Each attempt has a90-second cancellation budget including streaming, at most3 attempts. Installer/source/manifest/version pin checks and actual upgrade/reinstall/health-failure/watchdog rollback remain unchanged. The pinned recovery bridge is an existing CI input, not a new public release.

## Record verified internal Desktop backend candidate and coherent Lab deployment

Internal candidate0.10.1-dev.3 compiled from 2771f47080bdf21913371126bcefd2923b12d257, CI41/42583094615 PASS9/9; installer SHA256 f089a2cd66a4e0a05d10aa274a189be4f71f42c82185f7847d2c92648808e57a. Actions artifact13659545229; independent archive/installer/source/profile/manifests verified on ARM and locally. One primary LightRemote.exe, supporting Node/RM/private DLLs/updater/watchdog retained. No public release/feed. Internal Lab Operator+Plugin now use that GitHub source from a fresh approved-root runtime; existing units/key files/database archived privately, DB43+Owner verified without migration, private/public health/version/API401 and preserved counts PASS. Original runtime/source/DB/independent services retained for controlled rollback; Owner Windows install unchanged. Maintenance audit: the first controlled trial rolled back when systemd PartOf/Requires stopped the old Wall; the same-source Wall was restored immediately. Empty dependency resets in drop-ins were rejected by preflight. An administrator-only ignore-requirements restart was first proven on two disposable dependency fixtures, then used for the final successful cutover; its Agent/Wall, supervisor and transport PIDs and original dependency graph were verified unchanged. No physical terminal continuity is inferred for the earlier trial. See the systemd primary manual: https://raw.githubusercontent.com/systemd/systemd/main/man/systemctl.xml .

## Rebuild Desktop as a user workspace and fix populated approval and monitor layouts

Internal UX candidate0.10.1-dev.4 keeps one primary LightRemote.exe. Frontend package test:visual now runs entry/unavailable gates and populated product-ux-smoke from a separate synthetic e2e/fixtures entry that is never imported by production. The fixture is checked absent from dist. Browser evidence covers11 screens, six size/DPI variants, both themes and link/confirm dialogs. Native build remains Actions-only; no new public release/feed or installed Owner changes. Local source evidence is docs/evidence/desktop-user-experience/LOCAL_VERIFICATION.json.

## Fix Codex state usage Wall history PTY and responsive Desktop lifecycle

Candidate0.10.1-dev.5 remains internal-only and one-primary LightRemote.exe. Native builds occur only in Actions. Frontend visual workflow additionally runs real local Wall/SQLite/log/ANSI browser regression; synthetic fixtures are still absent from production bundle. Windows installed lifecycle posts actual Close3 times while polling, confirms same GUI/Agent PID, and uses the packaged Node/node-pty for an isolated real ConPTY->authenticated Wall HTTP executed-output proof. Rust delayed-work unit covers UI event timer liveness. New callback includes the same distribution SVG/CSS/font offline; no second EXE. Current old runtime947a117/dev4 must stay until final exact source CI/artifact proof and controlled internal Lab-only consent rollout.

## Align follow-up SSO branding and cross-language HMAC revision fixtures

Follow-up CI57 stopped at stale SSO heading and catalog revision-vector fixtures before Windows compilation. Revision2 and3 vectors plus tamper checks must pass across Node/Rust/.NET. Do not reuse the failed run or bypass any gate; rebuild exact repaired commit in Actions.

## Defer Windows close hide beyond callback and preserve installed responsiveness checks

CI58 built and installed the dev5 one-primary package but failed the real WM_CLOSE3cycle gate; no artifact from it is accepted. Retain the original3s deadline and all Agent/singleton checks. The installed test additionally records bounded native-close.json/WM_NULL responsiveness on every cycle. Native builds remain Actions-only.

## Restore singleton window through owning Tauri runtime to synchronize visibility

CI59 failed second Close after shortcut reopen while responsive; no failed candidate accepted. Keep <=3s hide,3cycles, same GUI/background Agent and WM_NULL checks. Require native show event and <=3s asynchronous restore before subsequent Close; the Close deadline is unchanged. Native builds remain Actions-only.

## Reconcile actual hidden window state before singleton restore

CI60 initial shortcut restore failed after the unchanged installed raw Win32 hide setup; no accepted binary. Keep that precondition and all existing background/Agent restart/singleton/3s Close3cycle/WM_NULL assertions unchanged. Native restore now reconciles OS visibility before Tauri show; rebuild and pass full exact-source Actions before delivery or Lab rollout.

## Bind recovery Wall health proof to validated installed package revision

CI61 feature/install/Close3cycle/ConPTY checks passed, but the required real manual watchdog rollback failed when helper configRevision3 compared a restored rev2 Wall to its own compiled revision. Recovery-only proof selection now follows validated installed marker revision without relaxing other proof checks. Keep the existing rollback_restore_wall_healthy assertion, real pinned bridge, identity canaries and full native Actions; no failed candidate delivery or runtime rollout.

## Align recovery ownership guard with installed revision proof

CI62 stopped before native compilation because the portable ownership guard still required the old IsExpectedWall name for recovery. Update only that assertion and add explicit compiled/installed revision split checks. Full test:source now runs before this commit; retain real bridge/watchdog rollback, Close3cycles and ConPTY acceptance unchanged. No failed installer delivery or runtime rollout.

## Prove native auth UI liveness with synchronized worker release

CI63 core/web/Linux passed; macOS failed the isolated auth fixture150ms elapsed assertion. Replace elapsed sampling with causal synchronization between the async25ms timer and blocked native worker. A5s independent emergency release prevents test hangs and must never supply the successful result. Production code and actual Windows3s/3cycle Close, WM_NULL responsiveness, same Agent and real ConPTY/watchdog checks are unchanged. Native repair validation remains Actions-only. CI63 complete Windows lane later passed including real bridge/watchdog recovery, Close3cycles and packaged ConPTY. Full run remains failed due the macOS fixture only; do not deliver that failed-run installer.

## Checkpoint fresh Windows distribution redesign and verified dev5 Lab deployment

Lab Operator/Plugin now serve exact GitHub8e0d932/dev5 after CI64/artifact verification and private backups. Public/private health/API and unauthenticated snapshot401 PASS; persistent counts and independent Agent/Wall/supervisor/mTLS PIDs are preserved. No SQL migration or Owner Windows change. Prior947a117 runtime remains for rollback. Remote consent branding is deployed. Main remains8ac6273; permanent work is active. New task: restore tray state icons and redesign Windows install/uninstall in Moryqa, reuse STOCK logo, remove only empty desktop-v4 directories, then build internal dev6. Fresh design/source plan: docs/plans/windows-distribution/TRAY_INSTALLER_REDESIGN_20261110.md. Keep Windows native compilation in Actions and full migration/watchdog gates.

## Implement fresh Moryqa Windows setup uninstall and five-state primary tray

New internal dev6 source requires full Actions including Rust state/security tests and actual six native setup/uninstall views. [V3 design/mapping](docs/design/windows-distribution-v3/README.md). No local/ARM native compilation. Preserve native install/update/rollback/watchdog/Close/ConPTY gates. Quiet installer/migration paths still run the same Inno transaction; normal Windows Apps uninstall reuses the same uninstaller with explicit /LIGHTREMOTEINTERACTIVE. Exact-source artifact and public status remain unaccepted until CI completes.

## Preserve exact Moryqa asset bytes on Windows checkout

CI67 Windows stopped before compiling because autocrlf changed a Moryqa SVG covered by strict provenance hashes. Exact failure hash reproduced by LF→CRLF conversion. Scoped .gitattributes preserves the original export bytes and embedded raw RGBA. Hash checks remain byte-exact; a new full exact-source run is required.

## Use released Inno pointer types and compile installer early

CI68 passed all components except Windows installer parse. Inno6.7.1 exposes UINT_PTR, not the NativeUInt type in later unreleased docs. Native pointer/handle imports now use the released compiler type. Windows workflow compiles the exact full Inno script before expensive native jobs using a never-executed, never-uploaded placeholder stage. Final installer still requires proven native stage and full installation/migration/watchdog tests.

## Measure installer Google Sans in its owning GDI process

CI69 source299c31d built the complete installer but UI font verification was invalid: GDI handles are process-private. New proof logs in-process GetTextFaceW output selected from the exact title TFont; CI still rejects anything other than Google Sans and saves sanitized failure diagnostics and screenshots. The uninstall-finished wait uses its full unique multiline title, avoiding matching an earlier header. Final artifact acceptance still requires a new exact-source full run.

## Correct native title lines card surfaces and uninstall button selection

CI70 UI artifact13781309625 confirms actual Google Sans and successful three-view installation. Visual review found missing second heading lines caused by large GDI font line metrics and missing card/footer surfaces inherited from theme/parent. Explicit native line labels and explicit background/style settings correct those gaps. Native UI proof now checks second-line text, painted ink and card-color pixels; selector excludes static captions when clicking Uninstall. New full run required.

## Retain bottom margin for native Google Sans heading descenders

Verified CI71 completed/success9/9 and actual six native UI summaries. Final heading descender correction reserves102px for the two32px lines at y116; its bottom meets body y218. Native CI now requires at least3px bottom ink padding in the second heading. Font assets, content, API and installer/recovery transactions are unchanged. Physical Owner feedback remains pending.

## Record Owner stop-build instruction and next native acceptance checklist

**Owner stop-build instruction, 2026-11-11:** no native build/test, no installer execution or new Lab deployment now. Source0397d871 is fixed/published. CI72 cancel requested; final artifact is unaccepted. On resume run one full exact-source GitHub Actions candidate: six UI views/font/logo/card/title-bottom margin; DPI and keyboard; actual five tray states/reduced motion; fresh/upgrade/quiet uninstall/data preservation; primary GUI X3cycles and Agent restart; real ConPTY and bridge/native watchdog rollback. Then verify ZIP/installer SHA and exact source/tree manifests independently on local+ARM. Only accepted code may deploy in a new Lab runtime with private backups and old5 rollback. No public Release/feed or automatic Owner PC install. [CI71 evidence](docs/evidence/distribution-redesign/CI71_NATIVE_UI.json).

## Fix native installer surfaces and typography, tune tray and integrate Google sign-in

This internal source batch requires the full exact-source Actions pipeline, real Inno compile and six-view native screenshot/card/descender assertions before artifact acceptance. Pre-change all-refs bundle/tag restored and fsck verified on ARM. Existing Owner install is not changed automatically. Gold Google config may reuse validated production client ID/secret via private stdin/PG only; production remains untouched, current-profile callback must be registered externally. Native build/test is explicitly authorized for this batch.

## Preserve production Google callback for domain rotation and verify explicit Wall SSO gates

Owner callback decision: stage original production client/callback privately in Gold, no Google Cloud allowlist change. After domain-role rotation, running PUBLIC_ORIGIN must match the saved callback; verify authenticated round-trip then. Before enabling Wall SSO, accept issuer/operator flags, trusted TLS edge attestation, signed relay and physical native challenge flow. Existing Desktop flags alone must not enable Wall SSO. CI78 core failure was a historical source-only assertion, not permission to remove its browser/A/B guards; gated runtime tests replace only that obsolete assumption.

## Capture native installer geometry before full builds without weakening UI checks

The early `LightRemote.LayoutProbe.iss` includes the same production Wizard and font/logo, but contains no product payload, app directory or uninstall registration. CI only opens Welcome then stops its owned process tree; it never clicks Install. Its proof cannot accept an installer. Final full install/uninstall six-view proof remains unchanged, now capturing diagnostic rectangles and PNG before assertions.

## Fit native Google Sans labels to actual GDI ink while retaining descender padding

Rejected native source/run/artifact and measured font/control metrics are in docs/evidence/windows-distribution/20261111-layout-diagnosis.json. Same-font GDI ink sizing avoids unused Windows descent space. Full six native views, pixel backgrounds, descender padding and lifecycle remain required.

## Record native wordmark capture coordinates while retaining ink assertions

Native screenshot diagnostics now include wordmark/window/sample coordinates and pixel counts when ink checks fail. This does not alter thresholds or accept a failed screenshot.

## Inspect the active native wordmark and hide covered stock wizard headings

Native pixel proof selects actual narrow wordmark under the active title surface, excluding covered stock captions and uninstall headline with same text. All thresholds remain unchanged; real six-view product round-trip is mandatory.

## Keep compile-only cleanup in its owning CI step after native Welcome passes

Compile-only fixture cleanup stays in its own PowerShell step/output path. Welcome probe uses a separate layoutProbeOut variable and cannot accept a full installer. CI83 proved actual native Welcome visual checks before cleanup failure.

## Record CI84 internal installer acceptance, Lab rollout and preserved Google callback

Accepted internal source: `3064f21adb402b1d3eb866405d5a81796789f1a2`; CI84 all9 PASS. InstallerSHA256 `187ab6bf9b6d5a5487b7898aaf03ef3b053fbad046afa2044aa13aca81a60938`. ZIP digest and six native view measurements are pinned in docs/evidence/windows-distribution/20261111-acceptance.json. Owner runs the installer manually; verify100/150/200% wordmark/heading/status descenders, no white card bands, muted Connected tray color, normal close/reopen, linking/auth and retained state. No public feed/Release.

Lab code: `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/implementation-20261108/backend-runtime/3064f21adb402b1d3eb866405d5a81796789f1a2/code`. Recovery sibling holds service drop-in restore maps/private inputs/indexed DB dump. Previous8e0d932 runtime remains untouched. Full DB snapshot indexed/SHA-verified; no schema migration performed. Native PNGs/summaries archived outside Git under the approved ARM task `installer-google-followup-20261111/ci84-native-ui`.

Google original production callback/client are saved in Gold PostgreSQL. Temporary Gold origin deliberately reports configured=false/credentialsSaved=true/pendingDomainSwitch=true; password fallback retains native intent. Before Owner domain-role rotation, align PUBLIC_ORIGIN, native endpoint/issuer profile and TLS routing, retain the original callback, then verify authenticated Google login and no A/B auto-grants. Wall SSO remains independently OFF until issuer/operator/trusted-edge/native challenge acceptance.

Rollback must coordinate service drop-ins with the Google config row: `recovery/google-oauth-before.private.json` records the previous empty row. Restore that specific config state before starting the old Plugin, or its older config reader may advertise the staged callback. Never restore the entire database over later Owner activity just to undo this config; compare expected staged values before any narrow rollback. Keep all secrets/private backups outside Git. Production and Owner Windows installation were not changed.

## Preserve native RMv2 cursors and honor precise input timing

Internal dev7 native Actions adds test-rmv2-phase1.ps1 after RM publish: actual system cursor bitmap roles, tiny immediate endpoints, observation/control/idle, explicit restore while alive and monotonic handler samples. RM embeds existing Google Sans font; one-primary packaging boundaries and six-view installer/migration checks retained. Native/source PASS and Owner physical PASS remain separate.

## Read native cursor bitmap proof without PowerShell GDIplus coupling

test-rmv2-phase1.ps1 uses direct Win32 bitmap hashing, independent of PowerShell System.Drawing/.NET10 private GDIPlus references. Same11 cursor roles and hotspot proof retained. CI uploads light-remote-rmv2-phase1-SHA receipt. Product binary behavior unchanged at this test fix.

## Fence Owner input at operation start and repair hosted Ubuntu mirror

.github/scripts/hosted-apt-mirror.py is guarded to disposable GitHub-hosted runners; it replaces only the Azure Ubuntu mirror URI hostname with official archive.ubuntu.com in existing apt configuration. Suites/keys/security mirror/package verification stay intact; apt index refresh precedes Chromium/GTK dependencies. ARM/production never execute this script. Full native/browser tests remain required.

## Handle observed hosted apt mirror list after Windows RMv2 acceptance

Hosted apt mirror helper includes observed /etc/apt/apt-mirrors.txt (mirror+file source) in addition to standard sources and mirror lists. Fixture test reads/writes that exact layout and preserves security host/priority. CI89 Windows fullPASS remains scoped to e4e376f; final exact-source full baseline retry required.

## Bound hosted DNS recovery and refresh stale installer UI snapshots

CI90 actual mirror list was rewritten (count1); archive DNS still failed. Disposable hosted apt setup now follows upstream1retry/15s acquire timeouts, exact-host HTTPS, and if needed two-host DNS recovery via Google HTTPS JSON API with strict question/public IPv4/TTL validation. TLS/package signatures remain enabled; apt update fails on any repository error. Sources: https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt.sh and https://developers.google.com/speed/public-dns/docs/doh/json . Native UI snapshot retries only stale HWND acquisition, not acceptance assertions.

## Keep RMv2 working sessions visible and yield input without failing Agent sessions

dev8 native proof additionally waits2200ms between actions with live visual session, checks4 painted full-surface click-through edges per monitor, then detaches and checks timer stops. WPF layout size and HWND physical size are both set. Entire previous installer/lifecycle regression retained. Hosted-only authenticated Ubuntu mirror selection resolves authoritative Ubuntu DNS outage; no product/ARM DNS changes, TLS/signatures/keyring/suites retained.

## Record CI94 acceptance and Owner explicit RM session completion contract

Verified CI94 internal artifact13914719235, source5616f7ed7bb2a9df4ef1d7465f2b1087167619a3/tree09378932c7b89320f48ef821ded2506810b16985, installerSHA6acd74f3513b3f87bfa4c7198f5b3c75ecb2644bb08bb8aab1be0304e8aef911 bytes172590083. Source/native proof and full baseline do not override Owner physical lifecycle FAIL. New explicit-close/orphan/palette source must get its own exact CI.

## Require explicit RM task scopes with confirmed close,45s orphan cleanup and sky-blue awareness

dev9 native proof adds real explicit-close acknowledgment with another read-only view retained, rejection of closed native scope, fresh ID on reopen,45s actual native orphan expiry despite status polling, and blue painted-edge channel checks. Entire previous native/install/upgrade/rollback/ConPTY regression retained; native builds only Actions. Node lifecycle tests use controlled clock and deferred operations, no Owner input. Artifact and Lab rollout require exact full9 CI and manifests; no public binary release.

## Package RM task lifecycle module and retain scoped input receipt compatibility

Windows client core bundle must include lib/rmv2-task-lifecycle.mjs; CI96 import-closure failure was a real packaging omission, now fixed in the manifest. Native scoped input receipt preserves prior shape so tiny-move/native result consumers remain compatible. Full CI/artifact acceptance still pending.

## Acknowledge already-closed RM tasks and protect in-flight resume

Scoped historical native proof CI97/ea4a04d passes actual explicit close, readonly observer fence, closed input rejection, reopen newID,45s real expiry under status polling and sky-blue painted edges. Evidence docs/evidence/rmv2/phase1-ci97.json verifies artifactZIPSHAfd94c8fb5d4e6efd1c8a8fc1ec493c06dbdeb7fd56f5b1f974536e0a70ea729b. Final JS close-receipt/resume changes require their own full exact-source CI/artifact; no physical PASS implied.

## Record verified CI98 RM lifecycle candidate and current project truth

CI98 source398c4c8b316d59458f636bcdf1bd4ea44056634f/tree5f432f68d60ff2426bd2742848b519bdd85dbd74, all9 PASS. Internal completeartifact13921290856, ZIPsha126629f75ecad07c987153dbb11e2fd79870a5f8aedc66ab1bc8d9e1dbbf2e9a, installerSHA6cb6ca1e02653dd647c05cbab677545c5af74b1e5129c1b04491b375cb54785a, bytes172575451. OneLightRemote.exe and migration/installed lifecycle PASS; physicalOwnerAcceptance/publicFeedPromoted false. Native artifact13920222075 verified separately, same source. Lab integration still pending in this receipt.

## Add ordered RM work with fast scoped cancel and explicit pointer profiles

Phase2a candidate dev10 requires Actions native compile/self-test/full installer regression. RpcWorkScheduler.SelfTest uses deferred work to prove independent status/capture, input ordering, queued cancel fence and later explicit input. It does not inject Owner input. CI98 dev9 source398c4c8 installerSHA6cb6ca1e02653dd647c05cbab677545c5af74b1e5129c1b04491b375cb54785a independently verified on ARM+workspace as rollback baseline; do not label dev10 as built from that artifact.

## Retain explicit legacy RM timing paths alongside opt-in profiles

CI100 source d11f32d has no accepted native artifact: early source gates caught legacy default timing path refactor. Corrected code preserves those paths and adds native InteractionProfile.SelfTest. Existing source/productization/parity checks remain required.

## Add target-bound Unicode writes with verified progress and live authority checks

Dev11 adds Actions-only test-rmv2-text.ps1: real WinForms UI controls in an independent process, required readback16K/64K/256K Unicode, then focus switch before suffix with second control unchanged and explicit scope close. Portable tests are automatically discovered in existing unified unit directories. New private runtime imports are listed in client/core-files.json. This source has not yet passed native build; do not install/release/deploy or reuse CI101 hashes for dev11. CI1019/9PASS belongs exactly241359b/dev10, native receipt docs/evidence/rmv2/phase2a-ci101.json; no complete-installer hash claim for that run.

## Correct native logical write variable declaration for CSharp

CI102 Windows failed at native compile CS0819 before the new text fixture. Split RobotContext FinishTextWrite local var declarations; no behavioral/test/threshold changes. Core/backend/Web passed for sourceef54911. New Actions proof pending; no CI102 artifact accepted, no Lab/Owner/production changes.

## Reuse fresh RM capture buffers and add crop-aware frame coordinates

CI103 source9638594 passed native compile, helper selftest and actual cursor/lifecycle fixture; its full run failed before installer due the text reader100-event assumption and a Web preference-save assertion race. Corrected fixture readers now enforce a whole-request deadline while skipping interleaved events, and Web test awaits canonical preferences POST response with the same max assertion. New GdiFrameCache/Crop native selftests and test-rmv2-capture.ps1 verify real ROI JPEG dimensions, fresh pixels/frameSeq, cache cleared after final scope close and record same-source capture-only cold/warm timings. These are Actions-only and not yet executed for this source. Timings are not a prior-release/network/physical speedup claim; optional GPU hardware and mixed-DPI Owner acceptance remain pending.

## Bind typing target before cooperative large-text preparation

CI104 exact source27c4637 passed actual GDI ROI/JPEG/cache-clear/fresh-frame acceptance. SHA-verified capture receipt is docs/evidence/rmv2/phase2c-ci104-capture.json. Cold capture p50/p95=22.7541/29.5583ms, warm=14.8788/30.7837ms,6 cold/24 warm samples;24 encoding reuses and24 payload omissions. This tiny257x129 ROI experiment compares same-source cold allocations/warm cache, not whole RM, old release or network; warm p95 did not improve in that run. CI104 full result FAIL at actual native16K text/readback mismatch. New fixture preserves expected exact text/native verified criteria and emits only lengths/SHA256/first difference/final metadata on failure. No raw text, native local build, Owner install, Lab deployment or public feed.

## Separate root-guarded UIA observation from ordered input

CI105 run43361834599 sourcee34d85c: Core/Web/Linux/macOS/native compile/cursor/capture PASS, Windows text fixture hung until job cancelled. No final text artifact, no completed installer, no physical acceptance. Test fixture now saves metadata-only stage/units/offset checkpoints before binding/typing/readback/comparison and has a separate eight-minute step timeout; last progress survives cancellation via always-upload. Cleanup kills the isolated helper first to unblock pipe/UIA work. Native tests execute only in Actions. Scheduler selftest now verifies MTA observation during blocked input and input/status during blocked observation; real provider/hardware acceptance remains separately scoped.

## Isolate native text acceptance from PowerShell UI runspaces

Test-only Rmv2TextFixture is built on Actions as a separate framework-dependent WinForms executable outside product staging. It is not shipped/installed and refuses to run without GITHUB_ACTIONS=true. Its current-user-only pipe dispatches reset/read/focus commands onto an ordinary STA Application.Run loop. Native product helper still receives real Unicode SendInput; full content and required UIA readback both remain mandatory. The fixture adds only WM_CHAR/key-down counters to safe failure receipts. Cleanup terminates only the two isolated fixture/helper processes, eliminating PowerShell UI runspace disposal waits. Eight-minute test step budget remains. CI106 published no completed installer.

## Add optional exact-monitor DXGI capture with fresh GDI recovery

New native deps pinned directly: Vortice.Direct3D11/DXGI/DirectX3.8.3, Mathematics2.1.0, SharpGen.Runtime/COM2.4.2-beta, System.Text.Json10.0.15 (verifiednet8.0 support) to avoid the older transitive9.0.1 minimum. Distribution root third-party notices include the upstream MIT text and copyrights. Actions publishes packages.lock.json for SHA-verified intake into source; a final candidate requires that committed graph and locked restore. GPU probe separately records dxgi frame count versus explicit fresh-GDI fallback count; fallback-only PASS of geometry/recovery must not be called GPU hardware PASS. Exact previous source241359b is checked out and built ONLY in hosted Actions outside product staging, then3 warmups/source and15ABBA rounds yield30 capture/pipe samples/source. Both EXE hashes/source commits are in the receipt. No images or input are saved/sent, no old binary is staged in product, no threshold is invented, and the comparison excludes network, whole input latency and Owner physical hardware. Text acceptance still gates the complete installer.

## Wait for native text delivery and fence expired input authority

CI107 source1287508 now compiled/ran the separate ordinary STA fixture and exited cleanly on failure:4205 key-down/WM_CHAR events,4205 actual exact-prefix units versus16384 accepted. Receipt is docs/evidence/rmv2/text-ci107.json; this supports adding delivery backpressure, not treating SendInput return as insertion proof. CI108 sourcefbde839 native compile failedCS0121 ambiguous D3D11CreateDevice outputs; corrected with explicit ID3D11Device/ID3D11DeviceContext. Its verified NuGet artifact lock is committed and RestoreLockedMode=true enforces exact resolved versions/content hashes. Provenance/normalized lock hash are docs/evidence/rmv2/nuget-ci108.json. Native selftest adds caller-deadline overwrite/expired/invalid authority checks; portable bridge test proves startup expiry sends no request. No native build/test is run on Owner/ARM. Full exact new CI is mandatory before any candidate installer or Lab cutover.

## Keep RM capture cleanup responsive and correct native measurements

CI109 run43399528020 sourcef7e9507: native/GDI/DXGI and other platform jobs passed, Windows stopped at benchmark cleanup, text NOT_REACHED. SHA-verified DXGI artifact14023599907 digest8acc94d66448fb6d90d0e3aca7157bf4e0694503e91e088b32238d462287aa53:14 actualDXGI frames,17 freshGDI fallbacks; runner-only acceptance, not hardware/physical/speedup acceptance. PowerShell scripts AST parsed locally; changed native code executes only Actions. Full checkpoint checkpoint/20261113-before-rmv2-measurement-f7e9507 bundleSHA 899c1c063c82df8ed0451339cb8c86fc85d263703391d0f9b635d88fdd86ecb9 independent restore/fsckPASS. Corrected benchmark cleanup terminates isolated helpers with bounded waits and ignores only expected IOException/ObjectDisposedException while disposing wrappers. Text fixture terminates both isolated processes before wrapper disposal. Native text step timeout15minutes keeps all real size/hash/readback checks. build-manifest now includes committed native packages.lock.json hash; no local/ARM native compilation. Follow exact Actions compile/selftest, corrected controlled benchmark and real16K/64K/256K/focus-switch native text acceptance; diagnose actual failures without weakening content assertions. Complete full installer CI and verify artifact source/hash before one combined Owner internal UAT. Labdev6/production/Owner installation remain unchanged; hardware encoder/video/GPU resize are separate unavailable capabilities.

## Amortize verified text windows without dropping target checks

Portable logical-text18/18PASS and PowerShell AST parsePASS. CI110 run43403461871 source3e4a186: GDI/DXGI/cursor/selftest and all other platforms PASS, native16K/64K exact comparison completed,256K timed out without content mismatch at last recorded174576units. Text artifact14027068555 SHA4e4ad261e1630febe2324a3b0a3ee7ccc12fcb0fb9bda87e5f9eae4904a4d074 independently verified. Corrected ABBA capture comparison artifact14025864309 SHAe09d62c1cd144606915e4c7d0044a8022a176b50ba6befff7534d21d984e5999 verified: median53.2063->33.6457ms,p9577.1289->69.2033ms,30samples/source only, no global speedup claim. Full checkpoint checkpoint/20261113-before-rmv2-acceptance-3e4a186 bundleSHA 269fb55d13eaa94c5e2a7321baae14cb6141de6f5cd5ae17e30d7d28e93739ad restore/fsckPASS. Exact native assertions/time budget are unchanged; new progress adds metadata-only elapsed/native-handler/queue counters and completed-size records. No raw input/readback is logged. Follow exact Actions native16K/64K/256K full-content/readback/focus-switch acceptance with unchanged15minute budget; inspect per-size/native timing and fix real remaining issues. Then complete installer/upgrade/rollback CI and verify source/hash before combined Owner UAT and isolated Lab alignment. No interim installer, public release or production/Owner installation change.

## Fence new text packets while completing read-only verification

CI111 run43406994789 source6f7e160 text artifact14028860273 SHA103909d99bdb6664d0ba15a795b86d031d721dbcfed6ae4f0f6a7931144219ea verified. Structured artifact proves exact16K/64K success; decoded job131823873900 pins the65946-unit interrupted ACK. Native completion substage was not recorded in that source; new stage timing must resolve any remaining failure. PowerShell AST parsingPASS; native compile/tests execute Actions only. Full checkpoint checkpoint/20261113-before-rmv2-completion-6f7e160 bundleSHA 03000a5c5a835f3f20a559c5578d31baac489f4e6130940832ca47e89ad19a83 restore/fsckPASS. Native selftest includes logicalPacketGuardsOk from the same logical packet loop with a recording sender. New target/send/delivery durations and detailed failure receipt are metadata only. The full exact readback and15minute CI limit are unchanged. Follow exact Actions packet-guard selftest and16K/64K/256K native content/focus-switch acceptance. Inspect phase timings if a slow provider/input still interrupts; do not widen mutation authority or weaken readback assertions. Then finish full installer CI, verify artifact/source/hash, update coherent project truth/checkpoint and prepare consolidated Owner UAT/isolated Lab alignment. No interim installer or production/Owner changes.

## Back off delivery observations and diagnose exact fixture content

CI112 run43443362284 source74cc29e native text artifact14047249217 SHAaf163714b9cf1e957cf63c9afbf2bee42aab1eea0f1008d2762bc7626c6a235f verified; exact16K/64K PASS32.12s/125.17s, no256K PASS. Native phase1 artifact14047652041 SHAe59254de1b4c1e110850ea180eebfa1af38bbb4fd328f83be0ce55d4dcb6cd4e proves11cursor roles/tiny moves/blue edges/explicit close/reopen/45s status-proof expiry. DXGI artifact14047582130 SHAb0c6e3171dfef0c909492211ed741e968779c3ff53fa7e3659d1f421ec45caad proves13actualDXGI/18freshGDI fallbacks on runner, not Owner hardware acceptance. PowerShell AST parsed; changed native code/tests execute Actions only. Before change checkpoint/20261113-before-rmv2-delivery-poll-74cc29e bundleSHA 4bcf7829a1adb4db99df2854f8efae14e8581e63bed27f20bc1c2aef84217f07 restore/fsckPASS. Failure fixture snapshots read only its existing content at three times after a failed ACK; they log units/hashes/first-difference/counters, never raw text. Late matching content does not override FAILED native acceptance. Test fixture capacity is explicitly1M rather than zero-limit semantics; word wrap/real keyboard/all exact content and focus assertions remain. Microsoft TextBoxBase source forwards MaxLength via EM_LIMITTEXT; product code never modifies target limits. Inspect exact new native readback result and post-stop fixture evidence, fix any actual loss/provider issue, and complete unchanged16K/64K/256K/focus-switch acceptance plus full installer CI. Verify artifact/source/hash and coherent checkpoint before consolidated Owner UAT/isolated Lab update. No interim candidate, Owner install, public feed or production change.

## Verify slow text completion across explicit editor capacities

CI113 run43447565461 sourced6d302c text artifact14049787318 SHA809b5711c809faad589d394c985c19edf7fdf56c2f79559d2f599139dd6d119b verified. Classic16K/64K exact native+fixture PASS31.95s/131.23s; classic262K FAIL preserved. Three post-stop snapshots show complete exact sent prefix arrived late, other field0units,1M fixture capacity and wordWraptrue. This scope supports a longer read-only wait and explicit editor matrix, not changed mutation permissions or blanket performance success. PowerShell AST parsed; native code/tests run only Actions. Full checkpoint checkpoint/20261113-before-rmv2-delivery-capacity-d6d302c bundleSHA 7aab6863d38da52ee0c60b22e4c8b8e066df354c92dcee5b34f9273fbf837ad8 restore/fsckPASS. Native fixture positive matrix is standard wrapped Edit16K/64K and genuine wrapped Rich Edit262K, both1M declared capacity, actual Unicode keyboard events and complete native+fixture text comparison. It additionally delays actual WM_CHAR80ms and asserts completion>1.5s with authorityExpiredAtReceipt=true and full exact readback. Packet-loop selftest independently blocks new packets after expiry. Classic wrapped262K has NOT_ACCEPTED status in the final positive receipt; do not generalize rich-editor acceptance to it. Follow exact new Actions native compile/selftests, classic16K/64K, rich262K, real delayed completion and focus-switch/full content acceptance. Keep classic wrapped262K limitation explicit; inspect real editor/provider evidence if positive cases fail. Then finish installer/upgrade/rollback CI, verify source/artifact/hash and final coherent truth/checkpoint for consolidated Owner UAT and isolated Lab alignment. No interim installer or production/Owner changes.

## Align keyboard indicators and explicit text acceptance layouts

Full checkpoint checkpoint/20261113-before-rmv2-indicator-contract-b6b766f bundleSHA 7b7ffdc8bb95623988bf43030847f25afecb10901d049990711567bedd67a4e2 restore/fsckPASS. CI114 run43451648853 sourceb6b766f text artifact14053761898 SHAf7110e1aa8bef6382e06f2a95bb88f2fe73f86733556f573806e0f90c393945a verified. PowerShell AST PASS. Product native compilation/OS acceptance only in Actions; no native build/test or install on Owner PC. Native text matrix explicitly separates editor/layout: classic wrapped single-paragraph16K/64K; genuine wrapped Rich Edit262K with CR paragraphs; real delayed delivery after admission expiry; focus change blocks suffix. Full text equality is checked after line-ending normalization only, no NFC normalization or sample-only match. CI114 giant Rich Edit single paragraph262K remains FAIL. Follow exact Actions source through native selftests, cursor/edge/lifecycle, capture benchmark and explicit text editor/layout matrix, delayed completion, focus-switch, full installer upgrade/rollback. Diagnose failures without replacing known FAIL with another case. After full PASS verify artifact/source/SHA and consolidate root truth/checkpoint for Owner UAT; isolated Lab alignment only after verified candidate. No public release or production change.

## Deliver line breaks only to bound native multiline editors

CI115 run43455766148 source1421d22 text artifact14054297308 SHA029d547f2429c6117cd86185c7d603b631b2a0fecc9425651c5a79d6993704de verified FAIL. Native cursor/lifecycle and DXGI/fresh fallback PASS; exact-source capture comparison recorded p95localcapture+pipe99.3024->77.4687ms on30samples/source, not network/input/Owner speedup. PowerShell AST PASS. Full checkpoint checkpoint/20261113-before-rmv2-dev11-closeout-1421d22 bundleSHA 075ed66876aa8da33c0c03a01f643dc17e29366365e4c5b03e3a6f0ff5b54b23 restore/fsckPASS. Native compilation/selftests/OS input only in Actions, never Owner PC. Native real fixture explicitly sets ES_WANTRETURN and AcceptsReturn for owned test controls; all LF,CRLF,CR cases on classic and rich must match whole text and native verified units. Pure actual packet builder tests3Return pairs and legacy Unicode preservation, and native policy tests unknown/browser/single-line rejection. No fixture app limits are changed by product. Follow exact new Actions native packet and line-break policy selftests, real six-case multiline readback, editor/layout large-text matrix, delayed completion/focus switch and full installer/upgrade/rollback. Preserve all prior giant-paragraph FAILs; no blanket262K acceptance claim. After fullCI verify source/artifact/hash, consolidate coherent truth/checkpoint and align isolated Lab before consolidated Owner UAT. Optional GPU preprocessing/hardware video/viewer remain unimplemented.

## Separate native Edit acceptance from managed editor stress cases

CI116 run43458403841 sourced349155 text artifact14055852590 SHA4be68b683bb17d24e36d77b23f119b30e54c6ccd6b682730460055aaa8aa283c verified FAIL. Its six newline cases completed before16K/64K full-native+fixture PASS; managed rich262K failed but full31728source-unit prefix arrived after stop without replay. Native selftests/cursor/lifecycle/DXGI fallback PASS and exact capture benchmark recorded separately. PowerShell AST PASS; new native fixture compile/OS input only Actions. Full checkpoint checkpoint/20261113-before-rmv2-dev11-final-d349155 bundleSHA 7869d54ad0d9d2926aa0d3acd819852e349c3d16180bb9fe450c3ba98b6d7353 independent restore/fsckPASS. Separate genuine Win32 EDIT large-input acceptance from managed editor stress limitations. Test fixture creates a real EDIT HWND with CreateWindowExW and declared multiline/WANTRETURN/1M capacity, assigns NativeWindow only for event counters and uses built-in Windows control/provider; it has no managed TextBox/RichTextBox accessibility object. Reset/read are test-fixture-only; actual input still goes through product native keyboard packets and UIA full readback. Keep managed classic16K/64K and managed classic/rich small newline cases; add nativeLF/CRLF/CR cases, use explicitly paragraph-structured nativeEDIT262K, and serialize all newline cases even on failure. Run actual delayed delivery before expensive sizes. CI116 managed rich paragraph262K remains NOT_ACCEPTED alongside both giant-paragraph cases. No product mutation/verification/timeout behavior changed by this fixture update. Follow exact Actions9newline cases, deliberate slow completion, managed16K/64K and pure Win32 EDIT paragraph262K full content acceptance, focus switch and full installer upgrade/rollback. Do not generalize Win32 acceptance to the failed managed Rich Edit stress cases. Preserve all failures and scoped proof; verify source/artifact/hash before isolated Lab integration and consolidated Owner UAT. GPU preprocessing/hardware video/viewer remain not implemented.

## Allow full native text completion and retain macOS checks

CI117 sourcef2aec12 run43462107355 text artifact14057972170 SHA97fa4631ea7bc0e7abfa4c640a6ffda4084545a255383861aca40896f72c99de verified. Last receipt RUNNING/external timeout is preserved as incomplete. macOS job132013762021/check-run annotations associated to exact source verified runnerName empty/no steps/hosted capacity error. PowerShell classifier AST PASS. Pre-change full checkpoint checkpoint/20261113-before-rmv2-dev11-acceptance-f2aec12 bundleSHA 66f3728faec85d2450cc9460d17d1c2fb8fca632f6390a582087b7e7e81fd59c restore/fsckPASS. All native builds/tests remain hosted Actions only. CI117 native Win32 paragraph stress progressed with exact acknowledged/observed content to126916source units, but external15minute step timeout cut it off. Nine real native/managedLF-CRLF-CR cases, delayed completion control flow and managed16K/64K passed; final262K was not accepted. Increase only bounded hosted Windows test budget15->40minutes and whole job80->110 to allow full completion plus installer/rollback; product input authority<=1000ms, read-only delivery5s and chunk RPC10s are unchanged. Add always-run receipt classifier: unfinished RUNNING becomes INCOMPLETE, and a successful text step without complete PASS/missing receipt fails. GitHub check annotations prove macOS arm64 job never acquired a runner due capacity. Pin standard macos-15-intel for the same Darwin source/vault tests instead of floating macos-latest; AppleSilicon/arm64 acceptance remains pending. No required test or branch protection disabled. GitHub standard runner reference: https://docs.github.com/en/actions/reference/runners/github-hosted-runners . Native source parity on macOSIntel is not AppleSilicon or macOS installer acceptance. Follow exact new full CI: all9native newline cases, real delayed completion, managed16K/64K and complete nativeEDIT262K paragraph+focus-switch; then full installer/upgrade/rollback and macOSIntel/Linux native source tests. Verify exact source/artifact/SHA only after all9jobs and baseline-required PASS. Then isolate Lab integration with rollback and record one coherent truth/checkpoint for Owner self-download/UAT. Giant/managed262K stress limits, AppleSilicon acceptance and GPU media/preprocessing remain explicit.

## Record verified dev11 candidate and scoped remaining RM work

Nội bộ **0.10.1-dev.11**, một **LightRemote.exe** chính. Source build `f1092607fb96ed181e9b4c71a55e13429b183a60`, tree `4fd8db8dd7398ada5d88f80907954f5540cc1cf3`. [CI118:9/9 PASS](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/43530897985) · [bộ cài nội bộ](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/43530897985/artifacts/14088683951) · [bằng chứng](docs/evidence/rmv2/acceptance-ci118.json). SHA-256 installer `9c913526ec4d615dc36c387c00a9c7e25c9931c54851ab6f7d3aabf5a20a6df6`. Đây là receipt tài liệu cho source đã build, không phải commit tài liệu được build lại. **Owner physical UAT: PENDING.** Lab Operator/Plugin đã cập nhật source `f1092607fb96ed181e9b4c71a55e13429b183a60` /dev11; health/API PASS, không migration DB, giữ Agent/Wall/supervisor/mTLS và dữ liệu hiện có. No native rebuild from docs-only receipt; all future artifacts must name their own exact executable source.
