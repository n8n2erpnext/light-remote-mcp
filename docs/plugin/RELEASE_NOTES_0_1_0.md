# Light Remote Plugin 0.1.0 — Submission Release Notes

Initial public OpenAI plugin submission candidate.

- Adds a public Universal MCP endpoint at `https://plugin.thaiduy.digital/mcp`.
- Adds OAuth 2.1 authorization-code authentication with PKCE S256, DCR, resource binding, scoped access tokens, and rotating refresh tokens.
- Advertises per-tool OAuth `securitySchemes` and runtime `mcp/www_authenticate` challenges.
- Exposes 14 account-scoped MCP tools for device discovery, durable sessions, filesystem work, managed processes, command execution, PTY/ConPTY terminals, and durable job/output recovery.
- Adds explicit worst-case MCP annotations for read-only, destructive, and open-world behavior.
- Sanitizes MCP responses to omit credentials, cryptographic material, transport telemetry, and unnecessary account identifiers.
- Adds an isolated reviewer sandbox with only filesystem, git, build-test, and terminal capabilities.
- Uses a direct ARM/LXD review path with no Vercel dependency.
- Adds public support, privacy, terms, OAuth discovery, and domain-verification endpoints.
- Adds production account/device onboarding on the same public origin, with account-scoped hosted enrollment approval and signed Ed25519 device channels.
- Makes operator routing multi-account aware without weakening the integrated-host boundary: account identity follows device binding through route, session, job, and fleet command/result.
- Adds hosted acceptance covering a second account from enrollment through signed connect, durable session, remote job dispatch/result, output recovery, and cross-account denial.
