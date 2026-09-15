# Light Remote v0.10 — SSH-class Dev + Infra Operator Plan

Date: 2026-09-15
Status: active implementation plan
Branch: codex/v0.9-device-policy-resume
Baseline: 03a2b58a24c9d7e1f2c0e90ff7d5925cd194530e

## 1. Goal

Light Remote must support both software-development and infrastructure/operations work closely enough to replace the normal AI-agent use of SSH/RDC while preserving the product's stronger device/session/policy isolation.

This is not a shell-only design. The operating model is:

1. structured tools first;
2. PTY/terminal as the universal fallback;
3. local device policy remains the final deny boundary;
4. no silent target fallback;
5. one device connection may carry many isolated Agent sessions;
6. Tool Helper is the canonical post-pair onboarding contract and must evolve with every phase.

## 2. Cross-platform terminal contract

### Linux
- interactive PTY terminal
- bash, zsh and sh when present
- current-user execution by default
- sudo remains a separately governed capability / OS privilege boundary

### Windows
- interactive terminal with two explicit first-class shell modes:
  - PowerShell / pwsh
  - CMD / cmd.exe
- Windows Service/Event Log/network/admin capabilities stay separately governed
- UAC elevation is never implied by opening a terminal

### macOS
- interactive PTY terminal
- zsh/default login shell, plus bash when available
- launchd, unified log and sudo stay separately governed

### PTY security rule

Raw PTY input cannot safely preserve the command-by-command capability inference used by one-shot `exec`. Therefore `terminal` is an explicit elevated capability. Structured infra tools retain granular capabilities. Opening a PTY never automatically grants sudo/UAC/root.

## 3. Phase 0 — Policy profile + shell contract normalization (P0)

Must land before native PTY.

### 3.1 Policy audit findings
- server `policyProfile` is currently a signed label; enforcement is `grantable ∩ approved ∩ reported` plus device-local denies;
- Local Wall profiles `safe/developer/full` are Linux-centric;
- Windows `Developer` may drop PowerShell/Windows capabilities;
- macOS `Developer` currently omits launchd/log/sudo capabilities;
- several Windows inferred elevated capabilities are not fully discovered or described in policy UI;
- `Full` correctly means all grantable capabilities but Safe/Developer need platform-aware semantics.

### 3.2 Required profile semantics
Profiles are templates over the device's actual `grantableCapabilities`; they never invent unsupported capabilities.

- `safe`: normal file/dev/read-observability work, no package/service mutation, no sudo/UAC, no tunnel;
- `developer`: safe + build/runtime/container development and standard terminal shells; still no privileged system mutation by default;
- `infra`: developer + service/log/network/container administration; privilege elevation remains separately toggleable;
- `full`: all device-grantable capabilities;
- `custom`: exact owner selection.

Each profile must be platform aware for Linux, Windows and macOS.

### 3.3 Shell selectors
Add a bounded `shell` field to exec/process/terminal contracts.

Canonical shell IDs:
- Linux: `default`, `bash`, `zsh`, `sh`
- Windows: `default`, `powershell`, `cmd`
- macOS: `default`, `zsh`, `bash`, `sh`

The platform adapter resolves the ID; arbitrary executable paths are not accepted through this selector.

### 3.4 Tool Helper
Tool Helper must expose:
- target OS/architecture/session context;
- discovered shell modes;
- effective/grantable capabilities when available;
- structured-first selection rules;
- explicit warning that PTY is broader than command-inferred exec;
- platform-specific examples without requiring repository inspection.

## 4. Phase 1 — Native PTY / Terminal (P0)

New actions:
- `terminal-start`
- `terminal-input`
- `terminal-output`
- `terminal-resize`
- `terminal-signal`
- `terminal-list`
- `terminal-stop`

Requirements:
- real PTY semantics on Linux/macOS;
- ConPTY-compatible semantics on supported Windows;
- terminal size rows/cols + resize;
- incremental byte offsets and bounded ring buffer;
- Ctrl-C / SIGINT, TERM/KILL where platform supports them;
- ownership bound to account/device/session/agent;
- terminal lifecycle survives individual Vercel request lifetime;
- no credential/private-key echo in helper or Wall;
- audit records start/stop/signal/resize and redacted metadata, not secret terminal contents by default.

Acceptance:
- Linux: bash/zsh interactive, `top`/`less` class TTY behavior, resize, Ctrl-C;
- Windows: PowerShell and CMD interactive lanes, resize and Ctrl-C equivalent;
- macOS: zsh interactive, resize, Ctrl-C;
- cross-agent ownership mismatch must fail closed.

## 5. Phase 2 — Large-file Light SCP (P0)

Current direct SCP semantics are accepted, but Plus GET payload is unsuitable for real large binary chunks.

Requirements:
- keep `scp` as the user-facing file API;
- add a POST/binary or durable chunk transport under it;
- no file bytes in URL query;
- transfer state must survive separate Vercel invocations;
- resumable chunks + whole-file and per-chunk SHA-256;
- device file -> chat runtime attachment and chat attachment -> device recipes;
- Agent never regenerates binary from textual/base64 output;
- support practical multi-MB/GB transfer bounds with configured quotas.

Acceptance: 1 MB, 32 MB and interrupted/resumed transfer, exact SHA match.

## 6. Phase 3 — Structured Service + Logs (P1)

### Linux
- systemd: status/start/stop/restart/reload/enable/disable
- journal: query/tail/follow/filter by unit/priority/time

### Windows
- Windows Service: query/start/stop/restart/config where policy permits
- Event Log: query/follow/filter

### macOS
- launchd: list/status/kickstart/stop/enable/disable where valid
- unified log: show/stream/filter

Tool Helper must prefer these over terminal/exec.

## 7. Phase 4 — Structured Network + Socket (P1)

Cross-platform normalized model:
- interfaces/addresses
- routes/default gateway
- DNS/resolvers
- listeners and active connections
- PID/process mapping where OS allows
- firewall read state; mutation separately elevated
- namespace/container network context when supported

Linux adapters use native/iproute/system sources; Windows maps to Get-Net*/netstat APIs; macOS maps to ifconfig/route/scutil/lsof/netstat equivalents.

## 8. Phase 5 — Structured Container (P1)

Providers discovered per device:
- Docker
- Podman
- LXD/LXC

Operations:
- list/inspect/stats
- logs/follow
- exec
- start/stop/restart
- images/basic lifecycle when policy permits

Mutating/destructive operations must remain capability and policy gated.

## 9. Phase 6 — Tunnel / Port Forwarding (P1/P2)

Goal: SSH-class local/remote forwarding without exposing the executor publicly.

- local forward equivalent (`-L` class)
- remote forward equivalent (`-R` class) only with explicit policy
- optional SOCKS later, not first release
- exact destination allow/deny controls
- connection/session ownership
- TTL, byte counters, idle timeout and audit
- no wildcard public bind by default

## 10. Filesystem + process completion work

Extend structured fs/process where needed:
- chmod / mode
- chown where policy permits
- symlink / readlink
- timestamps/stat metadata
- process signal selection, process tree and children
- avoid duplicating shell commands where structured semantics are safer.

## 11. Policy capability families

Target capability vocabulary (existing names retained for compatibility where possible):

Common:
- filesystem
- git
- build-test
- package-manager
- terminal
- container-observe
- container-manage
- network-observe
- network-manage
- tunnel

Linux:
- docker
- lxd
- systemctl
- sudo-on-demand

Windows:
- powershell (legacy non-PTY Windows shell authority; covers PowerShell/CMD shell selector until `terminal` lands)
- windows-services
- windows-services-admin
- windows-eventlog
- windows-process-network
- windows-registry
- windows-scheduled-tasks
- windows-defender-firewall
- windows-credential-manager
- windows-uac-admin

macOS:
- macos-services
- macos-log
- sudo-on-demand

`cmd` is a shell mode, not a standalone privilege capability. New capability aliases/families must not silently broaden an existing approved policy. Migrations are deny-safe.

## 12. Tool Helper evolution rule

Every new runtime tool is incomplete until Tool Helper teaches it.

For each phase Tool Helper must include:
- action names;
- exact payload schema;
- when to prefer it;
- platform availability;
- capability/policy requirements;
- lifecycle/resume semantics;
- common recipes;
- explicit fallback path;
- important limits.

Connection Helper remains pairing-only; after READY it always directs the Agent to Tool Helper.

## 13. Acceptance matrix

Every implementation phase must test:
- ARM Linux local host
- AMD Linux outbound leaf
- Windows leaf
- macOS leaf when available
- same device / multiple agent sessions
- owner mismatch denial
- local policy denial
- server policy denial
- reconnect/session resume
- helper contract parity
- package/core-file parity
- CI packaging for each touched platform

No stable tag/release is implied by this plan.


## Phase 1 implementation checkpoint — PTY / ConPTY

- Wall remains the authority/control plane; terminal is only an execution primitive beneath the existing Light Remote session.
- Tool Helper selects recommendations from the already-known target `platform` and `architecture`; OS detection is not a separate permission-discovery protocol.
- `terminal` is a separately governed elevated raw-shell capability. Safe and Developer exclude it by default; Infra may select it only when the device advertises it; Full/Custom remain bounded by grantable capabilities and owner choice.
- Linux uses a PTY backend with x64/arm64 prebuilds; Windows uses ConPTY; macOS uses native PTY. CMD and PowerShell are both Windows terminal modes.
- Terminal lifecycle contract: start, input, output-by-offset, resize, signal, list, stop. RAM ring is primary realtime state; Wall/activity and disk audit are async observers, not inline dependencies.
- PTY output persistence records lifecycle/activity metadata by default; raw terminal byte streams remain bounded in RAM unless a later explicit logging policy enables durable content capture.
