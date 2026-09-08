# GPT VPS Bridge — START HERE

This Vercel project is the approved ChatGPT-facing relay for the owner's VPS ARM.

Active path:
`ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> mcp.dashboard.thaiduy.store -> VPS ARM`

## Discovery for a new ChatGPT session

1. Use `@Vercel` and find project `gpt-vps-bridge`.
2. Fetch `https://gpt-vps-bridge.vercel.app/api/guide`.
3. Follow the endpoint/capability map returned there.
4. Prefer grouped operations when a task naturally belongs together.

## Current security model

- Vercel Functions obtain Vercel OIDC for audience `https://mcp.dashboard.thaiduy.store`.
- VPS MCP verifies team/project/environment before tool execution.
- Public discovery is allowed; execution requires valid Vercel identity.
- Never place secrets, passwords, private keys, cookies, or bearer tokens in URL query strings.

## Privileged v0.3 design checkpoint

Before enabling write/exec/Docker/LXD/sudo capabilities, read:
`BRIDGE_V0_3_ARCHITECTURE_PLAN.md`

Key decisions:
- keep public MCP gateway unprivileged
- run privileged host executor as `ubuntu`
- prefer grouped `exec_batch` operations over many tiny calls
- use deterministic capability/denial reporting
- retain full rotating disk logs and a richer read-only terminal wall
- add application-layer authenticated encryption + replay protection for privileged Vercel-to-executor calls
- never put raw secrets in URL query strings

Current production remains read-only until these layers are implemented and regression-tested.