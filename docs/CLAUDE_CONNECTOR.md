# Connect Light Remote to Claude

Light Remote gives Claude controlled access to **your own** Windows, macOS, and Linux machines via remote Model Context Protocol (MCP). The server routes requests to explicitly authorized devices; the selected device's Local Wall and effective permission policy remain the final authority. No inbound SSH port needs to be opened on a managed machine.

> **Beta / safety:** Light Remote can read and modify files and execute commands if the owner grants the corresponding permissions. Start with read-only checks on a non-critical device. Never grant full terminal or administrative access just to verify the connector.

## Claude on the web (claude.ai), Claude Desktop and mobile

1. Open **Claude → Customize → Connectors → Add custom connector** (wording may vary by plan and client).
2. Name: **Light Remote**.
3. Remote MCP URL: **`https://light-remote.thaiduy.digital/mcp`**.
4. Sign in with your Light Remote account through the OAuth window; review the permissions Claude requests.
5. On the device you want Claude to use, open its **Local Wall**, start the official device A/B approval flow, and approve the device-specific B code when Claude's connection helper requests it.
6. Ask Claude to read a harmless directory listing or desktop status. Review tool permission prompts before allowing writes or system changes.

Light Remote account authentication and device A/B approval are **separate** steps. Signing in to Claude does not grant automatic authority over any device. Sessions and elevated capabilities are bounded by local policy and authorization lifetime.

## Claude Code (optional)

Run:

```sh
claude mcp add --transport http light-remote https://light-remote.thaiduy.digital/mcp
```

Alternatively, use this repository's [`.mcp.json`](../.mcp.json) as a project-level MCP configuration. Follow the OAuth authentication prompt, then the same device-local A/B approval flow. On Claude Code, use `/mcp` to check connection status.

## Verification without modifying the machine

Ask Claude: "Connect to Light Remote on my explicitly approved device. List one safe directory, show the current user with an unprivileged command if shell permission is granted, and read desktop status without attaching or sending input. Report the exact target device and any denied capability."

Expected behavior:

- The device must be explicitly selected and authorized; no silent fallback to another machine.
- Read-only tools and shell execution may require different grants.
- A denied operation must fail cleanly without attempting privilege escalation.
- Desktop status is not the same as live desktop attach, keyboard or mouse permission.

## Security and support

- **Account sign-in**: OAuth over HTTPS. **Device authorization**: owner-controlled A/B approval.
- **Execution boundary**: exact target device, bounded session, local policy, audit trail.
- **Revocation**: manage connections and policy in your Light Remote account and Local Wall.
- **Website**: https://light-remote.thaiduy.digital
- **Support**: https://light-remote.thaiduy.digital/support
- **Privacy**: https://light-remote.thaiduy.digital/privacy
- **Terms**: https://light-remote.thaiduy.digital/terms

### Directory publication status

This is a public connector setup document, **not** a claim that Anthropic has reviewed or listed Light Remote. A directory listing requires a separate developer submission and Anthropic approval. The production endpoint above is used for customer connections; the `gold.light-remote.thaiduy.digital` endpoint is a separate test environment and should not be placed in a public listing.
