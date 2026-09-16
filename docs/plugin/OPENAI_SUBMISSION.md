# OpenAI Plugin Submission — Light Remote

This file is the canonical handoff for creating the public OpenAI plugin draft.

## Submission type

- Type: **With MCP (MCP-only)**
- MCP URL type: **Universal**
- MCP server URL: `https://plugin.thaiduy.digital/mcp`
- Challenge base URL: `https://plugin.thaiduy.digital`
- UI: none
- Authentication: OAuth 2.1 authorization code + PKCE S256
- OAuth client registration: Dynamic Client Registration (DCR)
- Resource identifier: `https://plugin.thaiduy.digital/mcp`

## Public listing

- Name: **Light Remote**
- Website: `https://plugin.thaiduy.digital/`
- Support: `https://plugin.thaiduy.digital/support`
- Privacy: `https://plugin.thaiduy.digital/privacy`
- Terms: `https://plugin.thaiduy.digital/terms`
- Repository: `https://github.com/n8n2erpnext/light-remote-mcp`
- Suggested category: Developer Tools
- Logo source: `assets/branding/light-remote-mark-512.png`

## Reviewer credentials

Reviewer authentication is a normal Light Remote account using the production OAuth path.

- Reviewer email: `openai-review@thaiduy.digital`
- Password: **never commit it**. Retrieve it securely from the reviewer LXD at submission time.
- Credential file: `/home/lightremote/.config/light-remote-review/reviewer-credentials.json`
- MFA: disabled for the reviewer fixture.
- Email/SMS confirmation: not required.
- Private network access: not required; reviewer connects through the public MCP URL.
- Reviewer account can see only `review-demo`.

## Reviewer sandbox

`review-demo` is a dedicated unprivileged Ubuntu LXD sandbox. It is not an owner production device.

- Container: `light-remote-review`
- Account: `reviewer`
- Device: `review-demo`
- Workspace: `/srv/reviewer-workspace`
- Effective capabilities: `filesystem`, `git`, `build-test`, `terminal`
- Locally denied: `docker`, `lxd`, `systemctl`, `sudo-on-demand`
- Operator and plugin run as non-root user `lightremote`.

## Domain verification

The endpoint is already wired at:

`https://plugin.thaiduy.digital/.well-known/openai-apps-challenge`

Before the portal verifies the domain, place the exact token issued by OpenAI in:

`/home/lightremote/.config/light-remote-review/openai-apps-challenge`

The endpoint must return the token as plain text and nothing else. It intentionally returns 404 until a token is installed.

## OAuth discovery

- Protected resource metadata: `/.well-known/oauth-protected-resource/mcp`
- Authorization server metadata: `/.well-known/oauth-authorization-server`
- Authorization endpoint: `/oauth/authorize`
- Token endpoint: `/oauth/token`
- DCR endpoint: `/oauth/register`
- PKCE method: `S256` only
- Tool scopes: `remote:read`, `remote:write`, `remote:execute`, `remote:terminal`
- Refresh tokens rotate and prior refresh JTIs are rejected during the server lifetime.

Do not advertise optional OIDC `openid`/`email` scopes until full OIDC/UserInfo support is intentionally implemented and tested.

## Portal prerequisites

Before Codex opens the submission draft, confirm the publishing OpenAI organization has:

- Apps Management / `api.apps.write` permission for the submitter.
- A verified individual or business identity matching the final publisher name.
- A final country/region availability decision.

Do not guess the verified publisher identity in the manifest or portal. The publisher-facing manifest fields are provisional until the OpenAI Platform verified identity is known; update them to match that identity before submission.

Current OpenAI submission docs (checked 2026-09-16) do **not** list Global data residency as a plugin-submission prerequisite. Do not re-add that as a gate unless the current portal or documentation explicitly requires it.


## Production service topology

`plugin.thaiduy.digital` is the production Universal MCP origin, not a reviewer-only mock. The reviewer sandbox is one isolated account/device fixture on that service.

- Public MCP/OAuth: `plugin.thaiduy.digital` -> ARM NetBird proxy -> `light-remote-review:5495`.
- Public device bootstrap/channel: the same production origin exposes only the allowlisted enrollment/heartbeat and signed `/device-channel/*` actions required by Light Remote clients.
- Device enrollment activation: `https://plugin.thaiduy.digital/enroll?id=<enrollmentId>`.
- Reviewer fixture: account `reviewer`, integrated device `review-demo`.
- User-enrolled devices remain account-bound end to end: enrollment binding -> signed connection -> route -> durable session -> job -> fleet command/result.
- Vercel remains only a compatibility surface for the existing Beta; it is not in the OpenAI submission data path.

## Pre-submit hard gates

Do not click Submit until all of these are true:

1. Verified Developer Identity is known and listing/publisher fields match it.
2. OpenAI portal challenge token is installed and `/.well-known/openai-apps-challenge` returns the exact token.
3. Reviewer OAuth linking is exercised through the real ChatGPT/portal UI using the submitted demo credential.
4. Scan Tools on the final public endpoint is clean and its tool set matches `TOOL_METADATA.md`.
5. Five positive and three negative reviewer cases pass on the deployed endpoint.
6. Final portable test suite and CI are green on the exact submitted commit.

## Scan Tools gate

Before every submission attempt, run Scan Tools against the final public endpoint and verify:

- Exactly the intended tools are present.
- Every tool has an OAuth `securitySchemes` entry.
- `readOnlyHint`, `destructiveHint`, and `openWorldHint` match the actual worst-case behavior.
- Server `instructions` describe explicit device targeting and durable-session recovery.
- No tool output exposes auth tokens, passwords, cryptographic keys, transport telemetry, or owner account identifiers.
- The five positive and three negative review cases pass using the reviewer fixture.
