# GPT VPS Bridge — Current State

Updated: 2026-09-09
Version: v0.4 production candidate

## Active path
`ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> mcp.dashboard.thaiduy.store -> MCP Gateway -> Unix socket -> gpt-vps-operator (ubuntu)`

## Production facts
- v0.3 operator baseline is production-active and accepted.
- v0.4 adds managed multi-agent session lanes without filesystem/repo locks.
- Session idle grace: 30 minutes. Any running job puts its session in `hold`, so network loss does not expire a 60+ minute build.
- When the final active job finishes, a fresh 30-minute reconnect grace begins.
- Current job timeout remains 2 hours, which also bounds automatic session hold.
- Maximum live sessions: 8 configurable; normal operating target is 1–3 concurrent agents. Idle/expired sessions do not consume live capacity.
- Session history stays queryable in memory for 7 days while authoritative lifecycle/tool-call events remain in rotating VPS JSONL logs.
- Session stats can be reconstructed from disk log rotations after executor restarts.
- No resource locks are imposed; concurrent agents coordinate through normal Git branch/worktree/repository discipline.
- Gateway remains unprivileged/read-only; host executor runs as `ubuntu` with Git/build/test/Docker/LXD/systemctl and sudo-on-demand.
- Caller auth: Vercel OIDC; privileged envelope: X25519 + HKDF-SHA256 + AES-256-GCM with replay rejection and semantic `operationId` idempotency.
- Wall is read-only, NetBird PIN protected, 16 MiB / 5000 event buffer.
- Authoritative audit: `/var/log/gpt-vps-operator/operations.jsonl`, rotate 50 MiB x 3.

## Session state machine
`active -> hold(active job) -> active(post-job grace) -> expired`

Transient transport failure never owns job lifetime. Reconnect uses the same server-issued `sessionId`; if the lease has expired, the agent opens a new session. Explicit close is rejected while a job is still active.

## Recovery order
Fetch `/api/guide`, then read `AI_BRIDGE_GUIDE.md`, this file, `SESSION_LANES_V0_4.md`, and `BRIDGE_V0_3_ARCHITECTURE_PLAN.md`. RDC remains rescue-only during soak.
