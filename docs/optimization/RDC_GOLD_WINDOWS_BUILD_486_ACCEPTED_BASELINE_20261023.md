# Light Remote Gold Windows: owner-tested build #486 regression baseline
Date: 2026-10-23. Purpose: feature parity before Project Continuity development.

## Exact build to protect
- Windows Tray Client Actions #486; run ID 39942315406; SUCCESS.
- URL: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39942315406
- Branch: feature/gold-m6-integrated-20261023.
- Source SHA: 30766940ac18e55cb735354b40a3af9ba37eddb8.
- Artifact name: light-remote-windows-x64-30766940ac18e55cb735354b40a3af9ba37eddb8; artifact ID 12496473755.
- ZIP artifact SHA256 (not installer executable SHA): 974dff02d0559e37f40644034d1e6a291f56bbcd4f623b3dd7888712d2151b2a.
- Internal version 0.9.0-rc.49, Client Core 90 files. The version label alone is NOT enough to identify tested bits.
- Frozen source checkpoint: checkpoint/gold-pre-project-continuity-20261023 at same SHA.

## Distinguish physical acceptance and CI
Prior owner-assisted Windows test on DESKTOP-VA16D27:
- A/B approved, installed build #486, Local Wall responsive, Permissions UI visible, Real Remote V2 FRAME opened. Frame validation alone does not establish all mouse/keyboard/lifecycle behavior.
- Owner enabled D:\ drive Read+Write; structured Filesystem read/create/read/delete passed, SCP upload+download and SHA256 comparison passed.
- Denied when D:\ was removed from Read/Write roots: HTTP 403 filesystem_path_outside_allowed_roots.
These are records from the earlier owner testing, NOT tests repeated during this documentation update.

GitHub Actions #486 has successful native Windows build-install-smoke: Windows owner FS scope regression, nonblocking Wall inventory, native tray/Agent packaging, terminal+PTY/process and RM V2 regression, full+compact installers, install/uninstall, independent updater, update rollback. Some optional separate RM artifact upload/isolation steps are SKIPPED; do not count skipped steps as PASSED.

## Root cause of prior cross-branch regression
- #484 SHA 10024e3 included owner-configurable filesystem roots, volume picker, native FS/Search/SCP enforcement.
- #485 SHA bff0021 included a Wall responsiveness fix but was built from a branch missing #484 FS roots: UI/policy disappeared.
- #486 SHA 3076694 combined BOTH: Owner Filesystem access locations and low-latency Wall; Windows drive inventory became async/cached to avoid blocking the event loop.
Do not mistake a later green CI run from a different branch for a superset of #486.

## Mandatory parity checklist for future Windows packages
1. Pin exact source SHA and compare against #486; preferably develop from it, or prove equivalence after cherry-picking.
2. Preserve device-agent/filesystem-volume-inventory.mjs packaging; authenticated GET /api/filesystem-volumes and POST /api/filesystem-roots with CSRF; Read/Write volume checkboxes plus absolute subpaths; persistence/revocation.
3. Preserve distinct owner Read/Write scopes, policy denies and server-granted capability boundary; enforce on FS/Search/SCP and SCP chunks/commit; retain symlink and native ACL checks.
4. Preserve fast Local Wall /permissions and /status with nonblocking PATH capability discovery, bounded async volume inventory and remote-observer fallback.
5. Preserve Real Remote V2, cursor/typing routes, terminal/PTY/process lifecycle, updater and signed package/rollback invariants.
6. At each candidate: run Windows filesystem regression, Wall nonblocking regression, client/core-files packaging tests, RM V2 and install/updater/rollback CI. Review all skipped steps.
7. On owner Windows: repeat volume D:\ Read/Write, allowed/denied FS, SCP upload+download+hash, Wall status/Permissions response, RM frame. Record actual build ID+SHA and PASS/FAIL/BLOCKED.
8. Do not claim from #486 alone: all RM input modes accepted, Scheduled Tasks/UAC broker verified, M6 four-service UAT cutover, Pro Team/3+1, macOS parity, or production rc.47 deployment.

Reference: docs/gold/OWNER_FILESYSTEM_ROOTS_20261023.md;
docs/optimization/RDC_GOLD_WINDOWS_WALL_LOADING_STALL_RCA_20261023.md;
docs/optimization/RDC_GOLD_M6_RESUME_INTEGRATED_20261023.md.

This is a documentation-only preservation step; do not restart services, apply migrations, modify resource claims or rebuild Windows.
