# Project Truth — Light Remote MCP

Official development/build repository: [n8n2erpnext/light-remote-mcp](https://github.com/n8n2erpnext/light-remote-mcp), repository ID **1450214328**, created 2026-11-08. Version **0.10.1-dev.2**; contract **light-remote.api.v1**; profile **goldabv2-desktop-v4**.

Repository reconstruction and source-authority conversion are complete. History begins at parentless commit aa378ba64618b979ca54b34c066f53dab0067980; no old parents, branches or tags were imported. The old repository (ID 1361698660) is retained [as a read-only archive](https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108). Available administration lacked delete_repo scope, so it was renamed before a genuinely new repository was created at the official name/URL. No force-push was used.

Current verified Windows candidate: **0.10.1-dev.2**, compiled source `31f23393aacb89b6d541cebb2cd0c2e1afa64538`, [CI #30](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42549642811) **9/9 PASS**. This includes core/contracts and actual PostgreSQL/Redis integration, locked native Windows/macOS/Linux builds, browser/security checks, installed one-primary GUI/private CLR, hidden-GUI Agent restart, real bridge upgrade/reinstall, injected health-failure rollback, independent installer watchdog recovery and uninstall. The final package contains root `LightRemote.exe` and neither former primary EXE. Node/RM V2/private framework DLLs/recovery helpers remain separate. [Verified CI artifact](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42549642811/artifacts/13645690974); installer SHA-256 `aac78a063f0628eac2966052fa0cd9e6650b5c2c6a1deb5048939e9a7b83ab19`. Exact build and primary-layout evidence is under [docs/evidence/windows-one-primary](docs/evidence/windows-one-primary/PRIMARY_EXE_MANIFEST.json). Public binary release is NOT_PUBLISHED and awaits explicit Owner approval after automatic review rejection. The compiled source was fast-forwarded to protected main without changing protection; later documentation receipts are not rebuilt installers.

The earlier reconstruction baseline **c03b50f / 0.10.0-dev.1** was fetched from GitHub and deployed into `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/conversion-20261108/runtime-from-github-c03b50f432` as private candidate `lru-c03b50f432-114436`. **21/21 actual integration checks PASS**; all three labelled containers are running on an internal Docker network with no published host ports. This source comes from the new GitHub repository, not an old STAGED folder. Backend/Agent proof and Windows CI proof remain separate from authenticated GUI acceptance against this new backend.

Original ARM worktrees/runtime and audited snapshot **b25090856991da04f1c2fb1d43760700f9d79e08** remain unchanged as comparison/recovery truth. All future development/builds use exact commits from the new GitHub repository. Do not fetch/push new unrelated history from the old worktrees. No production traffic, old database, installed Owner app, session or grant was migrated.

The reconstruction began from the audited snapshot; subsequent source changes, including the one-primary Windows implementation and PostgreSQL final-server readiness fix, are tracked on the authorized work branch and verified in exact-source CI. MASTER_CHECKPOINT.json is the sole active checkpoint. Historical checkpoint/workflow material under docs/history is reference evidence. main requires the GitHub Actions baseline-required check and disallows force-push/deletion, including admins.

Product gaps remain explicit in KNOWN_ISSUES.md: new-backend native GUI acceptance, local Agent/browser SSO wiring, new signed B-command exercise, restored prototypes, full Mac/Linux packages, complete endpoint catalog and physical Owner acceptance of the new single-primary Windows candidate. Preserved signed legacy beta feeds do not advertise this 0.10.0 candidate; Fleet Wall's old GitHub release URL needs a controlled feed/release migration. No new public update feed was promoted.

The [T12 consolidation plan](docs/plans/windows-single-primary-exe/LIGHT_REMOTE_CORE_EXE_CONSOLIDATION_PLAN_20261107.md) remains historical design/coverage evidence. Its requested two-primary-file consolidation is now IMPLEMENTED and native CI_PASS using in-process hostfxr plus the existing managed Windows implementation. Physical Owner/account/vault/B tests remain NOT_RUN; public update feed remains HOLD. No existing ARM or Owner Windows runtime was replaced. Dated milestones below record state at the time; the current summary and single Master Checkpoint take precedence.

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
