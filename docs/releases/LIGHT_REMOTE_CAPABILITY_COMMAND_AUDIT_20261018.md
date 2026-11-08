# Light Remote cross-platform command/capability audit — 2026-10-18

## Scope and evidence

This is a **source-audited capability-family sweep**, not a live attempt to run all commands. It inspected the canonical Plugin schema and Operator+leaf admission paths, Linux/Windows/macOS adapters, existing isolated policy tests, and the paired device policies exposed by the official Plugin. A matrix of **58 representative command samples** spanning the OS and hardware categories plus **18 targeted command-path samples** identified classification gaps. Tests are only synthetic command strings; they do not run Docker, sudo, hardware, firmware, network mutation, or OS administrative commands.

**Paired device policy evidence** (read-only, 2026-10-18):
- VPS-ARM Main: Linux arm64, nine effective capabilities, including `docker`, `lxd`, `sudo-on-demand`, `systemctl`. Local Wall screenshot shows Full access, 9/9. Recent real job events were `outbound-leaf` even though device inspection had advertised local/Main; the preceding branch commit `ff66099` aligned source routing/policy view but has NOT been deployed production.
- HOMESV: Linux x64, effective `build-test/filesystem/git/lxd/package-manager/sudo-on-demand/systemctl/terminal`. **Docker is not in the effective policy**; a denial for a Docker-specific job on this device is therefore expected, not proof of a bug.
- Paired Windows desktop: effective `build-test/desktop/desktop-input/filesystem/git/package-manager/powershell/terminal/windows-eventlog/windows-process-network/windows-services`. Docker and privileged Registry/Firewall/Services-Admin/UAC/scheduled-task rights are NOT granted. The Windows adapter intentionally does not auto-advertise these highly privileged protected capability classes even if the script mentions them. Do not auto-grant them.

## Source findings and changes

1. **Standard absolute executables bypassed inference.** For example, Linux bare `sudo`, `systemctl`, `git`, `npm` were classified, but `/usr/bin/sudo`, `/usr/bin/systemctl`, `/usr/bin/git`, `/usr/local/bin/npm` were not; similarly Homebrew paths on macOS and `docker`/`lxc` paths. Centralized normalization of **standard executable directory prefixes for inference only** in `platform-adapters/shared.mjs`, plus explicit matching updates. It **only adds required capability checks** and leaves the executable script unmodified; it never downgrades, grants or circumvents an OS policy. Arbitrary custom binary paths and complex shell-generated commands still require a proper parser in future.
2. **Windows cmd required unrelated PowerShell capability.** The adapter previously always added `powershell`, even for `shell:'cmd'`. It now asks for `terminal` when explicitly executing through CMD, keeps PowerShell required for PowerShell/default, and preserves all command-specific protected requirements.
3. **Windows Registry syntax could miss `HKLM:\\`** because the regex expected a word boundary after the colon. Fixed recognition. Existing sensitive hive hard-denials remain. Reads of registry paths may now be classified with `windows-registry` (which is deliberately not advertised/granted by default); protected policy still applies, not a universal Full Access grant.
4. **Windows Firewall cmdlets** `Set-NetFirewallProfile`, `New-NetFirewallRule`, `Remove-NetFirewallRule` previously missed the `windows-defender-firewall` rule. Corrected the protected command-family match. The capability is still NOT automatically granted.
5. **Docker Compose CLI forms** `docker-compose` on macOS, `docker-compose.exe` on Windows now classify as Docker. Linux `apt-cache` now classifies as package-manager.
6. **Denied job lacked visible job-start activity.** `operator-host/executor.mjs` now emits a sanitized `job_admission_denied` event before throwing `target_node_capability_missing` or `local_host_capability_missing`, with exact route and approved missing capability names. `plugin-server/operator-adapter.mjs` preserves only validated reason codes and missing capability names in `recent_activity`. No secrets, script, command body, private keys or raw token is added to the event. This observability is only effective **after the corresponding release is deployed**; it cannot log model-side refusals before tool invocation. Isolated Operator test verifies a forbidden `sudo-on-demand` remains denied (HTTP 409), with the newly expected event.
7. **Hardware/network diagnostics lack dedicated classes.** Linux `lsusb`, `lspci`, `udevadm`, `ip`, `ethtool`, `nmcli`, `lsblk`, `smartctl`, `modinfo`, `dmesg`, `ufw`, `iptables`, `nft`; Windows `Get-PnpDevice`, `Get-CimInstance`, `pnputil`, `Get-Disk`; macOS `diskutil`, `ioreg`, `system_profiler`, `networksetup` generally infer the baseline filesystem/Powershell group only. **This is a coverage gap, not a confirmed undeserved denial.** Reading hardware diagnostics and flashing firmware are different operations: do not broadly grant raw-device/write access under a generic hardware flag without separate risk/authorization design.

## Refusal taxonomy to display to an operator

| Where denied | Signal | Interpretation / appropriate action |
| --- | --- | --- |
| Model or upstream tool safety before dispatch | No Light Remote job/admission event; the tool may not have been invoked | Cannot be fixed by local Full Access, client retries or PTY. Evaluate the requested operation under the host's safety requirements |
| Account A/B / session / plan | Unpaired device, invalid session or quota/connection error | Restore *the exact* authorized connection or adjust eligible account settings; no silent device substitution |
| Operator Main/Fleet admission | `target_node_capability_missing`, new `job_admission_denied` with `route:'outbound-leaf'` | Compare Fleet route approved capability and enrollment binding, not only Main's local policy |
| Operator integrated local admission | `local_host_capability_missing`, new admission event `route:'local'` | Inspect host effective capability and local policy |
| Leaf local final deny | Leaf result `local capability denied: <cap>`, status error, exit 126 | This is the final device-local policy boundary; not equivalent to missing OS binary |
| OS and hardware | Spawned job's actual exit code/stderr (`permission denied`, no device, TCC/UAC, Docker daemon) | Diagnose OS account, hardware connection or driver without conflating with policy. Owner review required for elevation |
| PTY | Terminal startup checks terminal authority; input is interactive | **Not a policy bypass.** Do not route a blocked exec into PTY or omit required capability declarations as a workaround |

## Test and deployment boundary

- New `platform-v2/test/light-remote-capability-command-matrix.test.mjs`: deterministic cross-platform path/command-family matrix, explicit CMD shell, protected Windows capability default-deny, and representative hardware read-only classification.
- Enhanced `deploy/scripts/selftest-v10-host-exec-capability-inference.mjs`: verifies denied command remains denied before spawn and the new sanitized denial audit event exists.
- Previous `selftest-v09-platform-adapters`, `selftest-v10-cross-platform-policy-shell-helper`, Gold Core, platform-v2, cutover safety and isolated Operator/Plugin smoke all pass as recorded in handoff.
- **This is a source-only change on a feature branch. No production binary or Main/Fleet routing policy was changed live.** No denied Docker command was reissued, no PTY/workaround attempt was performed, and no production service was restarted. After authorized release, verify end-to-end denial telemetry and consistency on each target. The independent Gold database cutover remains a separate unfinished project.
