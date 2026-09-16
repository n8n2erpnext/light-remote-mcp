# Light Remote OpenAI Plugin — Full-product Reviewer Readiness (2026-09-16)

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

## OpenAI docs verified 2026-09-16

- Submission: https://developers.openai.com/plugins/deploy/submission
- MCP review requirements: https://developers.openai.com/plugins/deploy/app-review
- Packaging: https://developers.openai.com/plugins/build/plugins
- Authentication: https://developers.openai.com/plugins/build/auth
- Security/privacy: https://developers.openai.com/plugins/guides/security-privacy

Applied current requirements: public production MCP URL; reviewer-ready credentials with no MFA/email/SMS/private-network dependency; accurate tool names/schemas/annotations; five positive + three negative tests; realistic starter prompts; public website/support/privacy/terms; Scan Tools; verified developer/business identity; and an OpenAI project with **global data residency** because EU-residency projects currently cannot submit MCP plugins for review.

## Remaining gates after source commit

1. Push the reviewer-only commit and require CI green on that exact SHA.
2. Deploy that exact SHA into `light-remote-review`; do not deploy an uncommitted worktree.
3. Install/start the real host Local Wall/Fleet path for `review-main`.
4. Create `light-remote-review-leaf`, install the normal Linux client, and enroll it to the reviewer account.
5. Set reviewer entitlement to VIP and verify Main/Fleet migration, policy, PTY, activity, updater/helper, revoke/remove/reset behavior.
6. Re-run public OAuth/MCP smoke and the documented five positive + three negative cases.
7. Install the exact OpenAI portal domain challenge token when the portal supplies it.
8. Scan Tools on the final public endpoint; ensure the 20 tools and four skills match the submission draft.
9. Exercise reviewer OAuth through the real OpenAI/ChatGPT review UI.
10. Stop before **Submit for Review**.

## Rollback principle

Keep the existing reviewer deployment and backup until the full-product deployment passes acceptance. Cut public ingress only after local health/OAuth/MCP/device/Fleet checks pass. Do not touch `lxd-arm`.
