# Light Remote — MJS-only scaling architecture audit
**Date:** 2026-10-11 (Asia/Ho_Chi_Minh)
**Branch:** `feature/rc50-mjs-scale-20261011`; base `6ab88ec` + PostgreSQL/Redis UAT commits.
**Owner direction:** CANCEL React/TypeScript/Fastify migration. Keep Node.js ESM `.mjs` and existing Express 5, MCP, OAuth, Operator, Local Wall/Agent. Reorganize within ESM, scale deliberately.
**Data boundary:** SOURCE CODE ONLY. No reads, snapshots, imports, copies, migrations or shadow syncs of production customer/account/session/device/Paddle/ERPNext state. PostgreSQL/Redis containers remain isolated synthetic UAT. No production deployment, release or client change.

## Executive conclusion
Light Remote's present Node.js language/runtime is not the immediate scale blocker. Server state is split across synchronously rewritten JSON snapshots and local `Map` instances, which limits *safe horizontal replication* and may block Node's event loop as active customers/devices increase. Further material risks are per-process OAuth replay/rate limits, in-memory fleet queues/operations, and webhook idempotency across instances. Simply allocating additional CPU/RAM will not preserve correctness when multiple API/Operator processes independently mutate state.

**User target:** several thousand accounts; 20% concurrently active. Example *5,000 registered / 1,000 online* is NOT 1,000 simultaneous remote jobs. Capacity test must distinguish browser/MCP connections, long-poll heartbeats, requests/s, jobs in flight and per-device OS limits; do not infer readiness from HTTP /healthz or small DB concurrency fixtures.

## Confirmed source evidence — priority by data-integrity risk

| Priority | Source location | What source implements today | Why it affects scale | Correct target |
|---|---|---|---|---|
| P0 | `operator-host/account-registry.mjs:62-73` | Accounts, sessions and signup tokens in Map, serialized as full JSON using `writeFileSync`/rename | Blocks event loop; separate instances would diverge or overwrite snapshots | PostgreSQL transactions with same account/token ID and expiration contracts, migration parity tests |
| P0 | `operator-host/usage-registry.mjs:26-31,55-66` | JSON snapshot; `summary()` calls `_accrueOpen()` and traverses all active connections; may persist | Metering a single active owner can create O(C) global scans and writes | PG owner/month ledger+aggregate, idempotent event IDs, no global accrual on each read |
| P0 | `plugin-server/oauth.mjs:11,43-44,150-174` | `usedCodes`, `usedRefresh`, `usedResume`, failure buckets are process-local Maps | Authorization-code and refresh-token single-use checks do not coordinate across multiple replicas | Atomic consumed-hash records in PostgreSQL with TTL; distributed rate limiting; preserve issuer/audience/PKCE and existing tokens |
| P0 | `operator-host/fleet-router.mjs:23-29,100-155` | Nodes, in-flight jobs, queue and completed commands stored in per-process Maps | Node crash loses queue context; second instance cannot honor device ownership and claim state | Durable job DB, monotonic fencing generation, bounded per-device work queue + reconnect semantics; OS-side abort |
| P0 | `operator-host/pro-team-registry.mjs:17-32` | Team members, invites, grants kept in Map and rewritten to JSON synchronously | Concurrent invites and revokes across operators can oversubscribe seats or authorize stale member | PG Team owner+4 member cap, transactions, member/device A/B proof, authoritative entitlement |
| P0 | `plugin-server/paddle-billing.mjs:116-138,1261-1316` | Webhook state in JSON with synchronous `saveState`, retained event window capped to 1,000 | Possible replay window/state divergence after restart/multi-instance; event dedupe is not a global ledger | PG unique Paddle notification IDs + transactional outbox and ERPNext idempotency/reconciliation |
| P1 | `plugin-server/device-public.mjs:11-19` | Device/login/channel IP rate limits are in-process buckets | Multiple replicas multiply allowed requests and bucket memory | Redis atomic bounded TTL limiter, fail-closed for security authorization |
| P1 | `plugin-server/server.mjs:82-103` | Fresh MCP server and HTTP transport created and closed for every POST | CPU allocation/GC and initialization cost at high RPS; not necessarily incorrect | Measure p95/p99 and heap; optimize only after contract-preserving A/B load UAT |
| P1 | `operator-host/executor.mjs:120-126,77-83` | In-process jobs Map, operation dedupe Map, replay Map, SSE client Set, output/event ring; job cache default 64 MiB | Stateful response retrieval and SSE notifications are sticky; per-process memory scales with output/fan-out | Durable job metadata/output retention, explicit sticky routing for active device IO, capped buffers and backpressure |
| P1 | `operator-host/session-manager.mjs:17-25,118-179`, `operator-host/executor.mjs:86,141` | Configurable `maxActive`, default 5 per Operator process; open() rejects when full | Configuration is a device/operator ceiling, not global application capacity; cannot just raise to 1000 | Per-device worker limits and fair queued dispatch; partition many customers over instances |
| P1 | `plugin-server/server.mjs:32`, `plugin-server/operator-client.mjs:7-28` | 12 MiB inbound JSON and buffered upstream JSON responses | Many simultaneous large frame/result envelopes increase peak memory | Object storage or chunk/stream large frames, individual size caps, backpressure |
| P2 | `plugin-server/server.mjs:57-63` | Static guide/home HTML read synchronously for every request | Avoidable event-loop disk IO at high anonymous traffic | Load/cache immutable web assets once with ETag/invalidation and CDN caching |

This table is **source-confirmed architecture inventory and risk analysis**, NOT a proof of a current production outage, customer data loss, compromised OAuth, webhook duplicate billing or insufficient server capacity. `platform-v2/scripts/scale-static-audit.mjs` reports 12 precise source-only rules; its purpose is to catch changed patterns, not to imply bug severity from grep alone.

## Present runtime / supporting boundaries
- Chain: ChatGPT MCP → `plugin-server/server.mjs` (Express 5) → `plugin-server/operator-client.mjs` (bounded HTTP over owner Unix socket) → `operator-host/executor.mjs` / `fleet-router.mjs` → mutually authenticated device-channel/agent/Local Wall.
- Public web and OAuth can become horizontally stateless **only after** one-time tokens, account sessions and shared abuse controls are durably coordinated. Do not split the current Operator's in-process session/job state among replicas without device-affinity fencing and durable queue.
- PostgreSQL 17 + Redis 8 already running **only** as `lightremote-rc50-v2` Docker UAT with internal-only network, no published host port. Seven schema migrations and synthetic concurrency tests passed; DB app role with least privilege is still unprovisioned. Neither database is reachable from production through an approved app connection. Do not enable database-owner credentials in an Operator.
- Current shared VPS ARM (read-only inspection): 23 GiB total RAM, ~16 GiB available; disk 121 GiB, 78% used; swap 1.7 GiB used. This is a single sampled host measurement with other workloads; it is **not** a benchmark nor a production resource reservation.

## Proposed MJS module structure (behavior-preserving)
```text
services/
  identity/      account.mjs  sessions.mjs  oauth.mjs  policies.mjs
  devices/       enroll.mjs  pairing.mjs  grants.mjs  presence.mjs
  operations/    dispatch.mjs  leases.mjs  session.mjs  output.mjs
  teams/         team.mjs  seats.mjs  invites.mjs
  billing/       paddle.mjs  entitlements.mjs  erpnext-outbox.mjs
  notifications/ inbox.mjs  schedule.mjs
infra/
  postgres/      pool.mjs  migrations.mjs  repositories/*.mjs
  redis/         rate-limit.mjs  cache.mjs  queue-signals.mjs
  telemetry/     metrics.mjs  tracing.mjs
api/
  account.mjs  admin.mjs  mcp.mjs  operator.mjs
```
Use dependency injection/repository interfaces, not another framework conversion. Existing URLs (`/account/api`, `/admin/api`, `/mcp`, OAuth metadata) and device wire protocol remain compatible. No production API behavior should change during the separation.

## Execution order / acceptance gates
**Phase 0 — done:** Stop and archive React branch, establish clean MJS-only source and retain UAT PostgreSQL/Redis. The isolated staging `/portal-next/` preview may remain deployed until a separate controlled staging-route cleanup; it is **not** a production route or target architecture.

**Phase 1 — source-only, synthetic UAT:** Extract first non-mutating modules with contract tests (account/usage, oauth, device/Team, billing) and avoid live state. Harden synthetic quota update races, idempotent Paddle event transaction/outbox, persistent lease/fencing and old worker OS abort simulation. Add DB app role through authorized least-privilege path, never work around a tool safety block. Use synthetic JSON fixtures that reproduce every relevant legacy field; do not read any customer registry file.

**Phase 2 — isolated service UAT:** Install independent MJS Operator/API canary in separate environment with synthetic users/devices and a private authenticated network to PostgreSQL/Redis. Port relevant existing unit/E2E tests; verify OAuth code/refreshed-token single-use on 2 instances; Team actor/owner A/B isolation; zero double quota/billing; failing Redis; database reconnect and outbox poison messages; worker leases survive restarts and stale OS jobs cannot finish.

**Phase 3 — capacity and chaos tests:** Load 100 → 500 → 1,000 *active synthetic sessions*, multiple connection/job workload mixes, separate HTTP and device-channel streams. Observe CPU, RSS, heap, event loop lag, GC pause, PG connection-pool wait, Redis memory/evictions, outbound bandwidth, E2E p50/p95/p99, queue wait, failed requests, reconnect recovery and lost/duplicated jobs. Use bounded test duration, resource ceilings and no shared production device/IPs. Set SLO from measured baseline; do not assert an unsupported RPS number.

**Phase 4 — owner-authorized migration, NOT STARTED:** Preserve existing account identities, password hashes, session cookies/TTL, keys, device identity, OAuth issuer/PKCE, A/B grants, Paddle and ERPNext reconciliation. Independently snapshot/test restores, start one legacy authoritative writer with replayable shadow event stream, verify 0 unresolved mismatches. Separate owner approval is mandatory before ANY production state read/copy/import or traffic cutover. Never authorize dual active writers.

## Risk register not closed
- **Blocker:** live operator account/session/usage/fleet JSON persistence still authoritative; DB adapters not integrated.
- **Blocker:** app DB role permission, network boundary, backup/restore and key continuity.
- **Blocker:** OAuth one-time replay, subscription webhook idempotency, Team A/B identity and real agent abort across instances.
- **Blocker:** no representative 1,000-session synthetic load test; no production readiness claim.
- **Open:** GitHub remote write/CI had prior 403, must confirm PR/CI before release.
- **Open:** 15 owner-internal registries, GUI Windows/macOS/Linux client and download/updater runbooks remain a broader validation surface; this is a **server scaling audit**, not full native GUI acceptance, signing or production security penetration test.

## Evidence, repeatability and audit commands
```sh
# On MJS-only worktree; reads source code, not live data:
node platform-v2/scripts/scale-static-audit.mjs
bash platform-v2/scripts/check.sh
# All database mutations from check.sh are generated UAT fixtures with ROLLBACK
# or explicitly cleanup-protected synthetic account prefixes.
```
