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
