# Issue #3 — owner Windows before/after acceptance (2026-10-21)

## Scope and provenance
- Target (owner A/B approved in Gold plugin): **DESKTOP-VA16D27**, Windows x64.
- Test route: actual connected Gold MCP `light_remote_exec`, `light_remote_process`, `light_remote_process_output`, `light_remote_process_input`, `light_remote_stop_process`. No direct local shell, no alternate device or privileged test fixture.
- Branch: `feature/light-remote-gold-rebuild-20261018`.
- Issue: https://github.com/n8n2erpnext/light-remote-mcp/issues/3
- Windows CI acceptance: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39565884791
- Build commit: `6729f5da325de5f042ddf567b6b023b635635e08`.
- Installer artifact: GitHub Actions artifact `12330026769`, ZIP SHA-256 `bfa9c3c9c1178cf38dc035158c71aa91de3dc8d300a2300b9285270940c3514c`; full installer SHA-256 `02d54cdd878335f1616b366356b8139d639f13ab4cee6c83650f77e4823803c3`, matches bundled SHA256SUMS.txt.
- Artifact and existing client installer reported Authenticode **NotSigned**; this is a Gold development CI package, NOT a claim of production-signed release or automatic rollout.

## OLD installed client / before upgrade
- `GptOperator.Client.exe` ProductVersion: `0.9.0-rc.49+eca1f98e8be492c34da407dc938fd084f6fb2873`.
- Client executable SHA-256: `AA03881187167D1957A07B506EB0B8BB036E93922C4137813997944C5583887D`.
- Agent `device-agent/operator-agent.mjs` SHA-256: `C5E8523F5076467C7313F8CDD3F1EBAAC60829A94DA72031C5B1100C772163E9`.
- Original issue-form command through Gold remote exec `powershell.exe -EncodedCommand QQ==`: **DENIED, exit 126**, stderr `local platform policy denied: windows_encoded_powershell_denied`.
- A test-owned `.ps1` file in user TEMP through managed process: **DENIED by Windows PowerShell Execution Policy** (`PSSecurityException`, exit 1; system running scripts disabled). Device ExecutionPolicy was not changed.
- **Supported direct PowerShell -Command managed-process UAT (same code on both builds):**
  1. Two distinct test-owned native managed processes with .NET `System.IO.File.Open`, `FileMode.OpenOrCreate`, `FileAccess.ReadWrite`, `FileShare.None`.
  2. Holder A acquired the exclusive file lock; exact stdout `ISSUE3_LOCK_ACQUIRED_BY_HOLDER`, state running, Windows `treeContainment=job-object-kill-on-close`.
  3. B failed while A held the handle: `ISSUE3_LOCK_DENIED_WHILE_OWNED`, nonzero exit 73.
  4. A received stdin `release\n`; stdout `ISSUE3_HOLDER_NORMAL_RELEASE`, exit 0; B subsequently returned `ISSUE3_LOCK_ACQUIRED_BY_PROBE`, exit 0.
  5. New A acquired lock, B denied exit 73; `light_remote_stop_process(force:true)` stopped only test-owned A, `treeStopMethod=taskkill-tree`; B subsequently acquired lock, exit 0.
- **OLD installed runtime: all six legitimate cross-process and recovery conditions PASS.** This disproves the hypothesis that the installed native managed-process path could not lock/unlock files; the original `-EncodedCommand` denial itself was real and intentional.

## Installation / rollback
- Existing same-version rollback installer preserved independently on Windows owner test machine under its test-only TEMP staging as `PREPATCH-rollback-installer-rc49.exe`; SHA-256 `00F35BE3B3463215E10F9783223888F47B73B0536B31577A659D72B0CE687B97`.
- The GitHub artifact was downloaded to the authorized Windows target, SHA-256 validated on-target, extracted, and full installer validated against GitHub SHA256SUMS.
- Launched via normal Windows interactive Run UI, unattended flags `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`, with a private setup log. This avoids tying installer lifetime to the Agent-owned managed-process Job Object during Agent quiesce.
- Installer log: `Installation process succeeded`, `light-remote-rollback-cache-ready`, `light-remote-install-transaction-committed`, `Need to restart Windows? No`. Gold plugin session recovered.
- Installed Client ProductVersion after upgrade: `0.9.0-rc.49+6729f5da325de5f042ddf567b6b023b635635e08`.
- Post-install Client SHA-256: `27382E033E92A3EC54AC4CDB8EDEECFD411E8F85DA6E143FAAA04D810A756030`.
- Post-install Agent SHA-256: `491546B7FD973312952678F287C6102AF2736D87BB93BB173B1E893A02B2374D`.

## NEW installed client / after upgrade
- `-EncodedCommand` **STILL denied 126**, identical error `windows_encoded_powershell_denied`; required invariant preserved.
- Running owner-scoped `.ps1` file still denied by Windows Execution Policy with exit 1; no relaxation made.
- Exact same legitimate inline PowerShell `-Command` / managed-process `FileShare.None` cases: holder A accepted; B denied with marker and exit 73; A released via stdin and exited 0; B acquired exit 0; second holder A acquired and B denied; forced stop returned `treeStopMethod=taskkill-tree`, holder stopped exit 1; B acquired exit 0.
- Test-owned synthetic lock and .ps1 fixture deleted. Original prepatch rollback installer, new full setup and private setup log retained; ZIP removed to recover disk space. No production Agent, Operator, domain, billing, or firewall mutation.

## Technical resolution (precisely scoped)
- Code patches `a6ba88c` (new Windows CI two-process regression) and `6729f5d` (test assertion correction from hardcoded exit 73 to explicit sharing-violation marker **and any nonzero exit**) were **test/integration-only**, not a change to the Windows adapter hard-deny or runtime file-lock implementation.
- The managed-process route was already functional in the OLD installed client, and remains functional on NEW Gold. The original issue is resolved as **documented policy-compliant supported testing method plus regression coverage**, **not** as a formerly broken OS file-lock function repaired by this installer.
- Closing Issue #3 is defensible on this explicitly named resolution; do not claim encoded PowerShell now works, all scripts are enabled, or behavior newly fixed. Reopen separately if a production/physical client fails the supported process contract on another build.
