# Platform Adapters v0.9

Updated: 2026-09-10
Status: preview / live Windows acceptance; production `main` remains v0.8
Branch: `codex/v0.9-platform-adapters`
Current branch checkpoint: `4a584ffd7886a37ea7f535429d4373c1c85d3af5`
Production main checkpoint: `4fe9d15e311542a31882303d61a37174554d1e03`

## Scope
v0.9 does not replace the v0.8 fleet protocol. It keeps the same enrolled Ed25519 device identity, outbound signed `poll/result` channel, explicit target binding, per-node session ceilings, command lease/redelivery, idempotent receipts, and Wall/audit attribution.

The v0.9 change is at the leaf execution boundary: one protocol, platform-specific execution adapters. The leaf chooses the adapter from `process.platform`, discovers platform capabilities, re-infers required capabilities from the script, applies the device-local deny boundary, and only then spawns the native shell/process.

Authority remains:
`owner approval -> Hub capability check -> device adapter inference -> device-local deny -> executor`

Caller-supplied `requiredCapabilities` are advisory/minimum metadata only. They cannot suppress a capability that the device independently infers from the script.

## Adapter modules
- `device-agent/platform-adapters/index.mjs`
- `device-agent/platform-adapters/shared.mjs`
- `device-agent/platform-adapters/linux.mjs`
- `device-agent/platform-adapters/windows.mjs`

macOS adapter work is intentionally deferred by product-owner decision and is not part of the current acceptance checkpoint.
## Linux adapter
Linux remains the primary server adapter. It uses `/bin/bash -lc` and covers filesystem, Git, build/test tools, Docker, LXD, systemd/journalctl, package managers, and sudo-on-demand.

v0.9 adds device-side script inference. A Hub request declaring only `filesystem` cannot hide a `git`, `docker`, `systemctl`, package-manager, build-tool, or `sudo` requirement from the leaf.

A live AMD migration exposed a real hardening contradiction: the v0.8 installed unit had `NoNewPrivileges=true`, so an owner-approved `sudo-on-demand` capability could never actually call sudo. The v0.9 installer now derives the unit policy from effective local capability state through `device-agent/linux-service-policy.mjs`:

- no effective `sudo-on-demand` -> `NoNewPrivileges=true`
- owner-approved `sudo-on-demand` and not locally denied -> `NoNewPrivileges=false`
- local deny of `sudo-on-demand` -> `NoNewPrivileges=true`

All other systemd hardening remains in place, including normal-user execution, `ProtectSystem=strict`, bounded writable state path, empty capability bounding/ambient sets, kernel/control-group protections, `PrivateTmp`, `UMask=0077`, and restart policy.

The AMD x86_64 repo was switched cleanly from v0.8 to v0.9 source and the complete `selftest-*` suite passed with `AMD_V09_SELFTEST_FAILS=0`. The currently running legacy v0.8 AMD service could not self-install the policy fix because its inherited `NoNewPrivileges=true` blocks sudo before the new unit can be written. This is a one-time live migration blocker requiring an external privileged maintenance lane; it is not being bypassed from inside the constrained service.

## Windows adapter
Windows uses PowerShell when available and keeps the executor under the enrolled normal user. It does not use LocalSystem as the default execution identity.

Advertised/tested Windows capabilities include filesystem, PowerShell, Git, build-test, package-manager, Windows Services read, Event Log read, and process/network inspection. Protected mutation areas such as Registry administration, scheduled-task administration, service administration, Defender/Firewall changes, credential stores, sensitive SAM/SECURITY access, encoded/obfuscated PowerShell, and UAC escalation are not auto-advertised and are independently inferred/guarded at the leaf.
### Windows DEV persistence
The first Service-based developer install correctly failed on a blank-password local account with SCM Event 7038 even after `SeServiceLogonRight` was granted. The product does not weaken the machine-wide Windows policy to allow blank-password service logon.

Windows DEV mode therefore uses a per-user Scheduled Task with:
- `LogonType=Interactive`
- `RunLevel=Limited`
- no stored account password or PIN
- automatic start at user logon plus immediate start after install
- the enrolled user's local state/private key unchanged
- cleanup of the failed legacy service before task registration

GitHub Actions validates the Windows bundle on `windows-latest` / Windows Server 2025 with Node 22.23.2, adapter smoke tests, PowerShell parser checks, pinned WinSW SHA256, LSA service-right helper coverage, real Task Scheduler `Interactive/Limited` registration, bundled-runtime smoke test, and artifact assembly.

Password-backed Windows accounts may still use the optional Service installer. That lane runs with an explicit user `PSCredential`; it does not write the password into WinSW XML and does not default to LocalSystem.

## Live Windows acceptance
A real enrolled Windows x64 desktop completed end-to-end execution through the unchanged production route:
`public Vercel production -> ARM Hub -> outbound Windows v0.9 leaf`

Seven harmless/read-only execution probes covered every currently advertised Windows capability:
- host/architecture/PowerShell: X64, Windows PowerShell 5.1
- filesystem: create/read/delete a temporary proof file
- Git/build: Git 2.54.x and bundled Node x64
- process/network: `Get-Process` + `Get-NetTCPConnection`
- Services: `Get-Service` read-only
- Event Log: `Get-WinEvent` read-only
- package manager: `winget v1.29.290`

No Registry, firewall, credentials, UAC, task mutation, service mutation, or other protected capability was exercised.
Wall/audit attribution after the Windows acceptance showed the Windows node online with zero active sessions and 12 successful `job_finished` records / 36 related `job_started|stdout|job_finished` events across the repeated proof rounds. Production Vercel traffic for the final 30-minute acceptance window was 121 HTTP 200 responses with no warning/error/fatal runtime logs.

The Windows task also demonstrated recovery behavior: after the interactive PowerShell host was accidentally closed, Task Scheduler restarted the agent and the Hub observed the node return online without re-enrollment.

## Vercel preview
Latest v0.9 preview deployment for checkpoint `4a584ff` is READY with 12 Node functions, preserving the Hobby 12/12 function budget. The only build warning is the known project-setting mismatch: repo `engines.node=22.x` intentionally overrides the Vercel project setting of Node 24.x.

The preview guide must report `0.9.0-dev` and include this document before v0.9 is considered documentation-complete. Production `main` remains v0.8 until the remaining live migration gate is resolved.

## Deferred / open gates
- macOS platform adapter and distribution work: deferred.
- AMD Linux live service migration to the new dynamic `NoNewPrivileges` policy: pending an external privileged maintenance lane because the legacy constrained service cannot relax its own NNP bit.
- production promotion of v0.9: not yet approved.
- stable `v0.9.0` tag: not cut.

## Acceptance exit rule
Do not call v0.9 production-accepted until the Linux live migration is completed and the final branch preview/full regression remains green. Windows platform acceptance itself is complete for the current DEV persistence model.
