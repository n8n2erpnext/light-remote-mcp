# GPT VPS Bridge — START HERE

This Vercel project is the approved ChatGPT-facing relay into the owner's ARM operator hub.

Active path:
`ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> ARM hub -> selected executor`

## New agent startup
1. Fetch `https://gpt-vps-bridge.vercel.app/api/guide` with `@Vercel`.
2. Generate one opaque random `agentId` for this agent/chat and one stable `openId` for the open attempt.
3. Open a session and retain the returned server-issued `sessionId`.
4. Send `agentId + sessionId` on all operator exec/job/output/resume calls.
5. Append `sid=<sessionId>&aid=<agentId>` to normal read-only endpoints so read work also renews/audits the lane.
6. On transient network loss, resume the same session with the same agentId; if it has expired, open a new lane.
7. Prefer grouped `exec_batch` operations when commands logically belong together.

## Session semantics
One agent owns one live session. A same-agent repeat open returns the existing lane; a different agent trying to use that session is rejected with `409 session_owner_mismatch`. Idle grace is 30 minutes, active jobs HOLD the lane regardless of transport, and the final job gives a fresh 30-minute grace. Current live-session ceiling is 5.

## Security / execution
Vercel OIDC authenticates operator and MCP tool calls. Privileged bodies are protected with X25519 + HKDF-SHA256 + AES-256-GCM, replay rejection and semantic `operationId` idempotency. The Internet-facing gateway stays unprivileged; the host executor runs as `ubuntu` with sudo-on-demand. Unauthenticated MCP discovery may remain public, but execution/tool calls must not.

## Wall / observability
Wall is read-only and has `ALL` plus per-session tabs. Independent local auth is active even without NetBird: scrypt password verification plus a signed `HttpOnly + Secure + SameSite=Strict` session cookie and login throttling. NetBird may remain as an optional outer layer.

The bootstrap password itself is never stored in Git or logs. On the VPS it is temporarily available only in `/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password` with mode `0600`; the auth config is `/home/ubuntu/.config/gpt-vps-operator/wall-auth.json`, also `0600`. After the owner stores the password safely, delete only the plaintext bootstrap file, not `wall-auth.json`.

Wall SSE is the primary live path. A 1-second lightweight activity-head probe is only a missed-event detector; it triggers bounded catch-up when needed. It does not keep a session alive and must not become a high-frequency worker loop.

## Development transport rule
Use the project path for normal reads, exec, job/output checks and acceptance. If a step rebuilds/restarts the gateway or otherwise disrupts the channel carrying itself, switch to RDC for exactly that step, then return immediately to `@Vercel` and prove end-to-end.

The current `/api/operator` GET/query/base64 transport is bootstrap-only. Keep normal commands small. Do not force large source patches through query strings; use RDC rescue during soak. The public MCP/control product must use Streamable HTTP/POST bodies or another body-safe transport.

Audit is authoritative on VPS JSONL. Current node is `arm`; AMD/HomeLab remote execution is future work, not claimed active today. See `CURRENT_STATE.md`, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, and `PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`.
