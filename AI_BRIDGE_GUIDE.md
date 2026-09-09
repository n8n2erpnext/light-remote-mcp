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
Vercel OIDC authenticates the bridge. Privileged bodies are protected with X25519 + HKDF-SHA256 + AES-256-GCM, replay rejection and semantic `operationId` idempotency. The Internet-facing gateway stays unprivileged; the host executor runs as `ubuntu` with sudo-on-demand. Never place passwords, tokens, private keys, cookies or bearer tokens in URL query strings.

## Observability / hub
The NetBird-PIN-protected wall is read-only and has `ALL` plus per-session tabs. Audit is authoritative on VPS JSONL. v0.5 carries `nodeId=arm` through session/job/log metadata and reserves ARM as the future control hub; see `HUB_TOPOLOGY_V0_5.md`. AMD/HomeLab remote execution is a future transport stage, not claimed active today.

RDC remains a temporary rescue route during soak.
