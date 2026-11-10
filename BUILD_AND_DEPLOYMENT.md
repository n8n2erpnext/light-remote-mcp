# Build and deployment

## Current internal Windows candidate — 2026-11-09

Version **0.10.1-dev.4**, source `947a11763161aca6856ffc1e8e18dc8fc446ede7`, tree `0ef2892ae2b8ecf253e35510548a1493673d21ee`, [full CI45 PASS9/9](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42628405851). [Verified internal installer](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42628405851/artifacts/13679554745); SHA256 `a59e94e98c2581def5a9f622a3551e57a9ecc2071f7994f5a30db3850729ad5e`, bytes167128810. ZIP SHA256 `0387613036370ef71db350b3ff8d82364993c7f54948dfc2b8b6617715878897`, artifact13679554745. [Build manifest](docs/evidence/desktop-user-experience/BUILD_MANIFEST.json), [primary inventory/migration](docs/evidence/desktop-user-experience/PRIMARY_EXE_MANIFEST.json), [acceptance](docs/evidence/desktop-user-experience/ACCEPTANCE.json). One primary LightRemote.exe; the two former GUI executables are absent. Node/RM/private .NET/independent recovery tools remain supporting components.

Native builds run in Actions only. Exact-source frontend121 tests and170 browser cases use synthetic entry/unavailable/populated states and two dialogs; e2e fixtures are not production imports/bundle payloads. Native installed GUI, background Agent restart/idempotent Start, real bridge upgrade/reinstall/health failure rollback/watchdog/uninstall PASS. Old incompatible helpers still take pinned bridge0.10.1-dev.1. SHA256 proves artifact integrity/source matching; Authenticode trust or physical Owner acceptance is not inferred.

The internal A/B Lab Operator and Plugin moved from preserved2771f47 to947a117 only after full CI and installer verification. New runtime: `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/implementation-20261108/backend-runtime/947a11763161aca6856ffc1e8e18dc8fc446ede7/code`. Fresh source is a GitHub commit archive. Dependency caches have identical complete lock structures except project version and the same Node22 ABI127. Backups preserve prior unit overrides/private inputs and a pg_dump whose archive index was checked; no DB migration or restore performed. Admin maintenance uses the previously proven ignore-requirements restart mode to preserve the existing Agent/Wall, supervisor and mTLS PIDs/dependency graph. This rollout did not change home ACLs. Private/public health and snapshot401, equal persisted counts and retained old source/runtime PASS. Rollback restores the exact prior owned overrides to2771f47; no automatic DB reset.

No new public binary Release, feed promotion, production UAT/direct cutover or Owner Windows installation change. Owner manually tests this exact internal dev.4 installer. This documentation-only receipt follows pinned compiled source and does not rebuild it. Historical entries below retain their original provenance.

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
