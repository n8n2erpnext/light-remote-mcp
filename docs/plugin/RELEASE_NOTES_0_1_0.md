# Light Remote Plugin 0.1.0 — Submission Release Notes

Initial public OpenAI plugin submission candidate.

- Adds a public Universal MCP endpoint at `https://light-remote.thaiduy.digital/mcp`.
- Adds OAuth 2.1 authorization-code authentication with PKCE S256, DCR, resource binding, scoped access tokens, and rotating refresh tokens.
- Adds OpenID Connect discovery and a scoped UserInfo endpoint (`openid` + `email`) so ChatGPT can obtain a verified account email for workspace domain restrictions; ID tokens remain optional.
- Advertises per-tool OAuth `securitySchemes` and enforces OAuth at the MCP HTTP boundary with `401 Unauthorized` + `WWW-Authenticate` protected-resource discovery before any protected MCP request reaches a tool.
- Exposes 20 account-scoped MCP tools: the original 14 execution/recovery tools plus Connection Helper, Device Inspector, Recent Activity, Set Main, Revoke Device, and Remove Device so the reviewer can see and exercise Light Remote governance and Fleet lifecycle rather than only the execution surface.
- Adds explicit worst-case MCP annotations for read-only, destructive, and open-world behavior.
- Sanitizes MCP responses to omit credentials, cryptographic material, transport telemetry, and unnecessary account identifiers.
- Adds an isolated full-product reviewer installation with a VIP reviewer account, integrated `review-main`, independent outbound `review-leaf`, Local Wall/Fleet, policy, activity, and updater/helper state. Reviewer data remains sandboxed and privileged leaf administration remains denied.
- Uses `https://light-remote.thaiduy.digital` as the canonical direct reviewer origin with no Vercel dependency in the review path.
- Adds public support, privacy, terms, OAuth discovery, and domain-verification endpoints.
- Adds production account/device onboarding on the same public origin, with account-scoped hosted enrollment approval and signed Ed25519 device channels.
- Makes operator routing multi-account aware without weakening the integrated-host boundary: account identity follows device binding through route, session, job, and fleet command/result.
- Adds hosted acceptance covering a second account from enrollment through signed connect, durable session, remote job dispatch/result, output recovery, and cross-account denial.
- Adds four portable skills covering connection/onboarding, remote operations, Fleet/device governance, and policy/observability.
