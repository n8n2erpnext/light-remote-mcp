# Gold capability catalog and infrastructure rights — 2026-10-22

**Scope:** Gold-only additive correction on `fix/docker-capability-refresh-20261022`; **M plan HOLD**. No deployment, no M6 cutover, no worker/claim cleanup, no production edits.

## Root cause & corrected model

A capability is owner authorization for a class of operations, **not evidence that an executable currently exists**. The earlier Docker fix still incorrectly treated a missing command as loss of grantable permission. Corrected by separating:
- `discoverCapabilities()` = a stable OS-specific capability *catalog* for enrollment, Operator grant ceiling, and Local Wall toggles.
- `installedCapabilities()` = current read-only executable presence inventory shown by Local Wall. It is diagnostic only. Installing/uninstalling packages does **not** change permissions.
- `approvedCapabilities` = account-owner approval on Operator; `deniedCapabilities` = local owner restrictions. Effective leaf permission remains the intersection. On a trusted Main host, local owner denies remain final.

The signed `capabilities-refresh` endpoint now submits the supported catalog rather than installed binaries. Older enrollments can acquire new grantable entries **without reinstall or key rotation**, but new permissions remain server-unapproved and locally denied until the owner explicitly enables them.

## Infrastructure catalog

Linux: Docker, LXD/LXC, Podman, Incus, Kubernetes, K3s/Helm, VM/hypervisor (virsh/QEMU/Proxmox CLI), network administration (ip/nmcli/netplan/wg), firewall (nft/iptables/ufw/firewall-cmd), storage (LVM/ZFS/mount), infrastructure-as-code (Terraform/OpenTofu/Ansible/Pulumi), package managers (APT/Snap/DNF/etc.), services, sudo and original developer capabilities.

macOS/Windows: stable OS-specific catalogs for Docker, Kubernetes, virtualization, network, storage, infrastructure-as-code, package manager and OS-native existing admin rights. Existing platform hard-denies remain unchanged.

Local Wall presents all OS-supported controls plus **Installed / Not installed** evidence. Not installed is never interpreted as permission denied. New capabilities on trusted Main devices are explicitly locally denied on upgrades; a missing/corrupt Main local-policy file fails closed.

## Scoped infrastructure bootstrap

Precisely matched, single-command installation of supported runtimes may be governed by the corresponding already-approved runtime capability even when the package manager/sudo *capabilities* are off, e.g. `sudo apt-get install -y lxd`, `sudo -n snap install lxd --classic`, `sudo apt-get install -y docker.io`, or appropriate macOS brew / Windows winget forms.

This is **not a general package-manager or root grant**. Additional packages, unexpected options, multiple commands, expansions, shell chaining or script pipelines do not qualify; the general `package-manager` and `sudo-on-demand` permissions apply as before. The OS must still allow execution (sudo privileges, writable paths, proper package availability). No arbitrary installation or privilege escalation is performed by the rescan itself.

**Linux privilege boundary:** the systemd sandbox no longer relaxes `NoNewPrivileges` just because the OS capability catalog contains sudo. Leaf requires server-approved sudo; trusted Main requires owner local ON. Changes requiring systemd unit sandbox alterations require an approved helper/service restart, not an automatic grant. `ProtectSystem=strict` still makes large host paths read-only, so package installs modifying `/usr` or `/etc` need a separately approved installer-level mechanism. This code patch fixes Light Remote authorization and command classification, not a generic root installer.

## Main/leaf behavior

- Leaf: Account/Fleet owner approval and Local Wall owner permission are independent. A local ON cannot bypass missing server approval. If the product should allow Wall alone to grant an initially server-unapproved permission, it requires a verified account-owner authorization transaction; **never** accept just device-signed auto-escalation.
- Main: `ensureHostCompanionState` adds any new catalog rights to the local deny list on upgrade. `hostEffectiveCapabilities` fails closed if the local policy file is missing/invalid.

## Evidence

- `node deploy/scripts/selftest-infra-capability-catalog.mjs`: missing binaries vs supported rights, exact LXD/Docker bootstrap, arbitrary package/chained-command denies, Linux/Mac/Windows catalog, Operator/Agent inference parity, Main fail-closed on new rights, preserved owner approval on missing tools.
- `node deploy/scripts/selftest-docker-capability-refresh.mjs`: original signed policy owner approval/rescan contract.
- Existing enrollment and Linux service-name/status boundary regressions.

## Rollout

Keep all changes in the Gold fix branch pending review. Do not merge automatically into Gold M plan, do not deploy UAT/production, and do not change device enrollment or software installed on HOMESV now. Later Gold UAT checks must verify signed PG-backed policy write→read→restart→read and live local/remote owner UI behavior, including actual OS rights and Docker/LXD binary/socket access.

## Status

Code-only patch and focused tests; no runtime Gold deployment. M plan HOLD.


## Permission Wall grouped UX (Gold code-only, 2026-10-22)

Owner requirement: **all device actions must be available when explicitly granted; installed executable inventory must not decide authorization**. Native OS restrictions still apply. To preserve clarity as catalog grows, Local Wall /permissions uses an eight-group accordion with local Material SVG icons and no Google CDN:

1. **Files & Development** — filesystem, Git, builds and non-interactive Windows shells.
2. **PTY / Interactive Terminal** — only `terminal`, an explicit independent ON/OFF. PTY input is an unrestricted interactive shell under the host service account; per-command capability inference cannot reliably inspect shell input.
3. **Desktop & Real Remote** — `desktop` for screen view and `desktop-input` for real mouse/keyboard control; separate toggles and separate local decisions.
4. **Containers & Virtualization** — Docker, LXD, Podman, Incus, Kubernetes and VMs.
5. **System & Packages** — systemd/launchd/Windows services, package managers, sudo/UAC, scheduled tasks.
6. **Network & Firewall** — network changes, firewalls, Windows process/network inspection.
7. **Storage & Provisioning** — storage and infrastructure-as-code.
8. **OS Security & Logs** — OS-native registry, credentials and logs.

Any capability introduced by a later OS adapter is displayed exactly once under **Additional OS capabilities**, rather than silently omitted. Groups exist only if supported by the current platform. Each accordion header has an ON/OFF group switch; mixed children show indeterminate state and local/effective counts. Expand to access individual controls and status chips. A server-unapproved permission is shown as **Server approval needed**, never silently treated as effective. Availability ("Tool detected" / "Tool not detected") is read-only diagnostic metadata, not a permission decision.

Existing profiles **Safe**, **Developer**, **Infra / Ops**, **Full access**, **Custom** remain. New **Remote Support** selects screen view/input and basic inspection without PTY. Profiles are selection shortcuts; selecting and saving produces the same `allowedCapabilities` and `profile` payload through the existing Local Wall `POST /api/permissions` endpoint. No storage schema change; user policies are preserved.

Linux command classification additionally exempts only strict one-command read-only `ip addr`, `ip route show`, `nmcli device status`, `netplan get`, `lsblk`, `nft list ruleset`, `ufw status`, `wg show` and `zpool status` forms from their *administration* capability. Composite or modifying shell commands are still classified with the appropriate administrative rights. This classification is shared by Operator preflight and Agent execution. The OS itself may still deny the read.

### Verification

- `node deploy/scripts/selftest-gold-permission-groups.mjs`: actual Chromium Local Wall owner authentication, group ON/OFF, PTY independent of RM input, Remote Support profile persistence, account approval ceiling, no duplicate capabilities, fallback for future capabilities; client catalog completeness across Linux, macOS and Windows.
- `node deploy/scripts/selftest-infra-capability-catalog.mjs`: infrastructure rights independent of installed software plus read-only diagnostics vs modifications, Operator/Agent consistency.
- `node deploy/scripts/selftest-docker-capability-refresh.mjs`: signed rescan/owner policy contract.
- No deployment to HOME SV, Gold UAT or production. M plan is **HOLD**.
