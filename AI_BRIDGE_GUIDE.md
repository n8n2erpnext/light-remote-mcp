# GPT VPS Bridge — START HERE

This Vercel project is the approved ChatGPT-facing relay into the owner's ARM operator hub.

Active path:
`ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> ARM hub -> selected executor`

## New agent startup
1. Fetch public `https://gpt-vps-bridge.vercel.app/api/guide`.
2. Obtain a short-lived bridge session through `POST /api/auth` using the current local operator login; do not put credentials in a URL.
3. Send the returned value as `x-bridge-session` on protected read/operator calls.
4. Generate one opaque random `agentId` for this agent/chat and one stable `openId` for the open attempt.
5. Open a session and retain the returned server-issued `sessionId`. Omit `nodeId` only for ARM-local compatibility; for a leaf, specify its exact `nodeId`.
6. Send `agentId + sessionId` on operator exec/job/output/resume calls and tracked reads. Keep the session target fixed; leaf exec may also declare `requiredCapabilities`.
7. On transient network loss, resume the same session with the same agentId; if the bridge session expires, re-authenticate, and if the operator lane expired, open a new lane.
8. Prefer grouped `exec_batch` operations when commands logically belong together.

## Session semantics
One agent owns one live session on one target node. A same-agent repeat open returns the existing lane only for the same target; cross-target reuse is rejected. A different agent trying to use that session is rejected with `409 session_owner_mismatch`. Idle grace is 30 minutes, active jobs HOLD the lane regardless of transport, and the final job gives a fresh 30-minute grace. ARM local ceiling is 5; leaves advertise their own per-node ceiling.

## Security / execution
v0.6 removes the static shared Bearer boundary. During production testing, ARM mints a separate 15-minute bridge session only after the local operator credential check; Vercel merely relays the login and forwards `x-bridge-session`. ARM validates both Vercel OIDC and that short-lived session before protected operator/MCP tool calls. Wall cookies are cryptographically domain-separated from bridge sessions. Privileged bodies remain protected with X25519 + HKDF-SHA256 + AES-256-GCM, replay rejection and semantic `operationId` idempotency. The public App/Plugin later replaces this temporary login-mint step with account/device OAuth and ChatGPT permission semantics.

## Wall / observability
Wall is read-only and has `ALL` plus per-session tabs. Independent local auth is active even without NetBird: scrypt password verification plus a signed `HttpOnly + Secure + SameSite=Strict` session cookie and login throttling. NetBird may remain as an optional outer layer.

The bootstrap password itself is never stored in Git or logs. On the VPS it is temporarily available only in `/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password` with mode `0600`; the auth config is `/home/ubuntu/.config/gpt-vps-operator/wall-auth.json`, also `0600`. After the owner stores the password safely, delete only the plaintext bootstrap file, not `wall-auth.json`.

Wall SSE is the primary live path. A 1-second lightweight activity-head probe is only a missed-event detector; it triggers bounded catch-up when needed. It does not keep a session alive and must not become a high-frequency worker loop.

## Development transport rule
Use the Vercel bridge directly for normal development calls; v0.6 does not require a static shared caller Bearer. Protected calls do require the short-lived `x-bridge-session` minted through `/api/auth`. Preview Deployment Protection may still gate preview URLs independently at the Vercel platform layer. Self-disruptive gateway work uses RDC only for the disruptive step.

The v0.6 branch includes body-safe structured POST transport for `/api/operator`; GET/query/base64 remains legacy compatibility only and is capped to small payloads with deterministic `414 payload_too_large_use_post`. Do not move credentials or private material into query strings. RDC remains the rescue lane for self-disruptive deployment/rebuild steps.

Audit is authoritative on VPS JSONL. ARM is the live Hub and `VPS-AMD` is the first accepted outbound leaf. Explicit leaf targets fail closed when offline/draining; there is no silent fallback. See `CURRENT_STATE.md`, `FLEET_ROUTING_V0_8.md`, `PLATFORM_ADAPTERS_V0_9.md`, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, and `PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`.

## Device enrollment (v0.7)
`operator-agent login` generates the device Ed25519 private key locally and starts a short-lived device-code flow. The activation URL carries only the enrollment ID; the one-time code is entered after owner authentication. Approval binds the public key and an explicit capability subset but leaves the device offline until signed heartbeat proof succeeds. Owner-authenticated cancel/revoke paths provide cleanup. v0.8 now uses that enrolled identity for the signed outbound leaf channel.

## Fleet routing (v0.8)
Leaf agents connect outbound directly to ARM Hub using Ed25519-signed `poll/result` requests; Vercel remains only the ChatGPT/owner-facing bridge. Open leaf sessions with an explicit `nodeId`, preserve that target on exec, and never retry a failed leaf request by silently switching to ARM. `action=fleet` reads Hub routing state and owner-authenticated `action=node-drain` controls safe drain. The Linux agent command spool is local and `0600`; command redelivery plus completed-result receipts are idempotent.

## Platform adapters (v0.9 preview)
The signed v0.8 fleet protocol is unchanged; v0.9 moves leaf execution behind platform adapters. Each device re-infers capabilities from the script before spawn and unions them with caller-declared `requiredCapabilities`, so caller metadata cannot hide Git/build/privileged/native requirements from the local policy boundary.

Linux remains the primary adapter. Future installs derive systemd `NoNewPrivileges` from effective local capability state: it stays `true` by default and becomes `false` only when `sudo-on-demand` is owner-approved and not locally denied. AMD x86_64 source/full-suite testing is green, but its already-running legacy v0.8 unit still needs one external privileged maintenance step before live v0.9 migration because that unit cannot relax its own NNP bit.

Windows x64 is live-accepted through the public production Vercel -> ARM Hub route. DEV persistence uses a per-user Scheduled Task with Interactive logon and Limited run level, requires no Windows password/PIN, and is online while the enrolled user is signed in. Password-backed Windows Service mode remains optional and never defaults to LocalSystem. Live proof covers PowerShell/host identity, filesystem, Git + bundled Node, process/network inspection, Services read, Event Log read, and winget. macOS is deferred by product-owner decision. See `PLATFORM_ADAPTERS_V0_9.md`.
