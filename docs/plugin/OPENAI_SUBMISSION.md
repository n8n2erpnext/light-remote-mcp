# OpenAI Plugin Submission — Light Remote

This file is the canonical handoff for creating the public OpenAI plugin draft.

## Submission type

- Type: **Skills + MCP**
- MCP URL type: **Universal**
- MCP server URL: `https://light-remote.thaiduy.digital/mcp`
- Challenge base URL: `https://light-remote.thaiduy.digital`
- UI: none (chat-native MCP; product state is exposed through structured tools and skills)
- Authentication: OAuth 2.1 authorization code + PKCE S256
- OAuth client registration: Dynamic Client Registration (DCR)
- Resource identifier: `https://light-remote.thaiduy.digital/mcp`

## Public listing

- Name: **Light Remote**
- Website: `https://light-remote.thaiduy.digital/`
- Support: `https://light-remote.thaiduy.digital/support`
- Privacy: `https://light-remote.thaiduy.digital/privacy`
- Terms: `https://light-remote.thaiduy.digital/terms`
- Repository: `https://github.com/n8n2erpnext/light-remote-mcp`
- Suggested category: Developer Tools
- Logo source: `assets/branding/light-remote-mark-512.png`

## Reviewer credentials

Reviewer authentication is a normal Light Remote account using the production OAuth path.

- Reviewer email: `openai-reviewer@thaiduy.digital`
- Password: **never commit it**. Rotate it through the local-only operator admin endpoint immediately before filling the OpenAI reviewer credential field, then paste it directly into the portal. Do not persist the plaintext password in Git or reviewer files.
- MFA: disabled for the reviewer fixture.
- Email/SMS confirmation: not required.
- Private network access: not required; reviewer connects through the public MCP URL.
- Reviewer account is a dedicated **VIP** fixture and can see only the isolated reviewer devices (`review-main`, `review-leaf`, plus any resettable lifecycle-test device).

## Reviewer sandbox

The reviewer environment is a dedicated full Light Remote installation using isolated Ubuntu LXD devices. It is not an owner production environment.

- Control plane + integrated Main-capable device: `light-remote-review` / `review-main`.
- Independent outbound client device: `light-remote-review-leaf` / `review-leaf`.
- Account: `reviewer`, entitlement: **VIP**.
- Workspace: `/srv/reviewer-workspace`.
- Local Wall and Fleet Wall use the same production code paths as normal Light Remote installations.
- Reviewer policy exposes safe filesystem/git/build/terminal capabilities on both reviewer devices and uses the device-local final policy to deny privileged administration such as `sudo-on-demand`, `systemctl`, `lxd`, `docker`, and package management when present.
- Plugin/operator run non-root; reviewer secrets are stored outside Git.

## Domain verification

The endpoint is already wired at:

`https://light-remote.thaiduy.digital/.well-known/openai-apps-challenge`

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

Current OpenAI MCP review requirements (checked 2026-09-16) state that projects with **EU data residency cannot submit plugins with MCP servers for review**. Use an OpenAI project with **global data residency** for submission.


## Production service topology

`light-remote.thaiduy.digital` is the production Universal MCP origin, not a reviewer-only mock. The reviewer sandbox is one isolated account/device fixture on that service.

- Public MCP/OAuth: `light-remote.thaiduy.digital` -> ARM NetBird proxy -> `light-remote-review:5495`.
- Public device bootstrap/channel: the same production origin exposes only the allowlisted enrollment/heartbeat and signed `/device-channel/*` actions required by Light Remote clients.
- Device enrollment activation: `https://light-remote.thaiduy.digital/enroll?id=<enrollmentId>`.
- Reviewer fixture: VIP account `reviewer`, integrated `review-main`, and independent outbound `review-leaf`; both run normal Light Remote device/Wall/Fleet paths.
- User-enrolled devices remain account-bound end to end: enrollment binding -> signed connection -> route -> durable session -> job -> fleet command/result.
- Vercel remains only a compatibility surface for the existing Beta; it is not in the OpenAI submission data path.

## Pre-submit hard gates

Do not click Submit until all of these are true:

1. Verified Developer Identity is known and listing/publisher fields match it.
2. OpenAI portal challenge token is installed and `/.well-known/openai-apps-challenge` returns the exact token.
3. Reviewer OAuth linking is exercised through the real ChatGPT/portal UI using the submitted demo credential.
4. Scan Tools on the final public endpoint is clean and its **20-tool** set matches `TOOL_METADATA.md`; upload the final four-skill bundle from root `skills/` into the same draft and review it. The current MCP server does not advertise the draft static-skills extension, so do not expect Scan Tools to import skills from the server.
5. Five positive and three negative reviewer cases pass on the deployed endpoint.
6. Final portable test suite and CI are green on the exact submitted commit.
7. The submission project uses **global data residency** (not EU data residency).

## Scan Tools gate

Before every submission attempt, run Scan Tools against the final public endpoint and verify:

- Exactly the intended tools are present.
- Every tool has an OAuth `securitySchemes` entry.
- `readOnlyHint`, `destructiveHint`, and `openWorldHint` match the actual worst-case behavior.
- Server `instructions` describe explicit device targeting and durable-session recovery.
- No tool output exposes auth tokens, passwords, cryptographic keys, transport telemetry, or owner account identifiers.
- The five positive and three negative review cases pass using the reviewer fixture.
