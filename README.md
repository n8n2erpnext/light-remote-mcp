# Light Remote MCP

<p align="center">
  <img src="assets/branding/light-remote-mark.svg" alt="Light Remote" width="128">
</p>

<p align="center">
  <strong>Secure outbound remote execution for AI tools and the machines you already own.</strong>
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-v0.9.0--beta.1-f59e0b">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-native%20tray%20client-2563eb">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-systemd%20agent-059669">
  <img alt="Transport" src="https://img.shields.io/badge/transport-outbound--only-171717">
</p>

**Light Remote MCP** turns a Windows or Linux machine into an explicitly authorized remote execution target for ChatGPT, Claude, Codex, and other MCP-capable AI workflows.

The client connects **outbound** to a governed hub. AI tools do not need inbound SSH access to the target machine, and an enrolled node is addressed explicitly instead of being discovered through a broad network tunnel.

The project began as `gpt-vps-bridge`; the repository and public gateway now use the **Light Remote MCP** name, while a small set of internal compatibility identifiers remain until existing enrolled devices can be migrated safely.

Official brand assets live under `assets/branding/`: the round LR mark is used for application/tray/installer surfaces, while the supplied horizontal lockup is kept as the canonical wordmark asset.

## Why Light Remote MCP

- **No inbound SSH requirement.** Enrolled devices maintain a signed outbound channel to the hub.
- **Explicit target selection.** Commands target a specific `nodeId`; an offline leaf never silently falls back to another machine.
- **Owner-approved capabilities.** Filesystem, Git, Docker, system services, package managers, and privileged operations remain capability-gated.
- **Device-side enforcement.** The leaf re-infers capabilities from the command before execution instead of trusting caller metadata alone.
- **Local device identity.** Each device creates its own Ed25519 identity; the private key stays on that device.
- **Always-alive local service, finite cloud lease.** Windows keeps the agent supervised behind the tray app and Linux runs it under systemd; closing a terminal never stops the local service, while the cloud channel may be Connected or Dormant independently.
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
| Windows x64 | Native .NET 8 WinForms tray application with bundled Node runtime, local Wall and device agent | Starts with the signed-in user; local service stays alive while cloud can be Connected or Dormant | v0.9 packaging candidate, installer acceptance green |
| Linux x64 | Bundled Node runtime + device agent + localhost Wall | systemd always-alive local service; finite cloud lease | v0.9 package acceptance green |
| Linux arm64 | Bundled Node runtime + device agent + localhost Wall | systemd always-alive local service; finite cloud lease | v0.9 package acceptance green |
| macOS | Deferred | — | Not currently shipped |

### Windows

The Windows client is designed to behave like a normal desktop application: install once and leave the local service supervised in the tray. No PowerShell session needs to remain open. Cloud access is explicit: Connect creates a finite server lease; Disconnect or lease expiry leaves the local service alive in Dormant state.

Current Windows behavior includes:

- native dark tray UI under the **Light Remote MCP** brand;
- connect/disconnect control for the finite cloud lease, plus Connected/Dormant device status;
- Local Wall access on `http://127.0.0.1:5491/` for this-device control and Agent-session visibility;
- device/runtime/capability details;
- enrollment through the browser approval flow;
- automatic startup for the current Windows user;
- supervised agent restart with bounded backoff;
- signed update checking and verified installer handoff;
- migration from the earlier Scheduled Task development client;
- rollback smoke-tested in GitHub Actions.

The active Windows CI gate builds the self-contained client, packages the Inno Setup installer, installs it on a Windows runner, verifies the installed client, forces a broken-update rollback path, uninstalls it, hashes the installer, and only then uploads the artifact.

### Linux

Linux uses a smaller operational surface. The systemd service stays alive even while cloud access is Dormant, and serves the same localhost Wall contract used by the desktop client:

```text
install script
  -> versioned bundle under /opt
  -> gpt-operator-device-agent.service
  -> localhost Wall + finite outbound device channel when Connected
```

A separate updater timer verifies the signed manifest and artifact hash, switches the versioned `current` target, restarts the agent, and rolls back when the new service does not become healthy.

## Enrollment and trust

A new device creates its private identity locally, then starts a short-lived owner approval flow.

```text
device generates Ed25519 identity
  -> one-time enrollment code
  -> owner approves requested capability subset
  -> server binds the public identity
  -> user creates a finite Device Connection Lease
  -> signed connect/poll proves the device before cloud execution becomes available
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

## Public beta: `v0.9.0-beta.1`

`v0.9.0-beta.1` is the first public beta of the frozen execution/control-plane architecture. It is pre-stable software, backed by live ARM + Linux x64 + Windows x64 acceptance, signed update/rollback proof, and packaging gates for clients, the self-hosted Linux Server, and the Vercel bridge.

Release assets are built from tagged source. Prefer files attached to the GitHub prerelease over arbitrary CI artifacts. The update channel is signed separately; clients verify the manifest signature and selected artifact SHA-256 before installation.

### What you deploy

For the current self-hosted beta, Vercel is a **thin authenticated bridge**, not the durable Server. Durable routing/session/job state remains on the Linux Server/Hub.

```text
Windows / Linux clients
        |  outbound enrollment + device channel
        v
Light Remote MCP Linux Server / Hub
        ^
        |  authenticated operator traffic
Vercel bridge
        ^
        |  current private/reference integration
AI / operator client
```

The long-term product boundary is `Client <-> Server <-> Light Remote Plugin/App <-> ChatGPT`. See [`PRODUCT_ARCHITECTURE_ROADMAP_V0_9_BETA_TO_PLUGIN.md`](PRODUCT_ARCHITECTURE_ROADMAP_V0_9_BETA_TO_PLUGIN.md).

## Quick start — self-hosted beta

The examples below use `v0.9.0-beta.1`. Replace example domains, Vercel team/project names, users and workspace paths with your own values.

### 1. Download and install the Linux Server / Hub
Use a Linux x64 or arm64 VPS. Download the matching server archive from the GitHub prerelease and verify it against `SHA256SUMS.txt`, then extract it:

```bash
mkdir -p ~/light-remote-beta && cd ~/light-remote-beta
# Download the matching Light-Remote-MCP-Server-Linux-*-0.9.0-beta.1.tar.gz
# and SHA256SUMS.txt from the v0.9.0-beta.1 GitHub prerelease first.
sha256sum -c SHA256SUMS.txt --ignore-missing
tar -xzf Light-Remote-MCP-Server-Linux-arm64-0.9.0-beta.1.tar.gz
cd package
```

Publish the MCP listener through your own HTTPS reverse proxy at a domain such as `https://mcp.example.com`. The installer defaults both MCP and Wall to localhost and does not silently open a public management port.

```bash
sudo ./install.sh \
  --user ubuntu \
  --vercel-team YOUR_VERCEL_TEAM_SLUG \
  --vercel-project light-remote-mcp \
  --public-mcp-url https://mcp.example.com \
  --workspace code=/srv/code
```

On Debian/Ubuntu, add `--install-deps` if the supported Docker/Git/Curl/OpenSSL prerequisites are missing. State, keys and logs live outside the versioned release directory so an upgrade does not erase enrollment or audit state.

The Wall defaults to `http://127.0.0.1:8081`. On a remote VPS, keep that default and use an SSH/VPN tunnel when approving devices, or explicitly choose a VPN/LAN bind with `--wall-bind` and `--wall-url`. Public Wall binding is never implicit.

The installer prints the **public** operator-key JSON required by the Vercel bridge. The private operator key stays only on the Linux Server.

### 2. Deploy the Vercel bridge
Two paths are supported. The easiest is to import the public GitHub repository into a Vercel project. For a minimal deployment payload, download and extract `Light-Remote-MCP-Vercel-Bridge-0.9.0-beta.1.tar.gz` from the prerelease and deploy that directory with the Vercel CLI.

Configure these Vercel environment variables:

```text
VPS_MCP_BASE=https://mcp.example.com
VPS_MCP_URL=https://mcp.example.com/mcp
VPS_MCP_AUDIENCE=https://mcp.example.com
OPERATOR_PUBLIC_KEYS_JSON=<public JSON printed by the Server installer>
```

The Linux Server validates the calling Vercel team/project through OIDC. The Vercel deployment therefore needs to match the `--vercel-team` and `--vercel-project` values used during Server installation.

Packaged deployment notes live in [`deploy/vercel/README.md`](deploy/vercel/README.md).

### 3. Install a Windows client

Download `Light-Remote-MCP-Setup-x64-0.9.0-beta.1.exe` from the prerelease and run the installer. Open **Light Remote MCP → Server settings…** before enrollment and set:

```text
Bridge URL: https://YOUR-PROJECT.vercel.app
Hub URL:    https://mcp.example.com
```

Both endpoints must be HTTPS. Choose **Enroll device**, open the approval URL, review requested capabilities in Wall, approve only what you want, and leave the client running in the tray. The agent normally runs as the signed-in user; privileged operations remain capability/elevation events rather than permanent administrator identity.

### 4. Install a Linux client / server leaf
Download `install-linux-client.sh` plus the matching Linux client archive from the prerelease. Run the installer as the normal target user; it invokes `sudo` only for system installation steps:

```bash
chmod +x install-linux-client.sh
./install-linux-client.sh \
  --bundle ./Light-Remote-MCP-Client-Linux-x64-0.9.0-beta.1.tar.gz \
  --base-url https://YOUR-PROJECT.vercel.app \
  --hub-url https://mcp.example.com
```

For arm64, use the arm64 archive. After enrollment, systemd owns the connection and the shell may be closed. The same client package is suitable for a headless Linux server leaf; a native Linux Desktop GUI is a later roadmap item.

### 5. ChatGPT Plus today — Vercel bridge is the required control path

For the current ChatGPT Plus operating environment, **do not configure Light Remote as a custom full MCP App**. Full write/modify MCP access is not available on Plus, and the project is not yet published as a Light Remote Plugin/App in the ChatGPT Plugin Directory. The supported owner path for this beta is therefore:

```text
ChatGPT Plus -> @Vercel -> Light Remote Vercel bridge -> owner approval in Wall -> ARM Hub -> selected ARM/AMD/Windows executor
```

The Vercel deployment is an intentional compatibility adapter for ChatGPT Plus, not merely a hosting convenience. `api/operator?via=plus` accepts GET only because the current `@Vercel` fetch surface cannot attach the project's private bridge-session header or issue arbitrary POST requests.

A Plus chat does **not** receive permanent credentials. It first calls `authorize-begin`, which creates a ten-minute authorization request and returns a one-time code plus a Wall approval URL. The owner signs in to Wall and approves that request. The chat then calls `authorize-poll` once and receives a short-lived Plus operator session (one hour by default). Only that owner-approved session can call device/session/exec/job/output actions. Vercel OIDC is still verified by the ARM Hub, mutating operations still require stable `operationId` values, execution envelopes remain encrypted, and signed device policy plus device-local capability inference remain the final authority.

Because the Plus connector is GET-only, the short-lived polling/session capability is carried on the compatibility request URL. It is deliberately **not** a static shared bearer: it expires quickly, is created only after explicit Wall approval, is never an owner password/private key/cookie, responses are `no-store`, and application logs never print the capability. Long-lived credentials must never be put in URLs.

The direct `/mcp` OAuth lane remains in the codebase for Business/Enterprise/Edu testing and future Plugin/App publication. It is **not** the current Plus acceptance path. The beta continuity gate is: a fresh Plus chat using only `@Vercel` must pair through Wall, discover the fleet, select an explicit device, open a durable session, execute/read output, resume/close the session, and perform routine coding/operations work without RDC.

The machine-readable Vercel guide documents the exact pairing/actions and safety rules. No static shared bearer is used anywhere in this path.

### Updating beta clients

The beta channel is separate from GitHub's `releases/latest` semantics. Windows and Linux clients read the signed manifest at `channels/beta/client-update.json` and `channels/beta/client-update.json.sig`. A release is not trusted merely because a file exists on GitHub: signature and artifact hash checks remain mandatory.

## Development

### Requirements

- Node.js 22.x
- npm
- Windows/.NET 8 SDK only when building the native Windows shell locally

The repository intentionally keeps most acceptance checks as standalone scripts under `deploy/scripts/` so the same contracts can run on CI and on the reference ARM/AMD hosts.

### Validate

The reference acceptance script can test either an ephemeral local Gateway or an already deployed HTTPS MCP endpoint. For a self-owned deployment, set `LRM_DOGFOOD_BASE=https://mcp.example.com` and provide the local Wall credential files; the script performs OAuth + durable ARM/Linux/Windows-style fleet operations without printing the password.

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

The v0.9 beta freezes the execution/control-plane contracts while product work moves upward into distribution: account/OAuth, a thin self-describing Plugin/App, distribution web, Linux Desktop UX, and a hosted implementation of the same Server contract. Vercel remains a deployment adapter rather than product authority.

See [`PRODUCT_ARCHITECTURE_ROADMAP_V0_9_BETA_TO_PLUGIN.md`](PRODUCT_ARCHITECTURE_ROADMAP_V0_9_BETA_TO_PLUGIN.md) for the locked technical boundaries and [`PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`](PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md) for the longer engineering history.

## Light ecosystem

Light Remote MCP is part of the broader [`n8n2erpnext`](https://github.com/n8n2erpnext) open-source engineering ecosystem.

It is intentionally independent from [LightBI](https://github.com/n8n2erpnext/lightbi), but the products share a similar posture: local/self-hosted execution where it improves control, explicit trust boundaries, auditable behavior, upgradeability, and fail-closed handling when evidence or authorization is weak.

Light Remote MCP can serve as an infrastructure bridge for AI-assisted operations across a user's own machines; LightBI remains focused on governed business analysis and evidence-bound data workflows.

## Third-party notices

The Windows client uses UI/layout patterns derived from the NetBird desktop client. NetBird's applicable client code is distributed under the BSD 3-Clause license; the required notice is bundled with the Windows client in `THIRD_PARTY_NOTICES.txt`.

Linux packages bundle the pinned Node.js runtime and carry its upstream license at `licenses/node/LICENSE`. The self-contained Windows installer carries the bundled Node.js license plus the .NET runtime license and third-party notices under `licenses/node/` and `licenses/dotnet/`. CI treats those files as package-contract requirements rather than optional documentation.

See [`THIRD_PARTY_DISTRIBUTION_NOTICES.md`](THIRD_PARTY_DISTRIBUTION_NOTICES.md) for the distribution layout. No NetBird branding, logo, or endorsement is used by Light Remote MCP.

## Project licensing

Light Remote MCP source is licensed under the **Apache License 2.0**; see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). The software license does not grant permission to use the Light Remote MCP name, logos or project identity to imply endorsement or official status.

Third-party components retain their own licenses and notices. See [`THIRD_PARTY_DISTRIBUTION_NOTICES.md`](THIRD_PARTY_DISTRIBUTION_NOTICES.md).

---

**Light Remote MCP is pre-stable software.** Expect active iteration in packaging, authorization, update delivery, and public MCP integration until the first stable release is cut.
