# Light Remote OpenAI Plugin — Full-product Reviewer Readiness (2026-09-17)

## Reviewer-only source branch

- Branch: `reviewer/openai-full-product`.
- Base: `2e12d5cb2b71b141fd7683272ea0a027efbe252f` (`codex/v0.11-openai-plugin`).
- Primary/candidate worktree remains separate and untouched.
- Canonical public origin: `https://light-remote.thaiduy.digital`.
- Universal MCP URL: `https://light-remote.thaiduy.digital/mcp`.
- Vercel compatibility code remains in the repository for legacy/Beta behavior, but Vercel is not in the reviewer runtime path.

## Full-product reviewer design

The reviewer fixture is not a reduced MCP demo. It uses the Light Remote control plane and normal product runtime with isolated reviewer state:

- `light-remote-review`: reviewer control plane + integrated `review-main` device.
- `light-remote-review-leaf`: independent outbound `review-leaf` client device.
- Reviewer account: `reviewer`, entitlement: **VIP**.
- Local Wall, Fleet/Main authority, signed device channel, policy, durable sessions/jobs, native filesystem/search/process, PTY, activity, and updater/helper state use production code paths.
- No production user account, device, key, file, or log is copied into the reviewer environment.
- Normal A/B onboarding remains local-first; reviewer devices are pre-enrolled fixture data, not a security bypass.

## OpenAI-facing surface

- 20 MCP tools: 14 existing execution/recovery tools plus Connection Helper, Device Inspector, Recent Activity, Set Main, Revoke Device, and Remove Device.
- Four portable skills: connection/onboarding, remote operations, Fleet/device governance, and policy/observability.
- Tool annotations reflect worst-case behavior; revoke/remove are destructive.
- Starter prompts demonstrate topology/Fleet, explicit target work, real PTY lifecycle, activity, and policy denial.
- The submission declares no MCP-rendered UI, so the review draft should not include screenshots; product portal screenshots remain internal documentation only.
- Five positive + three negative review cases are defined in `REVIEW_TEST_CASES.md`.

## Source acceptance completed before commit

- Plugin OAuth/MCP + hosted tests: PASS.
- Hosted full-product lifecycle: VIP -> Connection Helper -> inspect/activity -> Set Main -> revoke -> remove: PASS on the real operator implementation.
- Portable suite: `106 total / 105 passed / 0 failed / 1 skipped (live-host acceptance)`; exit 0.
- Root `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities.
- Plugin `npm audit --prefix plugin-server --omit=dev --audit-level=moderate`: 0 vulnerabilities.
- Root/compat manifests parse: PASS.
- Modified JavaScript syntax checks: PASS.
- Four `SKILL.md` frontmatter checks: PASS.
- Changed-file credential literal scan: 0 hits.
- `git diff --check`: PASS.
- Reviewer-surface old-origin scan: PASS.

## OpenAI docs verified 2026-09-17

- Submission: https://developers.openai.com/plugins/deploy/submission
- MCP review requirements: https://developers.openai.com/plugins/deploy/app-review
- Packaging: https://developers.openai.com/plugins/build/plugins
- Authentication: https://developers.openai.com/plugins/build/auth
- Security/privacy: https://developers.openai.com/plugins/guides/security-privacy

Applied current requirements: public production MCP URL; reviewer-ready credentials with no MFA/email/SMS/private-network dependency; accurate tool names/schemas/annotations; five positive + three negative tests; realistic starter prompts; public website/support/privacy/terms; Scan Tools; verified developer/business identity; and an OpenAI project with **global data residency** because EU-residency projects currently cannot submit MCP plugins for review.

## Current deployment status and remaining external gates

Completed on the reviewer branch/fixture:

- Reviewer branch CI is green on the current exact source commit before each activation.
- Public canonical origin is `https://light-remote.thaiduy.digital`; health, account portal, OAuth discovery, and MCP endpoint are public.
- OpenAI Scan Tools compatibility now enforces OAuth at the `/mcp` HTTP boundary (`401 Unauthorized` + `WWW-Authenticate`) and accepts a standards-valid `Accept: */*` scanner probe by normalizing it before the MCP transport. A regression test reproduces the observed OpenAI `aiohttp` probe.
- OpenAI OAuth compatibility also publishes `/.well-known/openid-configuration`, advertises `openid`/`email`, exposes `/userinfo` with `email_verified: true`, declares RFC 9207 issuer-response support, and round-trips accepted DCR client metadata. This matches the portal scan sequence and workspace domain-restriction contract observed on 2026-09-17.
- Authorization codes are now opaque, single-use 256-bit handles retained server-side for 120 seconds. This keeps the OpenAI relay callback compact (well below 1 KB in the regression fixture) while preserving PKCE, client, redirect, resource, scope, expiry, and replay binding. The prior nested-JWT authorization code produced an observed callback of about 2,055 characters.
- OAuth authorization-page CSP no longer declares `form-action`: Chrome applies that directive across redirects after form submission, while the OpenAI relay continues from `chatgpt.com/connector_platform_oauth_redirect` to the Platform draft. The form action remains hard-coded to `/oauth/authorize`, and the server still validates the DCR-registered redirect URI exactly before issuing a code.
- OAuth authorization-page CSP now allows form submission navigation to the validated `redirect_uri` origin in addition to `'self'`. The previous `form-action 'self'` policy let `/oauth/authorize` POST successfully but Chrome could block the cross-origin 303 redirect to ChatGPT before token exchange; regression coverage asserts the registered callback origin is present in CSP.
- Reviewer account is VIP with two pre-enrolled Linux devices; Local Wall, Main migration, Fleet Wall, policy denial, PTY, filesystem/Git, activity, and no-fallback behavior have been exercised live. Both reviewer devices are intentionally restricted to safe effective permissions even though Light Remote can describe broader product capabilities.
- Fleet migration has been verified in both directions at runtime; only the selected Main owns the active Fleet Wall listener.
- Reviewer login works from a normal external browser without MFA, email/SMS confirmation, VPN, or NetBird.
- Reviewer leaf availability is self-healing with a local-only timer that uses the normal signed device `connect` path after lease expiry; the production VIP 72-hour hard cap remains unchanged.

Still external/manual before **Submit for Review**:

1. Select the verified Developer/Business Identity in the OpenAI Platform and make publisher-facing fields match it.
2. Use an OpenAI project with **global data residency** and Apps Management write access.
3. Install the exact portal-issued domain challenge token and verify the public challenge endpoint returns only that token.
4. Run **Scan Tools** against the final endpoint and review all 20 tool definitions/annotations.
5. Upload the final four-skill bundle from root `skills/` to the same draft (the current MCP server does not expose the draft static-skills import extension).
6. Enter a freshly rotated reviewer password and exercise OAuth/tool selection through the real OpenAI review/developer surface.
7. Copy the five positive and three negative cases into the draft and rerun them there.
8. Choose availability/localization, review release notes/policy attestations, and stop before **Submit for Review**.

## Rollback principle

Keep the existing reviewer deployment and backup until the full-product deployment passes acceptance. Cut public ingress only after local health/OAuth/MCP/device/Fleet checks pass. Do not touch `lxd-arm`.
