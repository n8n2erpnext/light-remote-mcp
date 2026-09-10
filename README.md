# Light Remote MCP

<p align="center">
  <strong>Secure outbound remote execution for AI tools and the machines you already own.</strong>
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-v0.9%20packaging%20candidate-f59e0b">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-native%20tray%20client-2563eb">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-systemd%20agent-059669">
  <img alt="Transport" src="https://img.shields.io/badge/transport-outbound--only-171717">
</p>

**Light Remote MCP** turns a Windows or Linux machine into an explicitly authorized remote execution target for ChatGPT, Claude, Codex, and other MCP-capable AI workflows.

The client connects **outbound** to a governed hub. AI tools do not need inbound SSH access to the target machine, and an enrolled node is addressed explicitly instead of being discovered through a broad network tunnel.

The project began as `gpt-vps-bridge`; the repository and public gateway now use the **Light Remote MCP** name, while a small set of internal compatibility identifiers remain until existing enrolled devices can be migrated safely.

## Why Light Remote MCP

- **No inbound SSH requirement.** Enrolled devices maintain a signed outbound channel to the hub.
- **Explicit target selection.** Commands target a specific `nodeId`; an offline leaf never silently falls back to another machine.
- **Owner-approved capabilities.** Filesystem, Git, Docker, system services, package managers, and privileged operations remain capability-gated.
- **Device-side enforcement.** The leaf re-infers capabilities from the command before execution instead of trusting caller metadata alone.
- **Local device identity.** Each device creates its own Ed25519 identity; the private key stays on that device.
- **Persistent clients.** Windows runs as a native tray application and Linux runs under systemd, so closing a terminal does not break the connection.
- **Signed updates.** Windows and Linux share a signed update-manifest design with hash verification and rollback behavior.
- **Auditable routing.** Sessions, jobs, output, and Wall events retain the exact device/node attribution.

Light Remote MCP is not a general remote-desktop replacement. It is a controlled execution bridge for automation, development, infrastructure work, and MCP-style tool use.

## Architecture

```text
AI client / MCP consumer
        |
        v
Vercel gateway / control edge
        |
        v
ARM Hub  ---- audit / session / routing
        |
        +---- ARM local executor
        +---- Windows outbound leaf
        +---- Linux outbound leaf(s)
```

The current production-test route is:

```text
ChatGPT / operator client
  -> Vercel
  -> ARM Hub
  -> explicitly selected enrolled node
  -> platform adapter
  -> governed local execution
```

The Vercel layer is intentionally thin. The ARM Hub owns session routing, device presence, audit attribution, and command delivery. Leaf devices poll outbound and return signed results through the same trust boundary.

See [`FLEET_ROUTING_V0_8.md`](FLEET_ROUTING_V0_8.md), [`PLATFORM_ADAPTERS_V0_9.md`](PLATFORM_ADAPTERS_V0_9.md), and [`AI_BRIDGE_GUIDE.md`](AI_BRIDGE_GUIDE.md) for the engineering contracts behind the current implementation.

## Platform clients

| Platform | Current client | Persistence | Packaging status |
| --- | --- | --- | --- |
| Windows x64 | Native .NET 8 WinForms tray application with bundled Node runtime and device agent | Starts with the signed-in user; closing the window keeps the agent in the tray | v0.9 packaging candidate, installer acceptance green |
| Linux x64 | Bundled Node runtime + device agent | systemd service | v0.9 package acceptance green |
| Linux arm64 | Bundled Node runtime + device agent | systemd service | v0.9 package acceptance green |
| macOS | Deferred | — | Not currently shipped |

### Windows

The Windows client is designed to behave like a normal desktop application: install once, enroll once, then leave it running in the system tray. No PowerShell session needs to remain open.

Current Windows behavior includes:

- native dark tray UI under the **Light Remote MCP** brand;
- connect/disconnect control and device status;
- device/runtime/capability details;
- enrollment through the browser approval flow;
- automatic startup for the current Windows user;
- supervised agent restart with bounded backoff;
- signed update checking and verified installer handoff;
- migration from the earlier Scheduled Task development client;
- rollback smoke-tested in GitHub Actions.

The active Windows CI gate builds the self-contained client, packages the Inno Setup installer, installs it on a Windows runner, verifies the installed client, forces a broken-update rollback path, uninstalls it, hashes the installer, and only then uploads the artifact.

### Linux

Linux uses a smaller operational surface:

```text
install script
  -> versioned bundle under /opt
  -> gpt-operator-device-agent.service
  -> outbound device channel
```

A separate updater timer verifies the signed manifest and artifact hash, switches the versioned `current` target, restarts the agent, and rolls back when the new service does not become healthy.

## Enrollment and trust

A new device creates its private identity locally, then starts a short-lived owner approval flow.

```text
device generates Ed25519 identity
  -> one-time enrollment code
  -> owner approves requested capability subset
  -> server binds the public identity
  -> signed heartbeat/poll proves the device before it becomes online
```

Important boundaries:

- Private device keys are not uploaded to the control plane.
- Enrollment codes are short-lived and one-time.
- Owner approval cannot grant capabilities the device did not request.
- A revoked device cannot re-enter the fleet with its old proof.
- Timestamp/nonce replay checks apply to the device channel.
- Explicit leaf targeting never falls back to ARM when the target is offline or draining.
- Local policy may reduce effective permissions; it cannot silently increase owner-approved permissions.

## Security posture

Light Remote MCP favors explicit trust boundaries over a broad remote shell.
Current controls include:

- Vercel-to-Hub authentication at the public edge;
- short-lived operator sessions instead of a long-lived shared caller bearer;
- X25519 + HKDF-SHA256 + AES-256-GCM privileged envelopes;
- semantic `operationId` idempotency and replay rejection;
- session ownership and per-node session ceilings;
- device-side capability inference before spawn;
- bounded command queues, lease/redelivery, and result-receipt idempotency;
- read-only Wall/audit visibility with exact node attribution;
- ECDSA P-256 signed client update manifests;
- SHA-256 artifact verification before install;
- update rollback paths on both Windows and Linux.

The update signing private key is intentionally kept outside the repository and outside normal CI. Clients ship only the public verification key.

## Current acceptance

The project is still pre-stable. `main` represents the accepted v0.8 fleet-routing candidate; the active v0.9 work is being validated on dedicated branches before promotion.

Live acceptance has already covered:

- ARM Hub/local executor on Linux aarch64;
- a second Linux x86_64 leaf through the public Vercel route;
- a real Windows x64 leaf through the same Vercel -> ARM Hub path;
- PowerShell, filesystem, Git/build, process/network, Services read, Event Log, and package-manager execution on Windows;
- Linux platform capability inference including governed `sudo-on-demand`;
- exact Wall/audit node attribution and cleanup back to zero active sessions.

## Getting the client

There is no stable `v1.0` release yet. Current Windows and Linux packages are engineering candidates produced by GitHub Actions from the active acceptance branches.

Do not treat an arbitrary CI artifact as a stable public release. Public distribution will be enabled only after the packaging/update channel is closed and the corresponding source commit is promoted.

The current packaging work lives on:

```text
codex/v0.9-client-packaging
```

The current platform-adapter work is documented in:

```text
PLATFORM_ADAPTERS_V0_9.md
```

## Development

### Requirements

- Node.js 22.x
- npm
- Windows/.NET 8 SDK only when building the native Windows shell locally

The repository intentionally keeps most acceptance checks as standalone scripts under `deploy/scripts/` so the same contracts can run on CI and on the reference ARM/AMD hosts.

### Validate

Run the standalone regression suite from the repository root:

```bash
for test in deploy/scripts/selftest-*.mjs; do
  node "$test"
done
```

Useful focused gates include:

```bash
node deploy/scripts/selftest-v09-windows-package.mjs
node deploy/scripts/selftest-v09-platform-adapters.mjs
node deploy/scripts/selftest-v09-agent-capability-inference.mjs
```

GitHub Actions provides the native packaging gates:

- `.github/workflows/windows-native-client.yml`
- `.github/workflows/linux-client-build.yml`

The Windows workflow performs a real install/self-test/rollback/uninstall roundtrip on a Windows runner rather than stopping at compilation.

## Repository map

```text
api/                         Vercel-facing API routes and guide metadata
gateway/                     ARM Hub / MCP gateway runtime
device-agent/                Enrolled leaf agent and platform adapters
client/windows-native/       Native Windows tray application and installer
client/linux/                Linux installer and updater path
deploy/scripts/              Regression, live-proof, and packaging helpers
docs / top-level *.md        Versioned architecture and recovery contracts
```

The historical file names still contain `gpt-operator` and `gpt-vps-bridge` identifiers in places where changing them would break device state, service migration, or rollback compatibility. User-facing branding now uses **Light Remote MCP**; compatibility identifiers are retained only where changing them would invalidate existing enrolled devices, service migration, or rollback behavior.

## Operator guide

The reference deployment exposes a machine-readable operator guide at:

```text
https://light-remote-mcp.vercel.app/api/guide
```

That endpoint describes the current session/open/exec/resume contract for AI agents working through the reference environment. It is a development/control-plane guide, not a promise that the reference deployment is an unrestricted public execution service.

For recovery and architecture context, start with:

- [`CURRENT_STATE.md`](CURRENT_STATE.md)
- [`AI_BRIDGE_GUIDE.md`](AI_BRIDGE_GUIDE.md)
- [`FLEET_ROUTING_V0_8.md`](FLEET_ROUTING_V0_8.md)
- [`PLATFORM_ADAPTERS_V0_9.md`](PLATFORM_ADAPTERS_V0_9.md)
- [`PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`](PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md)

## Roadmap

Near-term priorities are intentionally narrow:

- finish the Windows native tray client and installer as the default Windows path;
- keep Linux installation persistent under systemd with the same signed update channel;
- close cross-platform client update acceptance and release rollback behavior;
- finish the v0.9 platform-adapter promotion without regressing v0.8 routing guarantees;
- expose owner-managed device capability profiles without weakening device-local enforcement;
- replace temporary operator-auth plumbing with a public account/device authorization plane suitable for an official MCP/App distribution path;
- keep macOS deferred until Windows and Linux packaging are stable enough to justify another native distribution lane.

The public-product direction is documented in [`PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`](PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md).

## Light ecosystem

Light Remote MCP is part of the broader [`n8n2erpnext`](https://github.com/n8n2erpnext) open-source engineering ecosystem.

It is intentionally independent from [LightBI](https://github.com/n8n2erpnext/lightbi), but the products share a similar posture: local/self-hosted execution where it improves control, explicit trust boundaries, auditable behavior, upgradeability, and fail-closed handling when evidence or authorization is weak.

Light Remote MCP can serve as an infrastructure bridge for AI-assisted operations across a user's own machines; LightBI remains focused on governed business analysis and evidence-bound data workflows.

## Third-party notices

The Windows client uses UI/layout patterns derived from the NetBird desktop client. NetBird's applicable client code is distributed under the BSD 3-Clause license; the required notice is bundled with the Windows client in `THIRD_PARTY_NOTICES.txt`.

Linux packages bundle the pinned Node.js runtime and carry its upstream license at `licenses/node/LICENSE`. The self-contained Windows installer carries the bundled Node.js license plus the .NET runtime license and third-party notices under `licenses/node/` and `licenses/dotnet/`. CI treats those files as package-contract requirements rather than optional documentation.

See [`THIRD_PARTY_DISTRIBUTION_NOTICES.md`](THIRD_PARTY_DISTRIBUTION_NOTICES.md) for the distribution layout. No NetBird branding, logo, or endorsement is used by Light Remote MCP.

## Project licensing

A project-wide Light Remote MCP license has not yet been declared at the repository root. The stable public release should include an explicit project license before downstream redistribution is encouraged.

Third-party components retain their own licenses and notices.

---

**Light Remote MCP is pre-stable software.** Expect active iteration in packaging, authorization, update delivery, and public MCP integration until the first stable release is cut.
