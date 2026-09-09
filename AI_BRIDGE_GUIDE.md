# GPT VPS Bridge — START HERE

This Vercel project is the approved ChatGPT-facing relay into the owner's ARM operator hub.

Active path:
`ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> ARM hub -> selected executor`

## New agent startup
1. Fetch public `https://gpt-vps-bridge.vercel.app/api/guide`.
2. Obtain a short-lived bridge session through `POST /api/auth` using the current local operator login; do not put credentials in a URL.
3. Send the returned value as `x-bridge-session` on protected read/operator calls.
4. Generate one opaque random `agentId` for this agent/chat and one stable `openId` for the open attempt.
5. Open a session and retain the returned server-issued `sessionId`.
6. Send `agentId + sessionId` on operator exec/job/output/resume calls and tracked reads.
7. On transient network loss, resume the same session with the same agentId; if the bridge session expires, re-authenticate, and if the operator lane expired, open a new lane.
8. Prefer grouped `exec_batch` operations when commands logically belong together.

## Session semantics
One agent owns one live session. A same-agent repeat open returns the existing lane; a different agent trying to use that session is rejected with `409 session_owner_mismatch`. Idle grace is 30 minutes, active jobs HOLD the lane regardless of transport, and the final job gives a fresh 30-minute grace. Current live-session ceiling is 5.

## Security / execution
v0.6 removes the static shared Bearer boundary. During production testing, ARM mints a separate 15-minute bridge session only after the local operator credential check; Vercel merely relays the login and forwards `x-bridge-session`. ARM validates both Vercel OIDC and that short-lived session before protected operator/MCP tool calls. Wall cookies are cryptographically domain-separated from bridge sessions. Privileged bodies remain protected with X25519 + HKDF-SHA256 + AES-256-GCM, replay rejection and semantic `operationId` idempotency. The public App/Plugin later replaces this temporary login-mint step with account/device OAuth and ChatGPT permission semantics.

## Wall / observability
Wall is read-only and has `ALL` plus per-session tabs. Independent local auth is active even without NetBird: scrypt password verification plus a signed `HttpOnly + Secure + SameSite=Strict` session cookie and login throttling. NetBird may remain as an optional outer layer.

The bootstrap password itself is never stored in Git or logs. On the VPS it is temporarily available only in `/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password` with mode `0600`; the auth config is `/home/ubuntu/.config/gpt-vps-operator/wall-auth.json`, also `0600`. After the owner stores the password safely, delete only the plaintext bootstrap file, not `wall-auth.json`.

Wall SSE is the primary live path. A 1-second lightweight activity-head probe is only a missed-event detector; it triggers bounded catch-up when needed. It does not keep a session alive and must not become a high-frequency worker loop.

## Development transport rule
Use the Vercel bridge directly for normal development calls; v0.6 does not require a static shared caller Bearer. Protected calls do require the short-lived `x-bridge-session` minted through `/api/auth`. Preview Deployment Protection may still gate preview URLs independently at the Vercel platform layer. Self-disruptive gateway work uses RDC only for the disruptive step.

The v0.6 branch includes body-safe structured POST transport for `/api/operator`; GET/query/base64 remains legacy compatibility only and is capped to small payloads with deterministic `414 payload_too_large_use_post`. Do not move credentials or private material into query strings. RDC remains the rescue lane for self-disruptive deployment/rebuild steps.

Audit is authoritative on VPS JSONL. Current node is `arm`; AMD/HomeLab remote execution is future work, not claimed active today. See `CURRENT_STATE.md`, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, and `PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`.
