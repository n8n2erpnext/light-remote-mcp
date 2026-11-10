# Light Remote MCP

<p align="center"><img src="assets/branding/light-remote-mark.svg" width="128" alt="Light Remote"></p>
<p align="center"><strong>AI can observe, understand and operate a real computer — while the device owner retains final control.</strong></p>
<p align="center"><a href="README.md">Tiếng Việt</a> · <a href="README.en.md"><b>English</b></a></p>
<p align="center">
  <img alt="Protocol" src="https://img.shields.io/badge/MCP-Streamable%20HTTP-2563eb">
  <img alt="Access" src="https://img.shields.io/badge/Access-Short%20ID%20%2B%20A%2FB-059669">
  <img alt="Real Remote" src="https://img.shields.io/badge/Real%20Remote-V2-2563eb">
  <img alt="Build" src="https://img.shields.io/badge/Internal%20build-0.10.1--dev.5-f59e0b">
  <img alt="License" src="https://img.shields.io/badge/License-Apache--2.0-555555">
</p>

**Light Remote** brings governed remote computing to ChatGPT, Claude, Codex and other compatible MCP AI agents. Instead of providing only a shell or screenshots, it combines **Real Remote V2 (RM V2)**, PTY/ConPTY, files, Git, processes, transfers, container/host administration and Fleet, bound to **account → exact device → Agent → session → local policy**.

- **Official site:** [light-remote.thaiduy.digital](https://light-remote.thaiduy.digital/)
- **Official remote MCP endpoint:** [https://light-remote.thaiduy.digital/mcp](https://light-remote.thaiduy.digital/mcp)
- **ChatGPT plugin:** [Connect Light Remote in ChatGPT](https://chatgpt.com/plugins/plugin_asdk_app_6aab6c4bd7d88191a4108d8f4c5e4b4e)
- **Source:** [n8n2erpnext/light-remote-mcp](https://github.com/n8n2erpnext/light-remote-mcp)

> **Build status:** Windows `0.10.1-dev.5` is an **internal testing candidate**, not a publicly published binary Release. Source implementation, CI passing, internal deployment and physical Owner acceptance are separate levels of evidence. See [Project status](#project-status).

## What makes Light Remote different?

- **Real GUI operation:** RM V2 observes windows, reads semantic UI elements, streams changes and performs bounded native mouse/keyboard actions.
- **Outbound-first connectivity:** Enrolled Windows/Linux/macOS Agents connect outward; no need to expose inbound SSH on every leaf device.
- **Stable six-character Short ID:** Each device is identified by a stable ID bound to its identity. The AI cannot silently substitute the Main device or another machine.
- **Agent-initiated A/B connection:** The AI discovers the account device, selects its exact Short ID and asks for **B approval**. The new Short-ID flow **does not require the owner to generate or send an A code**.
- **Final device-local policy:** An approved connection does not authorize every command; account grants, operating-system capabilities and Local Wall limits still apply.
- **Durable sessions and observable jobs:** Continue tasks and recover outputs rather than rerunning potentially destructive commands.
- **Fleet-wide governance:** Multiple devices, exact-device routing and independent permissions, without silent fallback.

## System architecture

```text
           ChatGPT · Claude · Codex · MCP Clients
                           |
                      HTTPS / OAuth
                           |
                  Light Remote Plugin
                  Streamable HTTP /mcp
                           |
                   Private Unix socket
                           |
                  Light Remote Operator
                identity · grants · sessions
                   /                \
             PostgreSQL 17         Redis 8
             durable state       coordination
                           |
              Signed outbound device channel
                           |
                   Exact enrolled device
              /            |             \
          Windows        Linux          macOS
              \            |             /
                         Local Wall
                   A/B · policy · activity
                           |
          RM V2 · Files · PTY · Processes · SCP · Fleet
```

The MCP server exposes `POST /mcp` and sends trusted internal Operator requests over a **private Unix socket**. The Operator handles account/device identity, grants and durable sessions; the enrolled Agent executes only within effective local policy. An Owner `desktop:read` scope is **not** an Agent execution grant.

Read the [Plugin server](plugin-server/server.mjs), [Operator client](plugin-server/operator-client.mjs), [Operator source](operator-host/), [Device Agent](device-agent/), [Architecture](ARCHITECTURE.md) and [Code Map](docs/project-book/LIGHT_REMOTE_CODE_MAP.md).

## Real Remote V2 (RM V2) — real desktop computer use

**RM V2 is much more than taking screenshots and guessing coordinates.** It combines bounded visual observation, semantic UI understanding and native OS input. The AI can choose a named UI element when possible, falling back to bounded physical input only when needed.

### Desktop observation

- Attach, resume and detach desktop observation sessions.
- Enumerate visible windows, read an on-demand frame and obtain bounded desktop observations.
- Use limited-size screenshots for initial context or resynchronization, without having to take a new full frame after every action.

### Semantic UI — act on elements rather than pixels

- **Windows UI Automation (UIA):** structured element trees, names, state and change events exposed by the native provider.
- **Browser CDP:** connects only to an explicitly selected loopback endpoint for target metadata, accessibility trees and navigation/DOM updates. Its browser semantic provider is **read-only**; it does not grant arbitrary browser JavaScript evaluation or launch browsers.
- Targeted `invoke`, `click`, `focus`, `value`, `toggle`, `select`, `expand` and `collapse` actions on a named element/node.

### Live semantic observation

- Open a **live lane**, read cached semantic deltas and snapshots by sequence number, and resynchronize when necessary.
- After a mutation, optionally await a bounded, declared UI condition such as an expected window title or focused control.
- Close the live lane after work. The Windows companion is designed to start **lazily on demand**, avoiding an always-running desktop sensor when RM is idle.

### Native physical input

- Move the cursor, click (left/right/middle), scroll and drag.
- Enter Unicode text, press named keys with supported modifiers, and operate a real foreground application.
- Input is bound to the authorized device/session/policy. It does not bypass Windows UIPI, UAC consent or the secure desktop.

**Example:** The Agent can launch or focus an application, inspect the Settings UI, select a control semantically, enter a value, observe the result and record the task. This is useful for graphical installers, troubleshooting applications and workflows with no API/CLI.

**Platform scope:** Windows has the native UIA and input companion with dedicated source/test boundaries; macOS includes its own Real Remote implementation and scoped native source testing. The existence of common MCP tool names **does not prove identical desktop features or full physical acceptance on Linux/macOS**. See [RM V2 design](docs/real-remote-v2/README.md), [Windows robot source](client/windows-native/GptOperator.RealRemoteV2/) and [Feature Status](FEATURE_STATUS_MATRIX.md).

## Other Agent capabilities

| Area | Tools and tasks |
| --- | --- |
| Files | Bounded list/read/write/edit/stat/move/delete under allowed filesystem roots |
| Search | Recursive name/content search with result paging |
| Git & development | Inspect code, diffs, run builds/tests with permission |
| Exec | One logical bash/zsh/PowerShell/CMD invocation with timeout and capability inference |
| Managed processes | Start/stop, stdin/stdout lifecycle and offset-based output |
| Terminal | Real Linux/macOS PTY or Windows ConPTY, keystrokes, resize and signals |
| SCP | Chunked binary upload/download with SHA-256 integrity checks |
| Durable jobs | Continue or recover job status/output without blindly rerunning |
| Infrastructure | Docker, LXD, Podman, Incus, Kubernetes, virtual machines, services and package managers according to OS and policy |
| Main/Fleet | Exact-device routing, account-owned device inventory, sessions and leases |
| Optional modules | Long Memory, Codex Bridge and activity history subject to actual enablement |

The Tool Helper prefers structured file/search tools to shell, managed processes/jobs for long work, and RM V2 for actual GUI interaction.

## Local Wall & the new Permissions interface

<p align="center"><img src="assets/screenshots/device-wall-demo.png" width="760" alt="Local Device Wall"></p>

**Local Wall → Permissions** presents **expandable groups and individual capability switches**. It reads supported OS capabilities and the installed tool inventory rather than treating Full Access as an unrestricted universal switch.

### Eight permission groups

| UI group | Representative permissions |
| --- | --- |
| **Files & Development** | Filesystem, Git, build/test, Windows shell |
| **PTY / Interactive Terminal** | Separately granted interactive PTY/ConPTY |
| **Desktop & Real Remote** | `desktop` viewing and `desktop-input` native input, independently |
| **Containers & Virtualization** | Docker, LXD, Podman, Incus, Kubernetes, VMs |
| **System & Packages** | Services, package tools, sudo, Windows UAC, scheduled tasks, launchd |
| **Network & Firewall** | Network administration, firewall, Defender, process/network information |
| **Storage & Provisioning** | Disks, volumes, mounts, Terraform/OpenTofu/Ansible |
| **OS Security & Logs** | Windows Registry/Credential Manager/Event Log, macOS logs |

Capability totals are **device-specific**. A Windows device may show `23/23 locally allowed · 23 effective`; this is its own current supported capability set, **not** a product-wide fixed limit. New capabilities not yet in a named group appear in an additional group.

### Profiles and effective access

Select **Safe, Developer, Remote Support, Infra / Ops, Full access or Custom**. Each group or individual permission can be toggled; the UI also provides **Allow all supported**, **Block all** and **Save local policy**.

- **Main device:** Its Local Wall acts as its permission authority within supported capabilities.
- **Fleet leaf:** Effective access is the intersection of server/Owner approval **and** local policy. A locally checked capability may still require Owner approval through Account.
- **Installed tool ≠ approved tool:** Tool discovery and authorization are independent.
- **Terminal, desktop viewing and desktop input** are separately scoped.
- Sudo/Windows UAC remain real OS elevation boundaries; toggling a capability does not bypass them.

### Filesystem read and write locations

Even **Full access does not open every drive automatically**. **Filesystem access locations** lets the Owner choose detected volumes and additional absolute read/write roots. A write root must be within a read root.

For example, the Owner can allow `C:\Users\Admin` for reading/writing while leaving removable drive `E:\` unavailable. The file, search and SCP tools respect those roots. Future operations use the saved policy without requiring a new Agent pairing.

**Refresh capabilities and inventory** rescans eligible devices; trusted Main obtains its catalog from the Operator and may disable the rescan control. Rights changes update device policy revisions. See the [Local Wall implementation](device-agent/local-wall.mjs) and [Security policy](SECURITY.md).

## Device connection — Short ID + A/B approval

**Short ID** is a stable **six-character** per-device identifier; already allocated IDs are not reused for a different device.

1. The Owner enrolls/links the Agent and connects the device to the account.
2. After OAuth sign-in, the AI calls `light_remote_discover_devices` to **read account-scoped device status**. Discovery does **not** authorize execution.
3. Pick the exact online Short ID (example `R01KAP`). The AI invokes `light_remote_connection_helper` with that target and `startAbV2=true` (*internal MCP parameter name; the product UI calls the feature **A/B***).
4. The server issues a **B approval code**. The Owner checks the intended target/Agent and approves B on the authenticated **Local Wall `/approve`** or supported Account approval page.
5. The AI resumes the Connection Helper and proceeds only when it returns `ready` for that exact authorized device/session.

**No A code is required in the current Short-ID flow.** OAuth account login, read-only discovery, human B approval and remote execution remain independent gates. Never silently switch to another target if one is denied/offline.

If a client lacks the `light_remote_discover_devices` tool, refresh its tool/plugin metadata. The Helper may expose compatible read-only target discovery; a granted-device list is not the full account inventory.

## Connect ChatGPT, Claude and other MCP clients

### ChatGPT — official Light Remote plugin

1. Open [**Light Remote in ChatGPT**](https://chatgpt.com/plugins/plugin_asdk_app_6aab6c4bd7d88191a4108d8f4c5e4b4e) and connect it in the ChatGPT UI.
2. Sign in to the Light Remote account via OAuth.
3. Ask the Agent to discover online devices and connect to the exact **Short ID** with A/B approval.
4. Approve **B** on the selected device's Wall/Account and continue when the Helper reports `ready`.

### Claude / Claude Desktop — custom remote MCP

Following [Claude's custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp):

1. Open **Customize → Connectors → Add → Custom → Web** (or **Add custom connector**, depending on account/UI).
2. Name it `Light Remote` and enter **`https://light-remote.thaiduy.digital/mcp`**.
3. Continue through authentication settings, choose the detected **Sign in/OAuth** flow, then connect with the Light Remote account.
4. Enable the connector in the conversation, discover the device and complete **Short ID → B approval → ready**.

Claude's remote connectors originate from Anthropic infrastructure, so the MCP endpoint must be publicly reachable over HTTPS. **Do not use the device's localhost Local Wall URL as the MCP server.** Team/Enterprise organizations may require an administrator to add the connector first.

### Claude Code — CLI

Follow the [official Claude Code MCP guide](https://code.claude.com/docs/en/mcp):

```bash
claude mcp add --transport http light-remote https://light-remote.thaiduy.digital/mcp
```

Run `/mcp` in Claude Code to inspect the connection and complete OAuth when prompted. Then connect to the selected Short ID and approve B on Light Remote Wall/Account.

### Other MCP clients

Use **Streamable HTTP** and the official HTTPS endpoint. A commonly accepted MCP configuration is:

```json
{
  "mcpServers": {
    "light-remote": {
      "type": "streamable-http",
      "url": "https://light-remote.thaiduy.digital/mcp"
    }
  }
}
```

Exact configuration syntax and OAuth support vary by client. Do not commit bearer tokens or passwords to public config files.

## Updates and recovery

Windows now packages one primary **`LightRemote.exe`**: Tauri/Rust owns GUI/tray and worker dispatch and hosts a fixed-path private WindowsHost/.NET component. Node, RM V2, private .NET libraries and updater/watchdog/recovery tools remain separate. Updates are designed around signed manifests, hash/size verification, health gates and rollback; the **dev.5 public signed feed has not been promoted**.

Older incompatible helpers must take the [pinned compatibility bridge](config/windows-core-migration.json) before installing the one-primary layout. Do not republish signed manifests or use unverified upgrade artifacts.

## Security and limitations

- Owner OAuth login is separate from A/B authorization and device-local execution policy.
- Every command must target the approved device; no automatic cross-device fallback.
- RM V2 requires separate observation/input permissions; OS UIPI, secure desktop and physical consent still apply.
- File roots are constrained separately from Full Access capability selection.
- Optional Long Memory, Codex Bridge, browser Wall SSO, Guest/Pro Share and restored modules have different enablement/testing states. See [Known Issues](KNOWN_ISSUES.md).
- Device grants/sessions are revocable. Private keys and session capabilities do not belong in public docs.

## Development and source evidence

- Official source: [n8n2erpnext/light-remote-mcp](https://github.com/n8n2erpnext/light-remote-mcp), Git SSH: `git@github.com:n8n2erpnext/light-remote-mcp.git`.
- The Owner-approved permanent development branch is **`work`**; `main` is protected by `baseline-required`. No extra branches or force-push.
- All newly created VPS-ARM development directories must stay under `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/`. Active checkout: `implementation-20261108/single-primary-exe`.
- Every commit atomically updates the sole `MASTER_CHECKPOINT.json`, `PROJECT_HANDOFF.md`, Worklog and generated documentation status.

Read [Project Truth](PROJECT_TRUTH.md), [Master Checkpoint](MASTER_CHECKPOINT.json), [Project Book](docs/project-book/README.md), [Code Map](docs/project-book/LIGHT_REMOTE_CODE_MAP.md), [Feature Status](FEATURE_STATUS_MATRIX.md) and [Build/Deployment](BUILD_AND_DEPLOYMENT.md).

```bash
npm ci --ignore-scripts
npm run check:truth
npm run check:docs
npm test
```

## Project status

| Component | Current status |
| --- | --- |
| Windows Desktop | Internal `0.10.1-dev.5`, one primary `LightRemote.exe`; build/install/migration/watchdog PASS |
| CI | [CI #64 — 9/9 PASS](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42803494868); Node284, React125, browser170 + Wall4, backend25 |
| Codex / Wall / PTY / native X / command labels | Implemented and automated tests PASS; physical Owner acceptance pending |
| Operator/Plugin Lab | Exact `8e0d932` / dev5 deployed; health/API PASS, data and independent Agent/Wall preserved |
| Git | Source/handoff published on `work`; `main` remains `8ac6273`, promotion pending |
| Physical Owner dev5 UAT | **Owner downloads/installs/tests and reports; PENDING** |
| macOS/Linux installers | Native source tests PASS; full installers not established |
| Public Release / signed feed | **NOT PUBLISHED / HOLD** |

Source `8e0d932920d218c54f83989978f3866c321e20de` · [internal installer](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42803494868/artifacts/13758302838) · [evidence/SHA256](docs/evidence/desktop-followup/ACCEPTANCE.json) · [handoff](PROJECT_HANDOFF.md).

The Lab backend was separately updated to dev5; installing this candidate does not change the server. Runtime token/quota scope, unsupported/stale data and configured activity retention remain explicit.

## License

Apache-2.0 — [LICENSE](LICENSE), [NOTICE](NOTICE), [THIRD_PARTY_DISTRIBUTION_NOTICES.md](THIRD_PARTY_DISTRIBUTION_NOTICES.md).
