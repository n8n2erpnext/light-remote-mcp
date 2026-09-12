# Light Remote MCP — START HERE

This Vercel project is the approved ChatGPT-facing relay into the owner's ARM operator hub.

Active path:
`ChatGPT -> @Vercel -> light-remote-mcp.vercel.app -> ARM hub -> selected executor`

## P4.5 public pairing target — A/B codes
The public golden path is being migrated away from pre-authorization device enumeration. A normal Agent must not discover account/fleet/devices/capabilities before pairing. The device Local Wall will show a short-lived one-time **A code** while its finite Device Connection is active. The user gives A directly to ChatGPT/Codex/Claude. The Agent calls one high-level connect action; server resolves exactly that device, consumes A, and returns a short-lived **B code** plus an opaque continuation. The user enters B at that exact device Wall `/approve` and explicitly Approves/Deny. A alone never grants execution, and B cannot be approved on another device.

After approval the Agent client session gains one authorized device binding. Repeating A/B for another device adds another independent binding to the same client session. Normal `list_devices` then means only the Agent's currently authorized set, not account inventory. Per-device grants, connection leases, Agent sessions, jobs and Disconnect remain isolated; the user may route Task A to Device A and Task B to Device B concurrently.

Target Agent state machine is intentionally compact: `need_a_code -> approval_required -> ready`. If an A code is supplied, call connect directly. Do **not** call `devices-bootstrap`, `fleet`, `capabilities`, account lookup or broad status probes on the normal path. Those remain compatibility/debug/admin surfaces. Until P4.5 source and live acceptance close, the legacy sequence below remains the active compatibility path.

## Golden agent startup — ChatGPT Plus / @Vercel
1. Fetch `https://light-remote-mcp.vercel.app/api/guide` once and follow its compact `plusBridge` contract. Generate one stable opaque `agentId` for this chat/window.
2. If the user has not supplied an A code, ask only for the A code shown on the target device Local Wall. Do not enumerate devices, account inventory, fleet or capabilities.
3. Call `action=connect` with `{aCode,agentId,label,client?}`. If pairing succeeds, return only the B code to the user and retain the opaque continuation privately. The A code is consumed immediately.
4. The owner enters B at that exact device Wall `/approve` and chooses Approve or Deny. There is no time, Connect, lease or session-duration control on this screen.
5. Call `connect-poll(continuation)`. Before approval it remains `approval_required`; after approval it returns `ready + device + opaque client`. Retrying an already-approved continuation is idempotent and returns authority for the same Agent client session rather than creating a new client identity.
6. To add another device to this chat, repeat A -> B using the returned `client`. Each device is approved independently and becomes one binding in the same authorized set.
7. `list-devices(client)` returns only this Agent client's currently authorized devices. If exactly one live device exists, an unqualified task may use it; with several devices and no clear target, ask the user which authorized device to use.
8. Normal `session-open/exec/job/output/resume/hold/close` calls carry the opaque `client` plus an explicit target device. Per-device grants, connection leases and session lanes remain isolated, so Task A and Task B may run concurrently on different devices.

The Plus compatibility transport is GET-only because the current `@Vercel` fetch surface cannot provide arbitrary application POST/header calls. The query carries only bounded, short-lived pairing/continuation/client capabilities and bounded base64url request bodies. Owner passwords, private keys, Wall cookies and long-lived credentials never belong in URLs. Treat the returned continuation/client values as bearer material: keep them private and do not quote them back to the user.

### Compatibility startup — do not use on the normal Agent path
`devices-bootstrap -> authorize-begin -> authorize-poll -> ps` remains temporarily available for rollback/debug and older callers. It is no longer the public startup contract and must not be used merely because an Agent wants to discover a target. A supplied A code always goes straight to `connect`.

### Legacy/reference operator clients
Non-Plus clients that can issue arbitrary POST requests may still use `POST /api/auth` and `x-bridge-session`. That is a compatibility lane, not the current ChatGPT Plus startup flow.

## Session semantics
A durable Agent lane is keyed by `(deviceId, agentId)`, not by `agentId` globally. The same ChatGPT Agent may own one lane on ARM and a separate lane on AMD/Windows without target mutation; each lane remains bound to one exact device/node. Different ChatGPT windows use different `agentId` values and may coexist under one approved Device Access Grant.

Agent inactivity uses reconnect/HOLD grace only: 15, 30, 45 or 60 minutes. There is no Unlimited Agent session. Active jobs may HOLD a lane so transport loss does not duplicate work. When a lane expires, it is terminal; returning inside grace resumes the same lane, returning after expiry opens a new Agent lane. Human re-approval is still unnecessary while the parent Device Access Grant remains valid.

Device lifetime is a separate authority. The always-alive local service may be running while the cloud is Dormant. A user-created Device Connection Lease opens cloud traffic for a finite hard window (reference caps: Free 4h, Pro 24h, VIP 72h); tool activity cannot silently extend that hard limit. If no Agent lane remains and no tool activity occurs for the configured 15–60 minute grace, the Device Access Grant expires, but the Device Connection Lease remains until explicit Disconnect/revoke/authority failure or its hard expiry. Hard expiry closes the device connection, its Device Access Grant and every Agent lane on that device.

## Security / execution
There is no static shared Bearer boundary. For ChatGPT Plus, exact Vercel OIDC is necessary but not sufficient. Public bootstrap additionally requires A/B pairing and the resulting Agent-client binding; every normal operation then resolves that client binding to a server-validated Device Access Grant scoped to the exact device and current `connectionId`. Approval is produced from the enrolled device Local Wall through an Ed25519-signed device-channel operation; the hosted Wall cannot mint that approval.

The `ps` token is cryptographically domain-separated from Wall cookies, legacy bridge sessions and direct MCP OAuth tokens. It carries only device-grant scope and is bounded by the Device Connection Lease. It is intentionally **not agent-bound**: several ChatGPT windows may obtain their own `ps` tokens for the same already-approved device grant, while their actual durable Agent sessions remain independently owned and target-bound.

Privileged bodies remain protected with X25519 + HKDF-SHA256 + AES-256-GCM, replay rejection and semantic `operationId` idempotency. Signed device policy and device-side capability inference remain the final execution boundary. A grant for ARM cannot open, resume, inspect or execute an AMD/Windows lane; gateway and operator-host both verify device binding.

Execution policy has two distinct layers. **Owner/Wall Policy** is user-controlled and may enable or disable any capability the selected device actually supports; it exists to reduce accidental authority, not to cripple Light Remote's RDC-replacement goal. For example, disabling `sudo-on-demand` blocks sudo-required commands, while enabling it allows explicit sudo workflows even though the service itself does not run permanently as root. **Server Safety Policy** is a separate future guardrail against abuse, bypass and deceptive requests. The two must never be merged into one ambiguous policy surface; effective authority is their intersection with the device's actual capabilities.

## Wall / observability
There are two distinct control surfaces. **Local Wall** is served by the always-alive client service and is scoped to exactly one device. It keeps the operator-stream/session-lane/history experience of the reference Wall: live command/output, Agent lanes, device/cloud state, policy/capability context and maintenance. It may be exposed on localhost, a private/NetBird address, or behind the owner's reverse proxy. Wall is observer/control only: closing the tab/browser does not affect the service, cloud lease, grant, Agent sessions or durable jobs. Pending access is handled at `/approve` by entering the short code and choosing Approve/Deny.
Any non-loopback Local Wall bind is fail-closed unless **device-local owner authentication** is configured. The owner session protects the Wall root, A-code issuance, `/approve`, APIs and SSE. Reverse proxy/TLS/NetBird are transport/outer-defense choices, not substitutes for the owner session. The transitional pre-account Wall login uses the same `operator` credential as the hosted reference Wall; `wall-auth-init` reads the password from stdin rather than argv; the stored file contains a scrypt verifier plus an independent cookie-signing secret and is mode `0600`.

The hosted/reference Wall on the Server is the owner aggregate view: device presence, policy, maintenance, activity and fleet/session observability. In the future Account Portal, normal users see all devices bound to their account; VIP adds the convenience multi-device Wall used by the owner reference environment. Aggregation never merges device identities, leases, grants or session authority.

Hosted Wall authentication remains independent local auth in the current self-hosted reference deployment: scrypt password verification plus a signed `HttpOnly + Secure + SameSite=Strict` cookie and login throttling. NetBird may remain as an optional outer layer. The hosted `/plus-authorize` page is informational only; Device Access approval must come from the selected device Local Wall.

Wall SSE is the primary live path for hosted observability. A lightweight activity-head probe is only a missed-event detector; it triggers bounded catch-up when needed and must not become a high-frequency worker loop.

## Development transport rule
For the owner’s current ChatGPT Plus workflow, normal development calls must dogfood `@Vercel -> /api/operator?via=plus -> A/B pairing -> Agent client authorized set -> Device Access Grant -> ARM Hub`. A fresh chat asks for A, calls connect directly, waits for B approval, then lists/routes only its authorized devices and performs durable Agent work without RDC.

Structured POST remains the normal transport for native/internal clients. GET/query/base64 is an explicit Plus compatibility adapter only. It is bounded, `no-store`, uses semantic idempotency, and may carry only short-lived pairing/continuation/client capabilities plus bounded operation payloads. It must never carry owner credentials, private keys or cookies. RDC is rescue-only during the cutoff window and is not an acceptance dependency.

Audit is authoritative on VPS JSONL. ARM is the live Hub and `VPS-AMD` is the first accepted outbound leaf. Explicit leaf targets fail closed when offline/draining; there is no silent fallback. See `CURRENT_STATE.md`, `FLEET_ROUTING_V0_8.md`, `PLATFORM_ADAPTERS_V0_9.md`, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, and `PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`.

## Device enrollment (v0.7)
`operator-agent login` generates the device Ed25519 private key locally and starts a short-lived device-code flow. The activation URL carries only the enrollment ID; the one-time code is entered after owner authentication. Approval binds the public key and an explicit capability subset but leaves the device offline until signed heartbeat proof succeeds. Owner-authenticated cancel/revoke paths provide cleanup. v0.8 now uses that enrolled identity for the signed outbound leaf channel.

## Fleet routing (v0.8)
Leaf agents connect outbound directly to ARM Hub using Ed25519-signed `poll/result` requests; Vercel remains only the ChatGPT/owner-facing bridge. Open leaf sessions with an explicit `nodeId`, preserve that target on exec, and never retry a failed leaf request by silently switching to ARM. `action=fleet` reads Hub routing state and owner-authenticated `action=node-drain` controls safe drain. The Linux agent command spool is local and `0600`; command redelivery plus completed-result receipts are idempotent.

## Platform adapters (v0.9 preview)
The signed v0.8 fleet protocol is unchanged; v0.9 moves leaf execution behind platform adapters. Each device re-infers capabilities from the script before spawn and unions them with caller-declared `requiredCapabilities`, so caller metadata cannot hide Git/build/privileged/native requirements from the local policy boundary.

Linux remains the primary adapter. Installs derive systemd `NoNewPrivileges` from effective local capability state: it stays `true` by default and becomes `false` only when `sudo-on-demand` is owner-approved and not locally denied. The AMD x86_64 live migration is now complete through the structured Wall maintenance lane. Signed `0.9.0-rc.1` acceptance updated the real leaf, and a signed-but-broken `0.9.0-rc.2` proved automatic rollback to a stable `rc.1` service. See `LINUX_SIGNED_UPDATE_V0_9_ACCEPTANCE_2026-09-10.md`.

Windows x64 is live-accepted through the public production Vercel -> ARM Hub route. DEV persistence uses a per-user Scheduled Task with Interactive logon and Limited run level, requires no Windows password/PIN, and is online while the enrolled user is signed in. Password-backed Windows Service mode remains optional and never defaults to LocalSystem. Live proof covers PowerShell/host identity, filesystem, Git + bundled Node, process/network inspection, Services read, Event Log read, and winget. macOS is deferred by product-owner decision. See `PLATFORM_ADAPTERS_V0_9.md`.
