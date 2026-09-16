# Light Remote OpenAI Plugin — Submission Readiness (2026-09-16)

## Current deployed candidate

- Branch: `codex/v0.11-openai-plugin`
- Base commit before submission work: `805e08bfdc9faf0ea68a6fd922a18582a658334a`
- Public MCP: `https://plugin.thaiduy.digital/mcp`
- Reviewer LXD: `light-remote-review`
- Plugin release path: `/opt/light-remote-plugin/releases/v011-20260916-805e08b-worktree`
- Operator release path: `/opt/gpt-vps-operator-releases/v011-20260916-805e08b-worktree`
- `current` points to the plugin release above. Operator systemd uses a v0.11 drop-in and `OPERATOR_ENROLLMENT_ACTIVATION_URL=https://plugin.thaiduy.digital/enroll`.

## Acceptance completed

- Plugin OAuth/MCP selftest: PASS.
- DCR + PKCE S256 + authorization-code exchange + access token + refresh rotation + refresh replay rejection: PASS in automated selftest.
- Hosted production-style second-account test: PASS.
- Account isolation: second account cannot open `review-demo`: PASS.
- Second-account enrollment -> signed connect -> signed poll -> durable session -> remote job dispatch -> signed result -> output -> close session: PASS.
- Full portable suite: `106 total / 105 passed / 0 failed / 1 skipped (live-host acceptance)`; exit 0.
- Public `healthz`, OAuth discovery, protected-resource metadata, account login page, MCP initialize, tools/list, and unauthenticated MCP challenge: PASS after live deploy.
- Public `/api/operator` non-allowlisted action denial: PASS.
- Reviewer persisted account ID migrated to `reviewer`, matching integrated device `review-demo`; backup: `/var/lib/light-remote-review/accounts.json.pre-reviewer-id-20260916`.
- Reviewer plugin/operator services: active; post-deploy journal shows clean starts and no runtime errors.

## OpenAI docs verified 2026-09-16

- Submission: https://developers.openai.com/plugins/deploy/submission
- Authentication: https://developers.openai.com/plugins/build/auth
- Guidelines/privacy: https://developers.openai.com/plugins/app-guidelines

Key current requirements used here: verified developer/business identity; public production MCP URL; reviewer-ready credentials without MFA/email/SMS/private-network dependency; accurate annotations; five positive + three negative cases; public website/support/privacy/terms; Scan Tools; DCR remains supported; PKCE S256 required; DCR client must remain valid while the connection is in use; privacy must disclose data categories, purposes, recipients, retention, and controls.

## Remaining hard gates

1. Determine the exact verified Developer Identity in the OpenAI Platform and align publisher-facing metadata.
2. Install the portal-provided domain challenge token. Until then `/.well-known/openai-apps-challenge` intentionally returns 404.
3. Exercise reviewer sign-in through the real ChatGPT/plugin submission UI. Automated use of the stored reviewer password was intentionally not bypassed when safety controls blocked it.
4. Run Scan Tools in the portal against the final public endpoint.
5. Run the documented five positive and three negative reviewer cases on the exact final deployment.
6. Commit/push this branch and require clean CI on the exact commit before submission.

## Rollback

- Previous plugin snapshot: `/opt/light-remote-plugin/releases/pre-v011-20260916-1655`.
- Remove `/etc/systemd/system/light-remote-review-operator.service.d/v011.conf`, run `systemctl daemon-reload`, restart operator to return to `/opt/gpt-vps-operator/operator-host/executor.mjs`.
- Repoint `/opt/light-remote-plugin/current` to the previous snapshot and restart `light-remote-review-plugin`.
- If reviewer account-ID migration itself must be reversed, restore `/var/lib/light-remote-review/accounts.json.pre-reviewer-id-20260916` only with plugin/operator stopped.
