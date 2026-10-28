# Gold Windows 11 stability RCA and release gates — 2026-10-28

## Scope / isolation
Owner requested a comprehensive RCA and fixes after Win11 baolong123 enrollment, 21/23 capability mismatch, silent RM activation loss, Tray relink, Agent going dormant, restart / Cloud routing, and executable Smart App Control blocking. This fix worktree is isolated from Gold UAT runtime and all production; target branch fix/gold-windows-relink-rm-stability-20261028 is based on Windows #537 commit f290686. No file in user's installed Windows is modified by these source changes.

## Observed sequence and root causes
1. Windows 11 SAC blocked unsigned bundled GptOperator.Client.exe (Win32 error 4551), even though an unsigned installer .exe could run or be unzipped; missing Authenticode trust is a separate distribution gate, cannot be fixed by changing archive type, disabling SAC or claiming signed manifest verification equals publisher signing. Certificate/Store packaging and Windows 11 SAC On acceptance are outstanding.
2. Previous Windows Tray had no re-link UI. Agent login without --reenroll just reused the existing enrollment even if server had removed the device. #537 added Tray Relink; this branch hardens it.
3. RM V2 companion exists on Windows 11 but Agent CLI re-link executed without LIGHT_REMOTE_REAL_REMOTE=1 / LIGHT_REMOTE_CLIENT_EXE, so it advertised only 21 capabilities. Gold server could not add unseen capabilities even with owner Full access. The source RM V2 detection requires BOTH explicit opt-in AND an existing companion path; this security invariant must remain.
4. On owner approval the Agent keeps pendingEnrollment until an authenticated poll confirms approved. Local Wall selected 23/23, while effective and server device routing remained 21/23 until poll. When manual CLI poll eventually applied the signed enrollment, the server knew desktop / desktop-input but the active device channel still needed to restart and reconnect.
5. finishEnrollment intentionally sets Cloud dormant, desiredConnected=false for any newly approved account: a safe cross-account boundary. Manual poll + schtasks /Run while already running does not restart the old scheduled task. The old daemon can therefore remain offline or continue with stale channel state. A safe, user-triggered Tray flow should restart and then explicitly connect; manual users need a verified restart and Connect.
6. The #537 Tray accepted only an HTTPS activation URL with the same host as Bridge, while the server supplied http://127.0.0.1:5583/enroll?id=enr_... in Gold UAT. That URL points to the operator service and is wrong when opened in an end-user browser.
7. RestartAgentTransactional previously considered Local Wall port still open a success even if no down transition was detected. That permitted false positive 'restarted' claims.
8. Some remote Win11 wsl/shutdown/diagnostic commands were refused by the calling tool's external safety enforcement or returned output suppression. This is NOT evidence of Windows OS crashes or an Agent product flaw. Do not alter remote policies to bypass it.
9. Windows 10 DESKTOP-VA16D27 and Win11 baolong123 both belong to the same account; selecting the main-device session without checking the explicit device target led to wrong-machine confusion. Always bind calls to baolong123 device ID after fresh A/B.

## Changes in fix/gold-windows-relink-rm-stability-20261028
- AgentHost.ConfigureRealRemoteEnvironment(ProcessStartInfo): one shared, fail-closed method for the bundled companion. It configures the daemon, Tray status/relink/poll/CLI, and legacy AgentSupervisor execution consistently; when the trusted bundled companion is absent it removes inherited RM env vars.
- Tray TrustedEnrollmentActivationUrl validates HTTPS Bridge host/port or one known Gold operator loopback (port 5583), exact /enroll path, bounded enrollment id, no userinfo, fragments or other query fields. Rewrites valid loopback links onto the configured trusted HTTPS Bridge; never opens an attacker-chosen URL.
- After owner-triggered Tray poll=approved, request a transactionally managed Agent restart, verify the old Wall went offline AND a new Wall came online, then call Agent connect on the new enrollment, verify status, and show truthful success/warning. Unattended raw CLI/Local Wall approval remains Cloud dormant, preserving the cross-account boundary.
- AgentSupervisor BeginEnrollmentAsync checks if already enrolled and calls login --reenroll --no-wait instead of login --no-wait.
- Tray runtime .NET self-tests cover actual URL parsing (loopback, trusted origin, hostile origin, injected query) and real companion env in ProcessStartInfo; Node contract regression and existing RM V2 tests also run in GitHub Windows CI.

## Owner acceptance / release gating
1. GitHub Actions Windows Tray Client must compile .NET native x64 Tray, complete installer/full+compact smoke, Agent state smoke, RM V2 subprocess/pipe smoke, updater rollback test, and emit Windows artifact. Do NOT assume a static Node PASS proves Win11 compatibility.
2. On Windows 11 with RM V2 bundled and Gold enrolled under a test account, verify Tray Relink prompts with default No; cancel must not change account or keys. Confirm Yes generates one device code and the correct HTTPS Gold activation URL (not 127.0.0.1:5583 on the user's machine).
3. Owner logs in and approves. Tray polls, applies signed policy, confirms 23/23 effective including desktop and desktop-input, verified Agent restart and Cloud online. Attach RM in a NEW or refreshed session; no target_node_capability_missing.
4. Verify Local Wall login of new account and rejection of previous owner, scoped Long Memory preserved without cross-account leakage, Windows Scheduled Tasks and tray status consistent; test offline/reconnect and expiry retry.
5. Continue to consider SAC signed installer / MSIX Store beta separate; current GitHub CI artifacts are not yet guaranteed to be trusted by Smart App Control. Do NOT turn off Defender or advise bypass. No Store submission.
6. A Gold UAT branch is not production; require code review/PR before merging or deploying to users. Do not auto-update the running Win11 owner device during CI.

## CI incident and test coverage update
- First Windows GitHub Actions run #538 compiled successfully but the native Tray self-test failed, before installer deployment. Job logs showed trayLogic=false. The added URL query matcher mistakenly contained two regex backslashes before ?, so the server's valid ?id=... did not match. Fixed to a single regex escape and added a static guard against double escaping. Do not publish run #538.
- Windows GitHub Actions run #539 (https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40652410188) completed SUCCESS on commit 8dd9a5fadca050c7b64f499b60c582450295c519. Native runtime smoke, RM V2 companion/bridge, full and compact installer, updater rollback and uninstall smoke all passed. Artifact: light-remote-windows-x64-8dd9a5fadca050c7b64f499b60c582450295c519 (331906203 bytes, GitHub Actions ZIP). This is source/CI acceptance, not Windows 11 physical A/B relink acceptance; SAC signing remains unresolved.
- After CI, baolong123 checked with Gold device inspection: device Online, routing Online, cloud Connected, 23 effective including desktop and desktop-input. That is its currently installed client, NOT a test of the newly built #539 binary.

## Remaining work
- Run the Windows CI workflow once on the dedicated fix branch and inspect real logs; static and .NET compile gates must pass. If errors occur, fix in the dedicated branch and rerun only as required.
- Manual owner Win11 E2E still required; cannot claim 'fully stable' solely from CI.
- A code-signing certificate / Microsoft Store packaging workflow is still unprovisioned.
- Linux desktop .deb testing on WSL2 / WSLg was a separate goal; no WSL installation was verified by this task.

## Technical references
Windows build #537: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40644226603 (success, commit f290686ce3796f6e488212121911d5f95dc944aa).
Gold branch source root: /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/gold-windows-stability-20261028
Remote build only via GitHub SSH push from VPS-ARM, workflow .github/workflows/windows-native-client.yml.
Prior Authenticode audit worktree: fix/gold-win11-authenticode-audit-20261028, commit e9c0920. Not automatically merged or proof of signing.