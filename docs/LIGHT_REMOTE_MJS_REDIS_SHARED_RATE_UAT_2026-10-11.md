# Light Remote rc.50 — Shared Redis rate limiter / two-process UAT
**Date:** 2026-10-11, Asia/Ho_Chi_Minh
**Parent commit:** `5260f9150cfb18512bced94f40b84a6b2bd72d3a`
**Branch:** `feature/rc50-mjs-scale-20261011`

## Owner's non-negotiable boundaries
Keep Node.js ESM `.mjs`, existing Express/MCP/OAuth/Operator protocols; no TS/Fastify rewrite. Scaling target several thousand registered users, about 20% online, must preserve OAuth PKCE, Local Wall A/B, Free account+family 10k call allowance, Team owner billing and OS worker lease safety. During this UAT work DO NOT read/migrate/backup/dual-write production account, device, OAuth secret, session, token, usage, Paddle, ERPNext or Fleet state. Do not change production or shared staging routing, releases, plugin configuration or live identities.

## Problem and verified scope
The current production source `plugin-server/oauth.mjs` contains **process-local** `failures` rate limiting state (and `usedCodes`, `usedRefresh`, `usedResume` Maps). Running API replicas independently would not synchronize these maps. Previous checkpoint `5260f91` addressed **SQL replay idempotency in synthetic UAT only**; no production endpoint is connected.

The existing `platform-v2/src/storage/redis.mjs` offers `RedisUatAuxiliary.rateHit()`: one atomic Redis Lua `INCR`+first-`EXPIRE` fixed-window decision with a strictly UAT-prefixed key, TTL bounds and fail-closed when the Redis backend reports an error. Redis **is not authoritative for billing, Free quota, family allowance or Team entitlement**; PostgreSQL SQL remains the planned durable owner for those.

**This checkpoint tests Redis with actual separate Node OS processes, but does NOT yet create two real HTTP API instances.**

## Files created (test-only; no new production dependencies)
- `platform-v2/test/helpers/redis-cli-uat.mjs`: a narrow, allowlisted, test-only Redis CLI shim. It runs `redis-cli` INSIDE the existing isolated `lightremote-rc50-v2-redis-1` container via `docker exec`, obtains the **UAT** password directly from that container's already configured Redis config without echoing it, uses Redis EVAL, checks key names and numeric results; refuses unrelated containers/keys. It is NOT a production Redis client and adds no host-published port.
- `platform-v2/test/helpers/redis-rate-worker-uat.mjs`: real independent Node child process; uses existing `RedisUatAuxiliary` with namespace `lr:rc50:uat:auth:` and communicates only test requests/results over IPC.
- `platform-v2/test/concurrent_redis_rate_uat.mjs`: host-side orchestrator forks two different Node workers and sends 24 concurrent requests against one **real authenticated private Redis** limiter key with limit=12, 60-second window. It asserts globally unique INCR counts 1–24 and exactly 12 allowed / 12 denied, terminates one worker, starts replacement process and verifies count=25 is still denied; separately verifies a second identity's independent bucket, TTL expiry and reset; simulated Redis transport outage is fail-closed. `finally` kills all spawned workers and deletes only its generated UAT keys, never FLUSHDB/FLUSHALL/production keys.

## Executed verified evidence
- `node platform-v2/test/concurrent_redis_rate_uat.mjs` PASS:
  - `RC50_REDIS_TWO_NODE_PROCESS_RATE_PASS` — 24 requests across 2 actual Node process PIDs, unique Redis counts 1–24, 12/12 decisions
  - `RC50_REDIS_NODE_RESTART_RETENTION_PASS` — replacement worker sees count 25 denied, not reset
  - `RC50_REDIS_NAMESPACE_TTL_PASS` — independent requestor key and 2-second expiry/reset
  - `RC50_REDIS_FAILURE_FAIL_CLOSED_PASS` — backend transport fault injected; limiter rejects, not permit
  - `RC50_REDIS_SYNTHETIC_KEY_CLEANUP_PASS` — all generated UAT keys removed.
- Read-only `SCAN` of the 3 synthetic fixture name patterns returned **zero keys** afterward; no wide-scope Redis scan, no key/value access outside these patterns.
- `bash platform-v2/scripts/check.sh` PASS **31/31 Node unit tests**, existing SQL rollback, Team seat, worker, outbox concurrency tests. `deploy/scripts/selftest-v09-oauth-mcp.mjs` legacy OAuth regression PASS. `migrations_uat.py verify` PASS: 13 migrations, 13 recorded immutable hashes.
- Isolated PG17/Redis8 healthy, zero published host ports; PostgreSQL UAT accounts=0, oauth_one_time=0, usage_events=0 after tests. No production/customer data read or copied.
- Production OAuth `tooMany(req)` still uses its original per-process failure Map; **this UAT rate limiter has NOT been wired to any production/staging login endpoint**. The two workers are not HTTP servers and the test CLI overhead is NOT a representative throughput/p95/RPS benchmark.
- GitHub CI scripts and deploy were NOT modified; manual synthetic-only Redis test remains deliberately separate from `node --test test/*.test.mjs` (the test filename does not end with `.test.mjs`). Prior workflow edit was blocked; no alternate route was used to bypass it.

## Follow-up work, ordered
1. Owner-authorized, independently least-privileged UAT PostgreSQL OAuth application role (previously blocked); MUST NOT use the bootstrap SQL fixture administrator as a runtime identity. Also identify an approved Redis ACL/app credential before any UAT API service has Redis access.
2. Build a private loopback two-process UAT HTTP API with a real Redis Node client, shared OAuth rate-hit/budget, signed JWT verification and PostgreSQL one-time consume; use only fabricated identities/keys. Protect IP attribution against spoofed forwarding headers, hash privacy-sensitive client identifiers before storing in Redis, and count **failed credential attempts**, not legitimate successes, to preserve existing semantics.
3. Test API loss/restart, Redis outage, database loss (fail-closed), quota/billing consistency and agent/Local Wall A/B separation. Do NOT assert app compatibility until real OAuth endpoints are tested. Then instrument p95/p99 event loop, CPU, memory, Redis script latency and 100→500→1000 realistic simulated sessions.
4. Fleet durable queue/worker lease fencing needs device OS-side enforcement, not merely SQL. Billing/cross-account Team execution remains blocked until owner/grant identity verified.
5. Production data migration, backup, rollout or cutover needs separate explicit owner approval, backup/replay/rollback strategy and customer session preservation.

## Resume commands (approved VPS-ARM, no production access)
```bash
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform
git status --short
node platform-v2/test/concurrent_redis_rate_uat.mjs
bash platform-v2/scripts/check.sh
python3 platform-v2/scripts/migrations_uat.py verify
```
