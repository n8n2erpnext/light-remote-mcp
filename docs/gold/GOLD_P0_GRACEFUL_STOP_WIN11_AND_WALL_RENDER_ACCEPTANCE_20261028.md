# Gold P0 — Windows graceful Stop and Wall Stopping verification (2026-10-28)

## Code state
- Commit `362886f8e08a8868bc51a60c0de5949c4d3631a2`: Windows managed process `force:false` now tries non-forced taskkill `/PID /T`, bounded default Windows grace 3s, force fallback `/PID /T /F` only if needed. No parent-only fallback without trusted Job Object containment. Code reports force accurately. Windows test updated and added to Windows CI.
- Commit `d5e1ec82aa75eeb654033670d7f72fac460a0bc4`: Local Wall presents `stopping` when pending signed Stop on an otherwise `running` job; original ledger `j.status` unchanged, signed `job_finished` is the only terminal transition. Static Wall/Gateway tests PASS.
- `selftest-gold-wall-stopping-render.mjs` now actually executes the extracted Wall `renderJob` function in a stubbed DOM and checks running -> visible stopping -> signed terminal cancelled presentation without changing authoritative running state.

## Verified Windows CI
- Windows Tray Client run https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40720243027 on exact `362886f` completed **SUCCESS**. `build-install-smoke` and `Native client bundled runtime smoke` step SUCCESS, including updated native Windows process-tree test and new graceful-stop contract.
- Windows CI for `d5e1ec8` was IN PROGRESS at the time of this checkpoint; do not assume PASS until externally verified.

## Physical Windows 11 isolated module acceptance (no client install)
- Authorized Windows11 `baolong123`, session `s_mvrqy8fc_04db7baddf313727`: staged exact Git source `native-process.mjs`, `selftest-g2-windows-process-tree.mjs` and `selftest-gold-windows-graceful-stop-contract.mjs` ONLY under `C:\Windows\Temp\lr-p0-graceful-362886f`, using official Gold File writes. No installed Agent files touched.
- Node 22.23.2 bundled with installed client executed the two tests on actual Win11; stdout: `P0_WINDOWS_SOFT_REQUEST_BOUNDED_ESCALATION_NO_PARENT_ONLY_ORPHAN_CONTRACT=PASS`, `G2_WINDOWS_GRACEFUL_REQUEST_THEN_BOUNDED_FORCE_IF_REQUIRED=PASS`, `G2_WINDOWS_PROCESS_TREE_STOP_NO_ORPHAN=PASS`, `G2_WINDOWS_PROCESS_TREE_TIMEOUT_NO_ORPHAN=PASS`, `G2_WINDOWS_PROCESS_TREE_SHUTDOWN_NO_ORPHAN=PASS`, `WIN11_P0_GRACEFUL_REAL_WINDOWS_ISOLATED_PASS`.
- IMPORTANT full test exec job `dea59fc4-2ec7-4677-850d-3229624a86ed` returned exitCode=1 **only because PowerShell Remove-Item lacked Windows ACL rights under C:\Windows\Temp**. Process-tree assertions had all completed PASS before cleanup. Exact isolated directory then removed with the authorized official Gold `light_remote_delete_path(recursive=true)`, and subsequent read returned `filesystem_path_not_found` 404. No lingering test fixture.
- First attempt on user Temp path queued behind an unrelated historical `terminal_unknown` resource claim; exact three queued File writes were cancelled_before_dispatch/verified=true, no files created there. Re-ran in independent C:\Windows\Temp; do not remove or bypass historical claim.
- Windows10 source test NOT executed because its former A/B grant now returns `device_access_grant_required`. Do not bypass or ask owner to renew as part of held Team acceptance.

## Still open/held
- Real installed Win10/Win11 Agent is still old rc.49; **new graceful Stop behavior on installed client NOT yet physically validated**. Requires separate approved client build/install gate after CI; do not silently upgrade.
- New Wall stopping status has source/stubbed-DOM PASS but not physical installed Wall screenshot; keep visual gate open.
- Gold UAT four runtime services remain `c0c6977eb9c940c7af67f1d9887bf3f02de7d78b` and PG38 durable resource claims remain running:2, terminal_unknown:1. No production change.
- Owner directives: real Pro Team A/B independent multi-device HOLD_OWNER_RESOURCES, historical claims HOLD_EVIDENCE_AND_OWNER_AUTH, A/B V2 redesign deferred.
