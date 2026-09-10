# Platform Adapters v0.9

Updated: 2026-09-10
Status: v0.9 acceptance candidate / Windows + Device Policy + Linux live migration/signed rollback closed; production `main` remains v0.8
Acceptance branch: `codex/v0.9-device-policy-resume`
Device Policy closure: `DEVICE_POLICY_V0_9_ACCEPTANCE_2026-09-10.md`
Linux updater closure: `LINUX_SIGNED_UPDATE_V0_9_ACCEPTANCE_2026-09-10.md`

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

The AMD x86_64 live migration is complete. The one-time privileged transition installed the root-owned versioned package layout under `/opt/gpt-operator-agent/releases`, preserved enrollment/policy state, activated the signed-update timer, and moved the service to the dynamic `NoNewPrivileges` unit policy. Wall Policy revision 2 proved `sudo-on-demand` removal denies privileged execution with exit 126; revision 3 restored it and privileged `systemctl` execution passed.

## Windows adapter
Windows uses PowerShell when available and keeps the executor under the enrolled normal user. It does not use LocalSystem as the default execution identity.

Advertised/tested Windows capabilities include filesystem, PowerShell, Git, build-test, package-manager, Windows Services read, Event Log read, and process/network inspection. Protected mutation areas such as Registry administration, scheduled-task administration, service administration, Defender/Firewall changes, credential stores, sensitive SAM/SECURITY access, encoded/obfuscated PowerShell, and UAC escalation are not auto-advertised and are independently inferred/guarded at the leaf.
### Windows native persistence
Windows now ships as a self-contained .NET 8 WinForms tray client with bundled Node runtime and the enrolled device agent. Normal installation is per-user, does not require an elevated PowerShell window to remain open, starts with the user session, and keeps the outbound device connection alive while the main window is closed to tray.

The installer migrates the earlier Scheduled Task development lane, preserves device identity/private-key state, and includes signed-update verification plus rollback. The old Scheduled Task and optional Service approaches are retained only as historical migration context, not the current default distribution model.

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
Latest v0.9 preview deployment on `codex/v0.9-device-policy-resume` is READY with 12 Node functions, preserving the Hobby 12/12 function budget. The only build warning is the known project-setting mismatch: repo `engines.node=22.x` intentionally overrides the Vercel project setting of Node 24.x.

The preview guide must report `0.9.0-dev` and include this document before v0.9 is considered documentation-complete. Production `main` remains v0.8 even though the Linux live-migration gate is now closed; promotion is held for the owner-approved release gate.

## Device Policy live acceptance
Owner-controlled Device Policy is CLOSED on the acceptance branch. Live Windows proof removed `package-manager`, synchronized signed revision 2, and proved that `winget --version` was denied locally with exit 126 even though caller metadata omitted `package-manager`. Restoring the exact policy produced revision 3 and the same command returned `winget v1.29.290` with exit 0.

See `DEVICE_POLICY_V0_9_ACCEPTANCE_2026-09-10.md` for job IDs, audit attribution, migration evidence, deployment defects found during activation, and the closure assessment.

## Linux signed-update acceptance
The real AMD leaf accepted signed `0.9.0-rc.1` through the structured Wall `Run signed update now` path, restarted into `active/running`, and reported the new version. Live acceptance found and fixed two updater defects: symlink invocation previously skipped ESM `main()`, and a transient `is-active` check could accept a crash-looping release. The repaired updater requires a stable running MainPID before commit.

A signed/hash-valid `0.9.0-rc.2` fixture with a deliberately non-executable bundled Node runtime then failed after integrity verification and activation. The updater returned `update_failed:update_rollback:0.9.0-rc.2`, restored `current` to `0.9.0-rc.1`, and recovered the agent to a stable running service. Final ARM regression was 36/36 PASS; three fleet samples and repeated Windows acceptance remained clean. See `LINUX_SIGNED_UPDATE_V0_9_ACCEPTANCE_2026-09-10.md`.

## Deferred / open gates
- macOS platform adapter and distribution work: deferred.
- production promotion of v0.9: not yet approved.
- project-wide root license: owner decision required before a stable public release.
- stable `v0.9.0` tag: not cut.

## Acceptance exit rule
Linux live migration, Device Policy, Windows platform acceptance, and signed Linux update/rollback are closed on the v0.9 acceptance branch. Do not call v0.9 production-promoted until owner approval and the normal branch/release gate; `main` and stable tags remain unchanged.
