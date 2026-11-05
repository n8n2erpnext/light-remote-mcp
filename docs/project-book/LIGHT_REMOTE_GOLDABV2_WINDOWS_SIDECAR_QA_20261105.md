# GoldABV2 Desktop V4 T05B — Isolated Windows Agent Sidecar QA

Date: 2026-11-05 Asia/Ho_Chi_Minh.
**Status: Source and safety checks PASS; Windows GitHub package CI pending; real Owner B-grant E2E NOT TESTED.**

## Why
The installed Windows old Gold client is online and occupies localhost 5491 (Wall) and 5492 (Fleet/API). Desktop V4 Owner Login points to GoldABV2 HTTPS, but this installed Agent still points to older Gold HTTPS; it is NOT proof of a GoldABV2 same-host A/B V2 grant. User wants native Desktop approval without browser Wall. Do not stop, replace or relink the old Agent. The Linux LXD NetBird NAT Wall 100.94.184.141:15591 is unrelated to Windows Desktop.

## Proposed QA bundle — no installer / no schedule / no production changes
Built ONLY from Gold source branch feat/goldabv2-desktop-owner-lab-20261103 and 129-file client/core-files.json, with its own Node 22 Windows runtime and npm dependencies, as an unsigned standalone ZIP.
- deploy/windows-goldabv2-v4-qa/Invoke-GoldABV2-V4-QA.ps1: manual only; actions check, status, login, poll, daemon. Each invocation spawns its OWN Node child with scoped environment variables.
- Exact GoldABV2 HTTPS Operator/Account Portal for hub and base.
- Dedicated QA data files under the extracted bundle's state directory, not installed Agent state: device.json, wall-auth.json, commands, update-runtime. All supporting Gold Long Memory database paths derive from state directory.
- QA Wall localhost 5591, QA Fleet 5592; these were unoccupied on the real Windows 10 host when checked 2026-11-05. Old Gold 5491 and 5492 remain occupied.
- The ONLY Desktop API for test is same-host Windows named pipe light-remote-desktop-v4-abv2. The Desktop Open Wall button still points to 5491 (old Gold) during coexistence QA, so the user must visit 5591 manually for QA Wall setup. This temporary port split is NOT release architecture; when released with one Agent its default Wall is still localhost 5491.
- A NEW GoldABV2 enrollment must be explicitly Owner-approved (login, poll). No copy/reuse of installed Gold identity, state or certificates. After enrollment, manual daemon exposes private IPC by LR_GOLD_ABV2_DESKTOP_ABV2_NATIVE_V4=1, with exact enrolled account and verified Owner Bearer; B approval remains signed by Agent at Operator.
- If QA ports are occupied, launcher fails closed; no task/service registration. Ctrl+C stops foreground QA daemon. No scheduled automatic Windows background process.

## Source and CI
- .github/workflows/goldabv2-desktop-v4-windows-agent-qa.yml — isolated Windows runner packages exact files, installs Windows native Node deps into QA Agent, verifies manifest, tests actual Windows named-pipe pending and grant with a mock trusted Operator, smokes launcher's check/status without enrollment, uploads unsigned zip and SHA256 manifest. It never installs a client in the GitHub runner or the owner's machine.
- device-agent/desktop-abv2-native-ipc-v4.test.mjs — 4 tests; Unix mode 0600 test on Unix; Windows now runs the actual fixed named-pipe test with mock Owner and revoked enrollment denial (not a skip).
- deploy/scripts/selftest-goldabv2-v4-windows-qa-sidecar.mjs — asserts correct GoldABV2 origin, two distinct QA ports, independent state, no installer/Service/Task or Gold-old mutations.
- Source checks on VPS-ARM: Node native IPC 4/4 PASS, sidecar contract PASS, workflow YAML parses.
- Real Windows 10 PowerShell 5.1 parser: launcher PASS (read-only SSH inspection), ProcessStartInfo environment supported, port scan read-only shows 5491/5492 in use and 5591/5592 free.
- GitHub package artifact and actual Windows native IPC CI: PENDING at this handoff. No separate Agent running on Windows yet.

## Remaining action after CI
1. Download and verify the QA ZIP SHA256 from GitHub CI. Stage in a separate temporary folder only (do NOT install or overwrite old Gold).
2. Manual -Action check and login in GoldABV2 account. The Owner explicitly approves new device enrollment in Account Portal, then -Action poll.
3. Start QA daemon with its own 5591/5592 and native IPC, then open Desktop V4 Owner Login LAB and AI Access for the same Owner account. A signed pending request may require backend device/account allowlist updates scoped ONLY to this new QA device, not a blanket bypass.
4. Check pending shortId / A, enter B, prove Operator returned a durable grant and per-Agent lease. Try stale attempt and revoked Owner denial.
5. Cleanup QA daemon and state after acceptance; keep old Gold runtime unchanged. Complete App/Wall SSO both directions under T04 separately.

Never call source unit PASS or the new unsigned ZIP a real A/B V2 Windows E2E PASS.
