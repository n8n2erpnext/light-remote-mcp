# Build and deployment

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
