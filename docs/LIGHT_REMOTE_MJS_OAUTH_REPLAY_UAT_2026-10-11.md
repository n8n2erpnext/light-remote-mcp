# Light Remote rc.50 — MJS OAuth replay ledger (synthetic UAT)

Date: 2026-10-11 · Branch: `feature/rc50-mjs-scale-20261011` · Parent: `a332050d0eb80dd3c8ffedd34229e3a6f9f09b0d`.

## Objective / user boundaries
Keep Node.js `.mjs` + Express 5, existing OAuth PKCE/OIDC/MCP, Local Wall A/B and signed device protocol. Prepare for thousands of accounts and multiple API replicas without rewriting in TS/Fastify. **No production registry/account/device/session/token/secret/Paddle/ERPNext read, migration, sync or deploy**. Everything here is detached UAT code and fabricated test identities only.

The public OAuth source `plugin-server/oauth.mjs` today uses process-local maps `usedCodes`, `usedRefresh`, `usedResume` to reject replay. Two live replicas would NOT share those maps. Existing behavior includes HS256 JWT, code TTL 120 sec, refresh TTL 30 days, resume TTL 24 hours, audience/issuer checks, PKCE S256 and `client_id` binding. The new components MUST preserve all of that before future live integration.

## Added code
- `platform-v2/sql/013_oauth_atomic_replay.sql`: `lr_consume_oauth_once_uat` validates the signed-claim context it receives (purpose, token-hash format, active account for code/refresh, client identifier and TTL), and inserts a **SHA256 key derived from signed token JTI and scoped purpose+issuer** into the existing `lr_oauth_one_time` table. One `INSERT ... ON CONFLICT DO NOTHING` produces exactly one accepted consume globally across PG connections. Replay returns false. The SQL function does **not** verify the signed JWT itself and is `SECURITY INVOKER` with `PUBLIC EXECUTE` revoked. Refresh/resume/code expiration windows bounded separately. No raw bearer token, code, refresh token or raw JTI is stored in the ledger.
- `platform-v2/src/identity/oauth-replay-uat.mjs` exports two **explicitly UAT-only** components:
  - `OAuthReplayGateUat`: requires a trusted injected signature verifier and storage. Uses staging issuer `https://rc50-mcp.thaiduy.digital`, audience and token purpose, checks signed claims, code PKCE S256 and exact redirect, `client_id`, device-independent resource audience, JTI and expiry before calling storage. It validates the callback's claims as an additional defense, but the *signature must be verified by the injected verifier*, using existing signed-token code/jose in future integration.
  - `PgOAuthReplayStoreUat`: requires an actual `light_remote_rc50_uat` connection through a future non-superuser `lr_rc50_oauth_replay` role. Refuses DB use before role+database verification; all queries have bound placeholders.
- `platform-v2/sql/migrations.lock.json` now pins v013 checksum. `migrations_uat.py apply` applied **only 013**; `verify` confirms exactly 13 matching hashes, without rerunning historical 001–012.
- Existing scratch backup/restore rehearsal `platform-v2/scripts/rehearse_restore_uat.py` now gets migration count from the manifest, not hard-coded 12. Immutability unit `platform-v2/test/test_immutable_migrations_uat.py` checks 13 versions.

## Synthetic tests
- `platform-v2/test/oauth-replay-uat.test.mjs`: five Node tests with locally generated HS256 JWTs and actual HMAC signature verification in a test-only injected verifier; two separate gate **objects** with one shared fake atomic storage, signature/issuer/client/PKCE/tampering/DB outage refusal, and SQL adapter role/argument checks.
- `platform-v2/sql/test_oauth_atomic_replay_rollback.sql`: synthetic account; first consume accepted, same code/refresh/resume replay rejected, expired code, wrong owner, malformed token hash and invalid resume principal rejected; `ROLLBACK` verifies 0 fake records.
- `platform-v2/test/concurrent_oauth_replay.py`: **real PostgreSQL** SQL fixture test via 16 independent psql processes per code, refresh and resume token (48 total). Per type exactly **one accepted and 15 rejected**. Deletes only generated fake account/JTI-hash records, confirms clean tables. Fixture administrator uses UAT database owner for **migration/tests only**, not as an app login.
- `bash platform-v2/scripts/check.sh` PASS **31/31 Node unit tests** including the five new OAuth tests, baseline SQL/Team/worker/outbox regression. SQL v013 tests run separately because CI runner has NOT been updated.
- `python3 -B platform-v2/test/test_immutable_migrations_uat.py` PASS 4/4; UAT migration 013 apply and 13/13 verify PASS.
- `python3 -B platform-v2/scripts/rehearse_restore_uat.py`: clean schema replay with **13 migrations**, fake Free accounting fixture, pg_dump custom-format and restore to separate ephemeral UAT DB, replay/idempotency assertion and full scratch cleanup PASS.
- Original `deploy/scripts/selftest-v09-oauth-mcp.mjs` and `selftest-v11-oauth-onboarding.mjs` PASS on the unchanged legacy OAuth production source.

## Final data and safety attestation
Only isolated `lightremote-rc50-v2-postgres-1` and Redis UAT are involved, internal-only Docker network, no published host port. After tests, UAT tables accounts=0, oauth_one_time=0, usage_events=0, outbox=0; scratch restored DBs=0. Migrations and their source hashes=13 each. SQL `PUBLIC EXECUTE=false`. Production and staging OAuth routes, Local Wall, client installers, sessions, grants, users and billing remain untouched.

**Application database role `lr_rc50_oauth_replay` does not exist yet**, same as `lr_rc50_app`; previously security controls blocked application-role provisioning. Do not work around the block or put DB owner/superuser credentials into a service. Current test of concurrent SQL transactions is genuine, but **two real API processes with database connections have NOT been tested**. The shared in-memory mock test only checks gate contract, not distributed persistence. No production JWTs/secrets have been used.

## Future integration conditions
1. Legitimately provision a least-privilege UAT OAuth replay DB role, allowing only the required SELECT/INSERT/FUNCTION in the isolated database. Careful `SECURITY INVOKER` design: avoid granting arbitrary table DML to web processes; review narrow proxy role/function and transaction approach before enabling.
2. Build two independent UAT API Node processes with real PostgreSQL connections, inject the *existing* `jose` signature verifier and staging-only JWT issuer, test code/refresh/resume across replicas and fail-closed when PG/Redis goes offline. Preserve old OAuth PKCE, scopes, issuer, audience, response schema, audit logs and Local Wall A/B separation.
3. Use SQL atomic consumption **after signed-JWT/PKCE/client checks but before issuing new OAuth tokens**. Revisit token-issuance failure behavior (token may be safely burned but client must reauthorize); resume must only consume after successful account authorization to avoid anonymous denial of service.
4. Add bounded retention/pruning for expired consumed-hash rows (retain until expiry plus clock skew; never delete live replay evidence), observability without logging raw tokens, and rate limiting shared across replicas.
5. UAT migration 013 and new SQL/PG contention tests are manually verified, NOT wired into GitHub CI. Existing `platform-v2/scripts/check.sh` still reruns 001–007; its CI update was previously blocked and should not be bypassed.
6. Real Windows/macOS/Linux agent dispatch, device A/B, quota and billing cutover, 100/500/1000 session benchmarks and production data access remain separate owner-authorized gates.

## Resume tests (owner-approved VPS ARM, synthetic only)
```bash
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform
git status --short
python3 platform-v2/scripts/migrations_uat.py verify
bash platform-v2/scripts/check.sh
node --test platform-v2/test/oauth-replay-uat.test.mjs
docker exec -i lightremote-rc50-v2-postgres-1 psql -X -v ON_ERROR_STOP=1 \
 -U lr_rc50_uat -d light_remote_rc50_uat < platform-v2/sql/test_oauth_atomic_replay_rollback.sql
python3 platform-v2/test/concurrent_oauth_replay.py
python3 -B platform-v2/scripts/rehearse_restore_uat.py
```
