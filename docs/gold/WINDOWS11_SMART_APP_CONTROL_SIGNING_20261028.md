# Windows 11 Smart App Control / Authenticode acceptance — Gold UAT
Date: 2026-10-28. Source branch: feature/gold-windows-ci-once-20261028 (run #536, commit 227a0eb), repair/audit branch: fix/gold-win11-authenticode-audit-20261028.

## Actual customer failure
The remote Windows 11 PC displayed “Smart App Control blocked an app that may be unsafe” for the installed `%LOCALAPPDATA%\Programs\Light Remote MCP\GptOperator.Client.exe`, because Windows could not verify its publisher. Inno Setup post-install launch then returned CreateProcess error 4551 (“An Application Control policy has blocked this file”). The installer has already written files, and may have created Scheduled Tasks and autorun entries; this is not evidence the app runs successfully. Avoid manually deleting user settings or lowering Windows policy.

Run #536 succeeded on Windows GitHub runner but the project workflow has no Authenticode-signing stage and the Inno Setup script has no `SignTool` directive. The CI “signed update” tests verify application-specific update manifests, NOT Microsoft Windows publisher trust. These are distinct trust domains.

## Required permanent remedy
1. Obtain **publicly trusted RSA Authenticode code-signing credentials** under the legal publisher identity. Private keys must remain in an HSM or secure signing service. A temporary self-signed certificate or SHA256 checksum does NOT establish Windows Smart App Control publisher trust.
2. Sign the **staged native tray client** `GptOperator.Client.exe` and all project-owned executable PE payloads (including RM V2 companion, updater, install watchdog and any other unsigned DLL/EXE/native .node), while preserving trusted third-party signatures. Check PowerShell script signing as applicable to your distribution policy.
3. Configure **Inno Setup `SignTool` before compilation**, with `SignedUninstaller=yes`, so Setup, Uninstall and relevant temporary self-copies are authenticode signed. Signing only the compiled outer `Setup.exe` afterward is insufficient. Sign BOTH full and compact installers.
4. Timestamp SHA256 signatures and validate `Get-AuthenticodeSignature` / `signtool verify /pa /all /v` against a publicly trusted root. Windows 11 SAC may still reject apps independently judged malicious or unwanted. Run an authorized physical Windows 11 test with SAC **On**, without weakening the customer's policies.
5. Only then label an artifact Windows 11 SAC-compatible. Prefer Microsoft Store signed distribution or a code-signing CA for the developer's country. Azure Artifact Signing public trust eligibility varies by region; confirm independently.

## Audit integration
`deploy/scripts/windows-authenticode-audit.ps1` runs on Windows GitHub CI after both installers are generated; writes `dist/windows/installer/authenticode-audit.json` and prints a clear warning when unsigned. For development UAT builds this is **advisory** so the existing CI remains able to test logic; pass `-RequireTrustedSignatures` for a gated *release* build. An unsigned artifact must never be represented as a publisher-signed production release. It does not sign anything itself. No new Windows CI workflow was triggered as part of this audit branch.

## Reference
Microsoft: Smart App Control FAQ and Windows 11 App Signing guidance; Inno Setup official SignedUninstaller and SignTool directives. Windows CodeIntegrity Operational events 3077 can confirm the exact blocked PE on the test PC if needed, read-only.
