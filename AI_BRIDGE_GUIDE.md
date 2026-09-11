# Light Remote MCP — START HERE

This Vercel project is the approved ChatGPT-facing relay into the owner's ARM operator hub.

Active path:
`ChatGPT -> @Vercel -> light-remote-mcp.vercel.app -> ARM hub -> selected executor`

## New agent startup — ChatGPT Plus / @Vercel
1. Fetch `https://light-remote-mcp.vercel.app/api/guide` and follow its `plusBridge` contract. Do not ask the owner for Wall credentials.
2. Generate one opaque stable `agentId` for this ChatGPT chat/window (16–128 safe characters).
3. Call `GET /api/operator?via=plus&action=devices-bootstrap`. This is pre-authorization inventory only: choose one explicit device and verify its finite cloud connection is `connected`. If it is Dormant, the owner must open that device Local Wall/App and press **Connect** first.
4. Call `authorize-begin` with base64url `{agentId,label,deviceId}`. If that device already has a valid Device Access Grant for its current connection lease, the response is immediately `approved` and returns a new `ps` capability for the same grant. No owner prompt is needed for another ChatGPT window.
5. If the response is `pending`, retain `requestId + pollToken` privately, show the one-time code to the owner, and tell them to open the selected device Wall at `/approve`. The bridge returns only the relative `approvalPath`; it must not invent a localhost or hosted activation URL because each device may expose Wall through localhost, a private/VPN address, or the owner's reverse proxy.
6. On `/approve`, the owner enters the code and chooses **Approve** or **Deny**. No time, Connect, lease or session-duration selection is shown. Device approval is Ed25519-signed by the enrolled device service; success returns the browser to the device Wall root. The authorization request expires after ten minutes.
7. After approval, call `authorize-poll` with `{requestId,pollToken}`. The returned `ps` is scoped to `grantId + deviceId + connectionId`; it expires no later than the finite Device Connection Lease. Human approval has no separate fixed one-hour lifetime.
8. Open the durable Agent lane with `session-open` and retain `sessionId`. The `ps` fixes one device; a session-open/exec attempt targeting another node fails closed.
9. Send the same `agentId + sessionId` for exec/job/output/resume/hold/close. Use a stable `operationId` for exec retries. If the ChatGPT transport disappears, the Agent lane moves to HOLD and may resume inside its 15–60 minute reconnect grace.
10. If an Agent lane closes but the Device Access Grant and Device Connection Lease are still valid, a later ChatGPT window may obtain another `ps` for that device without re-approval. If the device disconnects, its hard lease expires, it is revoked, or its connection identity changes, the grant and all Agent lanes on that device are terminal; the next tool use requires a new Local Wall approval.

The Plus compatibility lane is GET-only because the current `@Vercel` fetch surface cannot provide arbitrary application POST/header calls. Query payloads may carry only the one-time poll token, the device-grant-scoped `ps`, and bounded base64url request bodies. Owner passwords, private keys, Wall cookies and long-lived credentials never belong in URLs.

### Legacy/reference operator clients
Non-Plus clients that can issue arbitrary POST requests may still use `POST /api/auth` and `x-bridge-session`. That is a compatibility lane, not the current ChatGPT Plus startup flow.

## Session semantics
A durable Agent lane is keyed by `(deviceId, agentId)`, not by `agentId` globally. The same ChatGPT Agent may own one lane on ARM and a separate lane on AMD/Windows without target mutation; each lane remains bound to one exact device/node. Different ChatGPT windows use different `agentId` values and may coexist under one approved Device Access Grant.

Agent inactivity uses reconnect/HOLD grace only: 15, 30, 45 or 60 minutes. There is no Unlimited Agent session. Active jobs may HOLD a lane so transport loss does not duplicate work. When a lane expires, it is terminal; returning inside grace resumes the same lane, returning after expiry opens a new Agent lane. Human re-approval is still unnecessary while the parent Device Access Grant remains valid.

Device lifetime is a separate authority. The always-alive local service may be running while the cloud is Dormant. A user-created Device Connection Lease opens cloud traffic for a finite hard window (reference caps: Free 4h, Pro 24h, VIP 72h); tool activity cannot silently extend that hard limit. If no Agent lane remains and no tool activity occurs for the configured 15–60 minute grace, the Device Access Grant expires, but the Device Connection Lease remains until explicit Disconnect/revoke/authority failure or its hard expiry. Hard expiry closes the device connection, its Device Access Grant and every Agent lane on that device.

## Security / execution
There is no static shared Bearer boundary. For ChatGPT Plus, exact Vercel OIDC is necessary but not sufficient. Execution also requires a server-validated Device Access Grant scoped to the selected device and its current `connectionId`. Approval is produced from the enrolled device Local Wall through an Ed25519-signed device-channel operation; the hosted Wall cannot mint that approval.

The `ps` token is cryptographically domain-separated from Wall cookies, legacy bridge sessions and direct MCP OAuth tokens. It carries only device-grant scope and is bounded by the Device Connection Lease. It is intentionally **not agent-bound**: several ChatGPT windows may obtain their own `ps` tokens for the same already-approved device grant, while their actual durable Agent sessions remain independently owned and target-bound.

Privileged bodies remain protected with X25519 + HKDF-SHA256 + AES-256-GCM, replay rejection and semantic `operationId` idempotency. Signed device policy and device-side capability inference remain the final execution boundary. A grant for ARM cannot open, resume, inspect or execute an AMD/Windows lane; gateway and operator-host both verify device binding.

## Wall / observability
There are two distinct control surfaces. **Local Wall** is served by the always-alive client service and is scoped to exactly one device. It keeps the operator-stream/session-lane/history experience of the reference Wall: live command/output, Agent lanes, device/cloud state, policy/capability context and maintenance. It may be exposed on localhost, a private/NetBird address, or behind the owner's reverse proxy. Wall is observer/control only: closing the tab/browser does not affect the service, cloud lease, grant, Agent sessions or durable jobs. Pending access is handled at `/approve` by entering the short code and choosing Approve/Deny.

The hosted/reference Wall on the Server is the owner aggregate view: device presence, policy, maintenance, activity and fleet/session observability. In the future Account Portal, normal users see all devices bound to their account; VIP adds the convenience multi-device Wall used by the owner reference environment. Aggregation never merges device identities, leases, grants or session authority.

Hosted Wall authentication remains independent local auth in the current self-hosted reference deployment: scrypt password verification plus a signed `HttpOnly + Secure + SameSite=Strict` cookie and login throttling. NetBird may remain as an optional outer layer. The hosted `/plus-authorize` page is informational only; Device Access approval must come from the selected device Local Wall.

Wall SSE is the primary live path for hosted observability. A lightweight activity-head probe is only a missed-event detector; it triggers bounded catch-up when needed and must not become a high-frequency worker loop.

## Development transport rule
For the owner’s current ChatGPT Plus workflow, normal development calls must dogfood `@Vercel -> /api/operator?via=plus -> Device Access Grant -> ARM Hub`. A fresh chat must bootstrap devices, explicitly select one connected device, attach to an existing grant or request Local Wall approval, then open/resume/close durable Agent lanes, execute work and read durable output without RDC.

Structured POST remains the normal transport for native/internal clients. GET/query/base64 is an explicit Plus compatibility adapter only. It is bounded, `no-store`, uses semantic idempotency, and may carry only a one-time polling capability or the scoped `ps` token. It must never carry owner credentials, private keys or cookies. RDC is rescue-only during the cutoff window and is not an acceptance dependency.

Audit is authoritative on VPS JSONL. ARM is the live Hub and `VPS-AMD` is the first accepted outbound leaf. Explicit leaf targets fail closed when offline/draining; there is no silent fallback. See `CURRENT_STATE.md`, `FLEET_ROUTING_V0_8.md`, `PLATFORM_ADAPTERS_V0_9.md`, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, and `PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`.

## Device enrollment (v0.7)
`operator-agent login` generates the device Ed25519 private key locally and starts a short-lived device-code flow. The activation URL carries only the enrollment ID; the one-time code is entered after owner authentication. Approval binds the public key and an explicit capability subset but leaves the device offline until signed heartbeat proof succeeds. Owner-authenticated cancel/revoke paths provide cleanup. v0.8 now uses that enrolled identity for the signed outbound leaf channel.

## Fleet routing (v0.8)
Leaf agents connect outbound directly to ARM Hub using Ed25519-signed `poll/result` requests; Vercel remains only the ChatGPT/owner-facing bridge. Open leaf sessions with an explicit `nodeId`, preserve that target on exec, and never retry a failed leaf request by silently switching to ARM. `action=fleet` reads Hub routing state and owner-authenticated `action=node-drain` controls safe drain. The Linux agent command spool is local and `0600`; command redelivery plus completed-result receipts are idempotent.

## Platform adapters (v0.9 preview)
The signed v0.8 fleet protocol is unchanged; v0.9 moves leaf execution behind platform adapters. Each device re-infers capabilities from the script before spawn and unions them with caller-declared `requiredCapabilities`, so caller metadata cannot hide Git/build/privileged/native requirements from the local policy boundary.

Linux remains the primary adapter. Installs derive systemd `NoNewPrivileges` from effective local capability state: it stays `true` by default and becomes `false` only when `sudo-on-demand` is owner-approved and not locally denied. The AMD x86_64 live migration is now complete through the structured Wall maintenance lane. Signed `0.9.0-rc.1` acceptance updated the real leaf, and a signed-but-broken `0.9.0-rc.2` proved automatic rollback to a stable `rc.1` service. See `LINUX_SIGNED_UPDATE_V0_9_ACCEPTANCE_2026-09-10.md`.

Windows x64 is live-accepted through the public production Vercel -> ARM Hub route. DEV persistence uses a per-user Scheduled Task with Interactive logon and Limited run level, requires no Windows password/PIN, and is online while the enrolled user is signed in. Password-backed Windows Service mode remains optional and never defaults to LocalSystem. Live proof covers PowerShell/host identity, filesystem, Git + bundled Node, process/network inspection, Services read, Event Log read, and winget. macOS is deferred by product-owner decision. See `PLATFORM_ADAPTERS_V0_9.md`.
