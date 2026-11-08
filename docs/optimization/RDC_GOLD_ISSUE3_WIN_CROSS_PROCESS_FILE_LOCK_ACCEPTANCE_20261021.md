# GitHub Issue #3 — Windows Gold exclusive file-lock acceptance

Date: 2026-10-21. Issue: https://github.com/n8n2erpnext/light-remote-mcp/issues/3

## Reproduction and supported route

Issue #3 was filed against *installed production rc.47*, commit `218fd3aa45ece9ed04b30ee341c3499945483f47`. It attempted a two-process `FileShare.None` test using a PowerShell `-EncodedCommand` payload, which local Windows platform policy intentionally denied with `windows_encoded_powershell_denied`, exit 126. **This is a deliberate hard-deny, not a permission grant or intermittent MCP fault. Gold retains that rule** in `device-agent/platform-adapters/windows.mjs`, and `selftest-v09-platform-adapters.mjs` verifies it.

Official policy-compliant alternative: existing `light_remote_process`, `light_remote_process_input`, `light_remote_process_output` and `light_remote_stop_process` using plain `powershell.exe -NoProfile -NonInteractive -Command` with a synthetic owner-scoped local `.ps1` fixture. The same native process registry and Windows adapter are used in Windows CI. Gold's in-package `ManagedProcessEnvelope.cs`/Windows Job Object manages each process/descendant and avoids additional privileged binaries. **No `-enc`, Base64+IEX, bypass, UAC elevation, local Wall policy relaxation, security toggle or production change.**

## Gold automated Windows regression

- Source and CI addition: commit `a6ba88c00bf585bab4034c9015b85689acf98d3d`: `deploy/scripts/selftest-g2-windows-cross-process-filelock.mjs`, Windows Tray Client workflow bundled runtime smoke.
- First Windows CI: [#39565399341](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39565399341), **FAILED**. It proved holder A acquired `FileShare.None` and B emitted explicit sharing-violation marker. Fixture assumed PowerShell `-Command` would preserve script `exit 73`, but Windows returned normalized nonzero exit **1**. This was an assertion mismatch, not evidence that B obtained the lock. Full log was read; no hidden retry counted as PASS.
- Test-only correction `6729f5da325de5f042ddf567b6b023b635635e08`: require **explicit `ISSUE3_LOCK_DENIED_WHILE_OWNED` IOException marker AND exitCode != 0**, independent of whether PowerShell maps 73 to 1. Successful unlock requires explicit separate `ISSUE3_LOCK_ACQUIRED_BY_PROBE` marker AND exitCode 0.
- Second Windows CI: [#39565884791](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39565884791), **workflow completed SUCCESS** on exactly `6729f5d`. The full **211,972-byte** Windows job log was inspected. The bundled smoke printed seven explicit PASS markers:
  - `ISSUE3_ENCODED_COMMAND_HARD_DENY_UNCHANGED=PASS`
  - `ISSUE3_A_EXCLUSIVE_FILESHARE_NONE=PASS`
  - `ISSUE3_B_DENIED_WHILE_A_HOLDS_LOCK=PASS`
  - `ISSUE3_NORMAL_RELEASE_AND_B_ACQUIRE=PASS`
  - `ISSUE3_TEST_OWNED_A_TERMINATED=PASS`
  - `ISSUE3_CRASH_RECOVERY_B_ACQUIRE=PASS`
  - `ISSUE3_ALL_SYNTHETIC_STAGING_AND_PROCESS_CLEANUP=PASS`
- Ancillary Windows Job Object natural parent exit, nested job helper, stdin/stdout, timeout/stop orphan cleanup, native build/installer tests remained green in full workflow.

## Scope and decision

**Resolution: supported non-encoded managed-process test method and GitHub-hosted Windows Gold CI acceptance verified; do not remove hard-deny.** This resolves the original testing blocker at the *Gold source / hosted-Windows acceptance* level. The supplied issue can be closed as resolved with this alternative, accurately labeled.

**Remaining separately scoped UAT:** no explicitly paired Windows target is currently available in the connected Gold plugin device list (only `light-remote-gold-uat` Linux ARM), so this test was **not executed on the owner's installed Windows Gold client**. No production rc.47 fix/backport or auto-install was performed. Once owner pairs Windows Gold through its Local Wall, repeat the managed-process acceptance E2E on that installed client, and track any mismatch as a separate issue/reopen with exact device version. G Plan owner physical acceptance remains open despite issue closure.
