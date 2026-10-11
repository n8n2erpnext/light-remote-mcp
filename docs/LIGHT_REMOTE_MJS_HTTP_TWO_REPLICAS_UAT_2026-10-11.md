# Light Remote — Two localhost HTTP replicas + real Redis UAT
**Date:** 2026-10-11 · **Branch:** `feature/rc50-mjs-scale-20261011`
**Base checkpoint:** `35c4171dcd5d964af0ea26a494b0f41dce06c74f`

## Purpose and non-negotiable safety boundaries
Continue the user-approved Node.js ESM `.mjs` horizontal-scale program, preserving existing OAuth/MCP PKCE, Local Wall A/B, Team owner billing, Free 10k/family and OS-side device worker permissions. Use **only synthetic UAT data** on VPS-ARM and NEVER read/backup/import/dual-write production account/device/session/JWT/token/billing/Paddle/ERPNext state; no production or shared rc50 staging route, service, client, auth or billing changes.

PostgreSQL app role `lr_rc50_app` and OAuth replay role `lr_rc50_oauth_replay` remain unprovisioned. Previous provisioning was tool-blocked; **do not bypass** by using UAT database administrator as an app principal. This checkpoint covers **real HTTP request processing and shared Redis rate limiting**, NOT the PostgreSQL OAuth replay in HTTP.

## Files / architecture
- `platform-v2/test/helpers/http-rate-api-uat.mjs` — ephemeral HTTP worker process. Starts only after a parent IPC message supplies random test proof + HMAC salt; binds OS-assigned port on `127.0.0.1` ONLY. Exposes **test-only** `GET /uat/healthz`, `POST /uat/synthetic-failure`, `POST /uat/synthetic-success`. Requires a per-run private header; rejects wrong header, wrong content type and non-synthetic `uat_actor_<20 hex>` IDs. No real credential or JWT processing. Failed-credential simulation counts through existing `RedisUatAuxiliary.rateHit` (limit 12, window 60 seconds). Rate limit is shared across independent processes. Client actor is hashed with same per-run HMAC salt before forming the Redis key `lr:rc50:uat:auth:rate:oauthhttp-<32 hex>`; ignores untrusted `X-Forwarded-For` values entirely. Redis error fails closed with HTTP 503; exhausted key gets HTTP 429 + `Retry-After`. Synthetic successes do not count.
- `platform-v2/test/http_replicas_redis_uat.mjs` — no test servers persist after invocation. Forks two distinct HTTP OS processes and uses **real Node `fetch()` HTTP requests** over loopback. Validates auth header, actor checks and success isolation; sends 24 concurrent simulated failed-sign-in requests against shared isolated UAT Redis; kills one replica, starts replacement, verifies shared count retention; verifies second synthetic actor and backend-failure fail-closed recovery. Uses `finally` to stop workers and delete **only its own** generated rate keys.
- Reuses `platform-v2/src/storage/redis.mjs` and prior `platform-v2/test/helpers/redis-cli-uat.mjs`. The latter is a **test-only Docker-exec Redis CLI transport**, not a normal app Redis client. It authenticates from the container's private UAT Redis config without printing credentials, never publishes Redis port. It is used ONLY in the owner-approved isolated UAT experiment and is **not suitable for deploy, performance testing, or production app access**. No production dependencies were added.

## Verified real HTTP outcomes
`node platform-v2/test/http_replicas_redis_uat.mjs` passed twice, with all assertions:
- `RC50_TWO_HTTP_REPLICAS_LOOPBACK_ONLY_PASS`: two independent real Node HTTP server PIDs, bound to separate OS-allocated 127.0.0.1 ports.
- `RC50_HTTP_GUARDS_PASS`: wrong private proof -> 403, invalid identity -> 400, synthetic successful sign-in -> 204 with zero failed-attempt increments.
- `RC50_HTTP_REDIS_GLOBAL_24_PASS`: 24 simultaneous HTTP failures evenly split across two processes with spoofed/distinct forwarded headers -> 12 normal synthetic authentication failures (401), 12 blocked (429); globally unique Redis counts 1–24 and valid Retry-After.
- `RC50_HTTP_RESTART_KEEP_RATE_STATE_PASS`: process A stopped; replacement real HTTP process sees count 25 and returns 429; Redis state not reset by API instance turnover.
- `RC50_HTTP_CLIENT_ISOLATION_PASS`: distinct fake actor starts fresh counter at 1.
- `RC50_HTTP_FAIL_CLOSED_REDIS_OUTAGE_PASS`: injected transport loss -> HTTP 503, no counter increment; recovery request resumes counter normally.
- `RC50_HTTP_UAT_GENERATED_REDIS_KEYS_CLEANUP_PASS`: only HMAC-derived keys from the two fabricated actors deleted after server shutdown.
- Verified no stale `http-rate-api-uat.mjs` OS process remained.
- Full existing `bash platform-v2/scripts/check.sh` suite PASS **31/31 Node unit tests**, existing SQL rollback + 8-way Team/worker/outbox contention PASS. `node deploy/scripts/selftest-v09-oauth-mcp.mjs` PASS. `python3 platform-v2/scripts/migrations_uat.py verify` PASS 13/13 immutable checksums. PG17 + Redis8 UAT remain healthy, private Docker network and no host-published ports.

## Important limitations / true next gates
- HTTP routes are deliberately **not** OAuth endpoints and do not verify actual credentials, signed JWT, PKCE, scopes, refresh tokens, account membership, Local Wall A/B, device lease or billing.
- Redis transport in this experiment invokes `docker exec redis-cli` for each test request. It is **not a Redis TCP pool**, not constrained by an app Redis ACL, and has Docker-spawn overhead. Do **not** cite HTTP response time, RPS or 24-request behavior as capacity benchmark, nor claim the host can serve 1,000 concurrent customers.
- Redis fixed-window **failed-attempt throttle** is a supplemental security control; Free 10k/month, Team quota, Paddle billing and all authoritative usage remain PostgreSQL ledger responsibilities. Production auth throttling and OAuth replay remain process-local until a separately authorized integration/cutover.
- The live OAuth handler currently still uses local maps. The next real API-integration gate requires authorized *least-privileged* PostgreSQL/Redis service identities, approved verification of existing JWT claim semantics, and a private end-to-end API harness with **two actual app DB connections**. Earlier blocked role provisioning must not be circumvented.
- CI/deploy/update manifests were not changed. Prior runner/CI change was tool-blocked; keep these synthetic tests manually invoked until approval.

## Resume on approved VPS-ARM
```bash
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform
git status --short
node platform-v2/test/http_replicas_redis_uat.mjs
node platform-v2/test/concurrent_redis_rate_uat.mjs
bash platform-v2/scripts/check.sh
python3 platform-v2/scripts/migrations_uat.py verify
```

## Future priorities
1. Approved least-privilege `lr_rc50_oauth_replay` role and Redis app ACL. Do NOT run web/API service using `lr_rc50_uat` bootstrap database owner or Docker daemon privileges.
2. Build private UAT `OAuthReplayGateUat` with actual JWT signature verifier and real DB adapter; test two HTTP OAuth replicas, replay under crashes, DB down/fail-closed.
3. Audit forwarded IP/trusted reverse proxy semantics before per-IP throttling; never trust arbitrary `X-Forwarded-For` by default and do not put raw client IPs in Redis.
4. Benchmark 100/500/1000 true synthetic sessions **after replacing Docker CLI test transport with a scoped Redis TCP client** and adding p95/p99/CPU/memory/event loop metrics.
