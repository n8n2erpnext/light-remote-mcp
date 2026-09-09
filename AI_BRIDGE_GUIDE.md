# GPT VPS Bridge — START HERE

This Vercel project is the approved ChatGPT-facing relay for the owner's VPS ARM.

Active path:
`ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> mcp.dashboard.thaiduy.store -> VPS ARM`

## Discovery for a new ChatGPT session

1. Use `@Vercel` and find project `gpt-vps-bridge`.
2. Fetch `https://gpt-vps-bridge.vercel.app/api/guide`.
3. Read `CURRENT_STATE.md` for the active production checkpoint.
4. Follow the endpoint/capability map returned by `/api/guide`.
5. Prefer grouped operations when a task naturally belongs together.

## Current security model

- Vercel Functions obtain Vercel OIDC for audience `https://mcp.dashboard.thaiduy.store`.
- VPS MCP verifies team/project/environment before tool execution.
- Public discovery is allowed; execution requires valid Vercel identity.
- Never place secrets, passwords, private keys, cookies, or bearer tokens in URL query strings.

## Privileged v0.3 design checkpoint

For privileged write/exec/Docker/LXD/sudo work, read:
`SESSION_LANES_V0_4.md` for managed agent sessions, then `BRIDGE_V0_3_ARCHITECTURE_PLAN.md`

Key decisions:
- keep public MCP gateway unprivileged
- run privileged host executor as `ubuntu`
- prefer grouped `exec_batch` operations over many tiny calls
- use deterministic capability/denial reporting
- retain full rotating disk logs and a richer read-only terminal wall
- add application-layer authenticated encryption + replay protection for privileged Vercel-to-executor calls
- never put raw secrets in URL query strings

Production v0.4 session-lane rollout extends the accepted v0.3 operator: Vercel OIDC -> encrypted operator call -> host executor as `ubuntu`. Every logical exec must carry a stable `operationId`; retries reuse it. The wall is read-only and protected by NetBird PIN auth. RDC remains a temporary rescue path during soak.
## Managed sessions
Open one server-issued session per agent lane. Idle sessions expire after 30 minutes, but any running job automatically holds the session until completion; a fresh 30-minute reconnect grace begins after the last job finishes. Normal target is 1–3 agents, with an explicit ceiling of 8 live sessions. No filesystem/Git locks are imposed.
