# Project Truth — Light Remote MCP

Official development/build repository: [n8n2erpnext/light-remote-mcp](https://github.com/n8n2erpnext/light-remote-mcp), repository ID **1450214328**, created 2026-11-08. Version **0.10.0-dev.1**; contract **light-remote.api.v1**; profile **goldabv2-desktop-v4**.

Repository reconstruction and source-authority conversion are complete. History begins at parentless commit aa378ba64618b979ca54b34c066f53dab0067980; no old parents, branches or tags were imported. The old repository (ID 1361698660) is retained [as a read-only archive](https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108). Available administration lacked delete_repo scope, so it was renamed before a genuinely new repository was created at the official name/URL. No force-push was used.

Verified build source: `c03b50f4328e07138f350532c31dfc8b260311ce`, tree `fa9d78b1d8e835259b4fe77ac414b2ab92175a00`. [Fresh-repository CI](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42475715858) **9/9 PASS**: core/contracts and 21 real integration checks, Desktop UI/browser/security tests, locked native macOS/Linux source builds/tests, full Windows installer/install/update/rollback/uninstall and the required baseline gate. Windows artifact **13615761284** and its embedded installer were SHA-256 checked on ARM; see docs/evidence/windows-artifact-verification.json and windows-build-manifest.json. This is development-candidate evidence, not physical Owner acceptance or a production release.

After CI, the exact GitHub commit was fetched again and deployed into `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/conversion-20261108/runtime-from-github-c03b50f432` as private candidate `lru-c03b50f432-114436`. **21/21 actual integration checks PASS**; all three labelled containers are running on an internal Docker network with no published host ports. This source comes from the new GitHub repository, not an old STAGED folder. Backend/Agent proof and Windows CI proof remain separate from authenticated GUI acceptance against this new backend.

Original ARM worktrees/runtime and audited snapshot **b25090856991da04f1c2fb1d43760700f9d79e08** remain unchanged as comparison/recovery truth. All future development/builds use exact commits from the new GitHub repository. Do not fetch/push new unrelated history from the old worktrees. No production traffic, old database, installed Owner app, session or grant was migrated.

Product source matches the audited snapshot; publication changed governance/CI configuration and one packaging validation assertion for the new codex/** branch namespace. MASTER_CHECKPOINT.json is the sole active checkpoint. Historical checkpoint/workflow material under docs/history is reference evidence. main requires the GitHub Actions baseline-required check and disallows force-push/deletion, including admins.

Product gaps remain explicit in KNOWN_ISSUES.md: new-backend native GUI acceptance, local Agent/browser SSO wiring, new signed B-command exercise, restored prototypes, full Mac/Linux packages, complete endpoint catalog and the future single LightRemote.exe. Preserved signed legacy beta feeds do not advertise this 0.10.0 candidate; Fleet Wall's old GitHub release URL needs a controlled feed/release migration. No new public update feed was promoted.

Owner-requested handoff publication (2026-11-08): [T12 LightRemote.exe consolidation plan](docs/plans/windows-single-primary-exe/LIGHT_REMOTE_CORE_EXE_CONSOLIDATION_PLAN_20261107.md) is now in the official repository with its branch-coverage evidence. It merges only the two primary Windows EXEs; Node/RM/updater/helpers remain separate. Status: design/handoff, NOT_IMPLEMENTED; baseline binaries/runtime and acceptance evidence are unchanged.

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
