# Light Remote MCP — START HERE

This Vercel project is the approved ChatGPT-facing relay into the owner's ARM operator hub.

Active path:
`ChatGPT -> @Vercel -> light-remote-mcp.vercel.app -> ARM hub -> selected executor`

## New agent startup — ChatGPT Plus / @Vercel
1. Fetch `https://light-remote-mcp.vercel.app/api/guide` and follow its `plusBridge` contract. Do not ask the owner for Wall credentials.
2. Generate one opaque stable `agentId` for this chat (16–128 safe characters).
3. Call `GET /api/operator?via=plus&action=authorize-begin&p=<base64url-json>` with `{agentId,label}`. The response contains a one-time code, polling token and Wall approval URL. Never expose the polling token in prose.
4. Ask the owner to open the returned Wall URL and approve only if the displayed code matches. The authorization request expires after ten minutes.
5. After owner approval, call `authorize-poll` once with `{requestId,pollToken}`. Retain the returned short-lived `ps` capability privately for this chat; default lifetime is one hour. It is not a password and must not be logged or echoed.
6. Use `GET /api/operator?via=plus&ps=<session>&action=devices` or `fleet`, choose the exact target, then generate one stable `openId` for the session-open attempt.
7. Open the durable operator lane with `action=session-open&p=<base64url-json>` and retain the server-issued `sessionId`. Omit `nodeId` only for ARM-local compatibility; specify leaf targets explicitly.
8. Send the same `agentId + sessionId` for exec/job/output/resume/close calls. `exec` also uses a stable `operationId`; retry the same semantic operation with the same ID.
9. On transient transport loss, resume the same durable session. If `ps` expires, start a new owner-approval pairing; do not fall back to anonymous execution or a different device.

The Plus compatibility lane is GET-only because the current `@Vercel` fetch surface cannot provide arbitrary application POST/header calls. The query may carry only the short-lived owner-approved Plus capability and bounded base64url request payload. Owner passwords, private keys, Wall cookies and long-lived credentials never belong in URLs.

### Legacy/reference operator clients
Non-Plus clients that can issue arbitrary POST requests may still use `POST /api/auth` and `x-bridge-session`. That is a compatibility lane, not the current ChatGPT Plus startup flow.

## Session semantics
One agent owns one live session on one target node. A same-agent repeat open returns the existing lane only for the same target; cross-target reuse is rejected. A different agent trying to use that session is rejected with `409 session_owner_mismatch`. Idle grace is 30 minutes, active jobs HOLD the lane regardless of transport, and the final job gives a fresh 30-minute grace. ARM local ceiling is 5; leaves advertise their own per-node ceiling.

## Security / execution
There is no static shared Bearer boundary. For ChatGPT Plus, ARM accepts an exact Vercel OIDC caller for the configured project/environment, but that identity alone cannot operate devices: the owner must also approve a short-lived Plus session in Wall. The Plus session is cryptographically domain-separated from Wall cookies, bridge sessions and OAuth tokens and is bound to the chat's `agentId`; session-open and subsequent durable session ownership enforce the same agent identity.

Privileged bodies remain protected with X25519 + HKDF-SHA256 + AES-256-GCM, replay rejection and semantic `operationId` idempotency. Signed device policy and device-side capability inference are the final execution boundary. The legacy `x-bridge-session` and direct MCP OAuth lanes remain separate compatibility/test surfaces; the future public App/Plugin replaces the Vercel compatibility adapter with account/device authorization and ChatGPT permission semantics.

## Wall / observability
Wall is an authenticated owner control plane with `ALL` plus per-session tabs. It is not a generic shell/executor: mutations are explicit structured actions such as Device Policy changes and `Run signed update now`, each bounded by server/device policy and fully audited. Wall never owns device/session lifetime. Independent local auth is active even without NetBird: scrypt password verification plus a signed `HttpOnly + Secure + SameSite=Strict` session cookie and login throttling. NetBird may remain as an optional outer layer.

The bootstrap password itself is never stored in Git or logs. On the VPS it is temporarily available only in `/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password` with mode `0600`; the auth config is `/home/ubuntu/.config/gpt-vps-operator/wall-auth.json`, also `0600`. After the owner stores the password safely, delete only the plaintext bootstrap file, not `wall-auth.json`.

Wall SSE is the primary live path. A 1-second lightweight activity-head probe is only a missed-event detector; it triggers bounded catch-up when needed. It does not keep a session alive and must not become a high-frequency worker loop.

## Development transport rule
For the owner’s current ChatGPT Plus workflow, normal development calls must dogfood `@Vercel -> /api/operator?via=plus -> owner-approved Plus session -> ARM Hub`. A fresh chat must be able to pair, select ARM/AMD/Windows explicitly, open/resume/close durable sessions, execute work and read durable output without RDC.

Structured POST remains the normal transport for native/internal clients. GET/query/base64 is an explicit Plus compatibility adapter only. It is bounded, `no-store`, uses semantic idempotency, and may carry only the short-lived pairing/session capability required because the current connector is GET-only. It must never carry owner credentials, private keys or cookies. RDC is rescue-only during the cutoff window and is not an acceptance dependency.

Audit is authoritative on VPS JSONL. ARM is the live Hub and `VPS-AMD` is the first accepted outbound leaf. Explicit leaf targets fail closed when offline/draining; there is no silent fallback. See `CURRENT_STATE.md`, `FLEET_ROUTING_V0_8.md`, `PLATFORM_ADAPTERS_V0_9.md`, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, and `PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`.

## Device enrollment (v0.7)
`operator-agent login` generates the device Ed25519 private key locally and starts a short-lived device-code flow. The activation URL carries only the enrollment ID; the one-time code is entered after owner authentication. Approval binds the public key and an explicit capability subset but leaves the device offline until signed heartbeat proof succeeds. Owner-authenticated cancel/revoke paths provide cleanup. v0.8 now uses that enrolled identity for the signed outbound leaf channel.

## Fleet routing (v0.8)
Leaf agents connect outbound directly to ARM Hub using Ed25519-signed `poll/result` requests; Vercel remains only the ChatGPT/owner-facing bridge. Open leaf sessions with an explicit `nodeId`, preserve that target on exec, and never retry a failed leaf request by silently switching to ARM. `action=fleet` reads Hub routing state and owner-authenticated `action=node-drain` controls safe drain. The Linux agent command spool is local and `0600`; command redelivery plus completed-result receipts are idempotent.

## Platform adapters (v0.9 preview)
The signed v0.8 fleet protocol is unchanged; v0.9 moves leaf execution behind platform adapters. Each device re-infers capabilities from the script before spawn and unions them with caller-declared `requiredCapabilities`, so caller metadata cannot hide Git/build/privileged/native requirements from the local policy boundary.

Linux remains the primary adapter. Installs derive systemd `NoNewPrivileges` from effective local capability state: it stays `true` by default and becomes `false` only when `sudo-on-demand` is owner-approved and not locally denied. The AMD x86_64 live migration is now complete through the structured Wall maintenance lane. Signed `0.9.0-rc.1` acceptance updated the real leaf, and a signed-but-broken `0.9.0-rc.2` proved automatic rollback to a stable `rc.1` service. See `LINUX_SIGNED_UPDATE_V0_9_ACCEPTANCE_2026-09-10.md`.

Windows x64 is live-accepted through the public production Vercel -> ARM Hub route. DEV persistence uses a per-user Scheduled Task with Interactive logon and Limited run level, requires no Windows password/PIN, and is online while the enrolled user is signed in. Password-backed Windows Service mode remains optional and never defaults to LocalSystem. Live proof covers PowerShell/host identity, filesystem, Git + bundled Node, process/network inspection, Services read, Event Log read, and winget. macOS is deferred by product-owner decision. See `PLATFORM_ADAPTERS_V0_9.md`.
