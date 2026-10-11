# Light Remote rc.50 — Signed OAuth HTTP two-replica UAT checkpoint
Date: 2026-10-11. Branch: feature/rc50-mjs-scale-20261011.
Parent commit: d2515f67102ff485d18925d41d4b26525bdcfa8d.

## Scope and authorization boundaries
Keep the Node.js ESM (.mjs) backend with its Express/MCP/PKCE/OAuth/Local Wall/Operator protocols. Do not rewrite the backend in TypeScript/Fastify. Only synthetic UAT identities and newly created random HS256 signing keys are used. Production account, device, token, session, signing-secret, usage, Paddle/ERPNext and customer state were NOT accessed, imported, copied, backed up, mirrored or dual-written. No live OAuth endpoint, worker, installer, billing, production or shared rc.50 staging deployment has changed.

This checkpoint verifies **real HTTP processes and cryptographic signatures**, but intentionally uses a **parent-process in-memory mock ledger** for one-time token consumption. The HTTP tests are NOT PostgreSQL app-connected, do not prove distributed durable OAuth state or runtime DB permissions, and do not establish scalability at 1,000 sessions. Prior checkpoint 5260f91 separately proved 16 independent PG SQL connections contending on a one-time token hash; these results must not be conflated.

## Source changes — test-only files
- `platform-v2/test/helpers/uat-hs256-token.mjs`: synthetic HS256 JWT signer/verifier using Node crypto and a newly generated in-memory 32-byte key; checks HMAC signature, algorithm, issuer/audience/token type, exp/iat/nbf and canonical token encoding. It is not a production replacement for the existing `jose` verifier.
- `platform-v2/test/helpers/http-oauth-mocked-ledger-uat.mjs`: independent loopback Node HTTP process requiring a per-run private header. It calls `OAuthReplayGateUat` from `platform-v2/src/identity/oauth-replay-uat.mjs`, including signed-client, PKCE S256, expiry and one-time event hashing. Its injected store **deliberately simulates** an approved UAT DB role in tests and delegates consumption over IPC to a parent Map; NO DB connection or actual role lookup is performed.
- `platform-v2/test/http_oauth_signed_mock_uat.mjs`: forks two independent Node HTTP processes on OS-assigned ports bound only to 127.0.0.1, sends real signed JWTs using fetch, and makes the parent process serialize mock consumption.
- `platform-v2/test/uat-hs256-token.test.mjs`: three additional unit tests verify cryptographic acceptance and rejection for wrong key, alg=none, altered payload, malformed token, expiry, future iat/nbf and wrong audience.

## Verified tests
1. `node --test platform-v2/test/uat-hs256-token.test.mjs`: **3/3 PASS**, exit code 0.
2. `node platform-v2/test/http_oauth_signed_mock_uat.mjs`: PASS, exit code 0:
   - 2 independent localhost HTTP replica PIDs
   - same authorization code sent in 20 concurrent HTTP calls -> **1 accepted, 19 mock replays rejected**
   - process replacement still rejects old code because parent mock remains
   - refresh and resume token tests each **1 accepted, 7 mock replays rejected**
   - rejects invalid JWT MAC, issuer, expiration, client, redirect, PKCE before ledger consume
   - injected mock ledger outage returns HTTP 503; recovery works
   - ledger stores only irreversible token hashes and test account/client identifiers, not raw JWT or JTI
   - cleanup terminates both HTTP processes and clears parent Map.
3. `bash platform-v2/scripts/check.sh`: **34/34 Node tests PASS**, baseline PostgreSQL/Team/worker/outbox tests PASS.
4. `python3 platform-v2/scripts/migrations_uat.py verify`: 13 versions, 13 SHA-256 hashes PASS.
5. Existing `deploy/scripts/selftest-v09-oauth-mcp.mjs` and `selftest-v11-oauth-onboarding.mjs`: PASS.
6. Final check: no UAT mock HTTP workers running; isolated PostgreSQL17 and Redis8 healthy; UAT accounts=0, OAuth consumed rows=0, usage events=0, outbox=0, migrations=13, hashes=13. All state is synthetic only.

## Explicit pending gates
- The future least-privilege PostgreSQL app role `lr_rc50_oauth_replay` and Redis app-scoped access are not yet provisioned. Previous tool protection blocked role provisioning; DO NOT work around by using DB-owner/bootstrap permissions as application credentials.
- A real pair of HTTP API replicas has NOT consumed OAuth replay state over PostgreSQL using actual least-privilege DB connections; current test injects mock role and parent Map. Preserve the distinction in reporting and UI.
- The product OAuth source still has process-local `usedCodes`, `usedRefresh`, `usedResume` and failure limiter state. No cutover has been approved or attempted.
- Need identity-bound and locally authorized owner/user context before token issue, correct sequencing of auth-code consume vs token issuance, secure session keys and PKCE verification, failure injection on real Postgres/Redis clients, client compatibility, Local Wall A/B separation and proper revocation.
- No real multi-node deployment, hot-reload migration, OS-worker fencing, high-load benchmark or production data migration was performed. Do not deploy to shared staging or production without separate owner approval.
- GitHub CI has not incorporated these manual HTTP test scripts.

## Resume
```bash
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform
git status --short && git log -1 --oneline
node --test platform-v2/test/uat-hs256-token.test.mjs
node platform-v2/test/http_oauth_signed_mock_uat.mjs
bash platform-v2/scripts/check.sh
python3 platform-v2/scripts/migrations_uat.py verify
```

Prior pending handoff: `/home/ubuntu/handoffs/LIGHT_REMOTE_MJS_SIGNED_OAUTH_HTTP_UAT_PENDING_2026-10-11.md`. This checkpoint supersedes it after successful regression tests and source review. No changes to production.
