# LIGHT REMOTE — Linux sudo-on-demand works but host writes fail under ProtectSystem=strict
**Handoff / RCA for Linux client + Gold/RDC engineering — 2026-10-20 (Asia/Ho_Chi_Minh)**

## Outcome and precise status
- **VERIFIED ROOT CAUSE (systemd service configuration):** the installed HOMESV Linux Device Agent runs with `ProtectSystem=strict` and `ReadWritePaths=/home/ubuntu/.config/gpt-operator-agent`. Under its systemd mount namespace, the system root is read-only even when its child uses `sudo -n` and obtains uid 0. Both `light_remote_exec` and `light_remote_terminal` inherit this namespace. This is an **effective host-filesystem authorization / installation design mismatch**, **not** failed sudo credentials, a broken PTY, or an OpenAI pre-dispatch denial.
- **Sudo is functioning:** official Light Remote tool `sudo -n id -u` printed `0` in both exec and a live Bash PTY. The local Wall showed Full access/8 of 8 device-supported capabilities, and `inspect_device` reported effective `sudo-on-demand`, `systemctl`, `terminal`.
- **No fix deployed:** this document records evidence and a proposed implementation path; no service hardening changed, no namespace bypass, no gateway update on HOMESV. The Light Luna HTTPS gateway at 100.94.24.51:5278 remained running the *old* binary and browser still displayed `origin required`. Do not close the incident as resolved.
- **Priority: High / user-blocking.** Ordinary customer expected an authorized tool to execute a bounded, approved sudo workflow. Repeated manual owner-terminal instructions created avoidable friction.

## Reproduction — captured through OFFICIAL Light Remote on exact authorized HOMESV
Device: `homesv` Linux x64, NetBird address `100.94.24.51`; owner explicitly authorized target with A/B pairing; normal official plugin tools. Do not silently substitute VPS-ARM or the Gold UAT target.

1. `light_remote_exec` with `requiredCapabilities=["sudo-on-demand","systemctl"]`:
   - `sudo -n id -u` → stdout `0` (root elevation works).
   - `findmnt -T /etc -no OPTIONS` → `ro,relatime,discard,errors=remount-ro,commit=30`.
   - `sudo -n bash /home/ubuntu/n8n2erpnext/light-luna/tools/lan-netbird-gateway/upgrade-host.sh` → exit **3**, stderr: `Host-system mount is not writable in this session. No changes made.`.
   - Existing gateway service `light-luna-web-gateway.service` stays active; binary at `/usr/local/libexec/light-luna-web-gateway` remains unchanged.
2. `light_remote_terminal` opened a genuine `bash` PTY. `tty` → `/dev/pts/1`; `sudo -n id -u` → `0`; `findmnt -T /etc -no OPTIONS` → **ro**. Sending the exact same `sudo -n bash .../upgrade-host.sh` via `light_remote_terminal_input` → exit **3**, same message. PTY did not change the mount restriction. A first explicit `shell="/bin/bash"` terminal start returned `linux_shell_unavailable:/bin/bash`; normal default `bash` terminal start succeeded (distinct, minor terminal-selection issue; not reason for host-writes failure).
3. Host PID 1 mount evidence: `/proc/1/mountinfo` includes root `/dev/sda1 ... / rw ... ext4 /dev/sda1 rw,...` while the agent's child sees `/` ro. Prior `tune2fs`/ext4 counters were clean/zero. Hence this is not evidence of a damaged or physically read-only disk; the mount **namespace** differs.
4. Actual HOMESV installed unit (read-only `systemctl show/cat gpt-operator-device-agent.service`):
   - `ActiveState=active`, `FragmentPath=/etc/systemd/system/gpt-operator-device-agent.service`
   - `User=ubuntu`
   - `ExecStart=/opt/gpt-operator-agent/current/runtime/node /opt/gpt-operator-agent/current/device-agent/operator-agent.mjs daemon`
   - **`ProtectSystem=strict`**
   - **`ReadWritePaths=/home/ubuntu/.config/gpt-operator-agent`**
   - `NoNewPrivileges=false`, `RestrictSUIDSGID=false`, `PrivateTmp=yes`.
   These observations establish the config problem independently of the application script.
5. Concrete blocked business operation: Light Luna was already serving a real login page through LXD; gateway login POST was failing. New gateway binary built and 12 regression cases passed but copying it into `/usr/local/libexec` and restarting the host systemd unit from the Device Agent was impossible in this mount namespace. The owner subsequently executed the installer/upgrader from an ordinary host SSH terminal (separate namespace), proving this is not a device-global permission to write. Installer first failed due to a readiness race, then was fixed in Light Luna source; that issue is **separate** from the Light Remote filesystem bug.
6. Security note: a local OBSERVE login code appeared in a user screenshot in the Light Luna troubleshooting sequence. Never repeat or store the code in this handoff; rotate separately using product-verified procedure.

## Why this happens — supported by source audit on VPS-ARM
Canonical Light Remote source: `/home/ubuntu/n8n2erpnext/light-remote-mcp-main` (alias `/home/ubuntu/light-remote-dev`). Gold worktree: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/light-remote-gold-rebuild-20261018`.

**Exact relevant code:**
- `client/linux/install.sh` (approx. lines 312–365) emits `gpt-operator-device-agent.service` with **`ProtectSystem=strict`** and ONLY `ReadWritePaths=$TARGET_HOME/.config/gpt-operator-agent`. This is the packaged Linux installer and matches the installed host unit.
- `device-agent/install-linux-service.sh` (approx. lines 37–59) also emits `ProtectSystem=strict` and ONLY `ReadWritePaths=$HOME_DIR/.config/gpt-operator-agent`. Keep both paths consistent.
- `device-agent/linux-service-policy.mjs` makes `NoNewPrivileges`, `RestrictSUIDSGID`, and capability bounding conditional on `grantableCapabilities` containing `sudo-on-demand`, but does **not** alter the mount filesystem policy. Consequently, root UID is obtainable while host-wide filesystem mutations still fail.
- `device-agent/local-wall.mjs` defines `sudo-on-demand` as "Allow explicit sudo workflows when needed. Light Remote itself still does not run directly as root." The Wall's Full access means all *capabilities*, not unrestricted filesystem mounts.
- `deploy/scripts/selftest-device-agent-service.mjs` explicitly asserts `ProtectSystem=strict` + single `ReadWritePaths` and treats profile-controlled sudo as PASS; `deploy/scripts/selftest-v09-linux-service-policy.mjs` tests flags, not a real host-system write. These tests presently do NOT detect this mismatch.
- Gold worktree has the same two unit-file source settings. Source evidence confirms a systematic Linux client packaging defect, not a transient wrong profile toggle.

## Suggested engineering fix (design, not implemented)
**Do not simply disable all systemd sandboxing globally. Do not use a PTY, `nsenter`, a manual remount, or hidden command rephrasing as the product's privilege model.**

Implement an **explicit audited host-maintenance execution path**, separate from the normal nonroot read-mostly Agent, that:
1. Keeps the permanent device-agent service hardened with `ProtectSystem=strict`. Normal exec/PTY may remain read-mostly and should accurately report mount-limited permissions.
2. Adds a narrowly scoped **privileged host-operation broker** / native host helper launched/installed by the authorized installer, with per-operation consent plus local Wall policy check, server-approved scoped capability check, signed session/job identity, bounded path/command arguments and finite lifetime. It must run in an intentionally provisioned environment that can write ONLY explicitly authorized host resources; a generic unconfined root shell is **not** the default.
3. Product should distinguish clearly: **`sudo-on-demand` permits elevation** from **`host-system-write` permits specified filesystem/service mutations**. Either extend the existing capability/operation contract with independently gated scope, or name the privileged execution mode explicitly; do not silently reinterpret the Wall's "Full access" as unlimited host root.
4. For each supported workload (`systemctl` + executable installation, package installation, approved config update), perform preflight of effective systemd `ProtectSystem` / `ReadWritePaths` and requested write destination; return a specific `HOST_MOUNT_READ_ONLY_BY_AGENT_SANDBOX` class if unavailable, instead of suggesting sudo retries or misclassifying as model safety denial.
5. Support explicit rollback/audit and least-privilege privileges. Avoid copying private credentials to logs/UI. Normalize behavior on packaged Linux client (AMD64/ARM64), DEV installs, and retained previous-version upgrades. Preserve compatible behavior for devices where local owner denied sudo.
6. UI/AI guidance must say why an approved operation is denied and what **official authorized** setup is required. PTY and exec must have consistent documented privilege boundaries, rather than implying PTY offers special root filesystem access.
7. If an installer-controlled `ReadWritePaths` expansion is chosen as a *temporary scoped fix*, require an owner-approved exact path allowlist and service reload lifecycle, verify the effect live, and document that persistent root-writable `/` defeats `ProtectSystem=strict` for the Agent. Do not casually add `ReadWritePaths=/` or turn off hardening for everyone.

## Reproduction/acceptance contract for engineering
- Capture `systemctl show gpt-operator-device-agent.service -p ProtectSystem -p ReadWritePaths -p NoNewPrivileges -p RestrictSUIDSGID`, `findmnt -T /etc`, `sudo -n id -u`, host PID1 `/proc/1/mountinfo`, and trace mount namespace identity. Collect effective capabilities and local Wall policy revision, not credentials.
- Negative (default): user without host-mutation authorization **cannot** write restricted system paths even if they can run benign PTY commands, and no fallback bypass occurs.
- Positive (explicitly authorized): run a scoped host-operation fixture that installs a *harmless temporary* system-owned file/service under an isolated test directory, checks SHA256/ownership, validates `systemctl`, and removes via an authorized rollback. Test on an expendable Linux VM/LXD with host-managed namespace, **not** HOMESV production firewall/network or a root LXD guest.
- Verify `light_remote_exec` / `light_remote_terminal` behavior, return codes, local Wall job audit, session hold/resume, and that permitted `sudo-on-demand` stays functional. Ensure no global writable mount leakage or root proxy usable from untrusted non-admin work.
- Tests must be updated in both `selftest-device-agent-service.mjs` and `selftest-v09-linux-service-policy.mjs`, and include one true systemd/container runtime acceptance. Static string-based checks alone cannot prove host-mutation capability.
- Only after tests and owner review: staged build/update on separate canary, then optional HOMESV rollout with explicit Owner approval. Do NOT silently upgrade/restart official production clients.
- Important: OpenAI pre-dispatch denials across MCP tool families (Gold/RDC G1) are a **different** issue. This report concerns a command **successfully dispatched and executed** with a deterministic filesystem refusal.

## Links / handoff scope
- Source Gold: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/light-remote-gold-rebuild-20261018/`
- Current Gold/RDC checkpoint: `docs/optimization/RDC_HANDOFF_CURRENT.md`.
- Prior wide-scope refused tool RCA: `docs/optimization/RDC_GOLD_G1_ALL_TOOL_PREDISPATCH_RCA_20261019.md`.
- Original Light Luna gateway source/checkpoint on HOMESV: `/home/ubuntu/n8n2erpnext/light-luna/tools/lan-netbird-gateway/` and `HANDOFF_CURRENT.md`.
- **This handoff is documentation only: no code fix, no deployment, no commit, no updated host systemd policy.**
