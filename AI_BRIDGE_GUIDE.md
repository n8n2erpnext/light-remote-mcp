# GPT VPS Bridge — START HERE

This Vercel project is the approved ChatGPT-facing relay into the owner's ARM operator hub.

Active path:
`ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> ARM hub -> selected executor`

## New agent startup
1. Fetch public `https://gpt-vps-bridge.vercel.app/api/guide`.
2. Establish an authenticated caller channel that can send `Authorization: Bearer ...`; never place the caller secret in a URL/query.
3. Generate one opaque random `agentId` for this agent/chat and one stable `openId` for the open attempt.
4. Open a session and retain the returned server-issued `sessionId`.
5. Send `agentId + sessionId` on all operator exec/job/output/resume calls and on tracked read calls.
6. On transient network loss, resume the same session with the same agentId; if it has expired, open a new lane.
7. Prefer grouped `exec_batch` operations when commands logically belong together.

## Session semantics
One agent owns one live session. A same-agent repeat open returns the existing lane; a different agent trying to use that session is rejected with `409 session_owner_mismatch`. Idle grace is 30 minutes, active jobs HOLD the lane regardless of transport, and the final job gives a fresh 30-minute grace. Current live-session ceiling is 5.

## Security / execution
v0.5.1 requires caller authentication at the Vercel bridge **before** the function obtains Vercel OIDC for ARM. `VPS_BRIDGE_CALLER_SECRET` backs an `Authorization: Bearer` boundary and the bridge fails closed if that secret is unset or invalid. Vercel OIDC then authenticates the bridge to ARM; it is not treated as proof of the original internet caller. Privileged bodies remain protected with X25519 + HKDF-SHA256 + AES-256-GCM, replay rejection and semantic `operationId` idempotency.

## Wall / observability
Wall is read-only and has `ALL` plus per-session tabs. Independent local auth is active even without NetBird: scrypt password verification plus a signed `HttpOnly + Secure + SameSite=Strict` session cookie and login throttling. NetBird may remain as an optional outer layer.

The bootstrap password itself is never stored in Git or logs. On the VPS it is temporarily available only in `/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password` with mode `0600`; the auth config is `/home/ubuntu/.config/gpt-vps-operator/wall-auth.json`, also `0600`. After the owner stores the password safely, delete only the plaintext bootstrap file, not `wall-auth.json`.

Wall SSE is the primary live path. A 1-second lightweight activity-head probe is only a missed-event detector; it triggers bounded catch-up when needed. It does not keep a session alive and must not become a high-frequency worker loop.

## Development transport rule
Use the Vercel bridge only when the client can send the required caller `Authorization` header. A client that cannot send that header must use RDC as the temporary private rescue lane rather than weakening the boundary or moving the secret into a query string. Self-disruptive gateway work still uses RDC for the disruptive step.

The v0.6 branch now includes body-safe structured POST transport for `/api/operator`; GET/query/base64 remains legacy compatibility only and is capped to small payloads with deterministic `414 payload_too_large_use_post`. Do not move caller secrets into query strings. RDC remains the rescue lane for self-disruptive deployment/rebuild steps.

Audit is authoritative on VPS JSONL. Current node is `arm`; AMD/HomeLab remote execution is future work, not claimed active today. See `CURRENT_STATE.md`, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, and `PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`.
