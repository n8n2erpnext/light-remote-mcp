# Light Remote rc50 P0-A/C — Real local HTTP ingress freeze + partial drain (2026-10-13)

**Base:** `7b5d2237ba4295b337f637ef9fe4b80d41b69cda`
**Worktree:** `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform`
**Branch:** `feature/rc50-mjs-scale-20261011`
**Environment:** Source + private loopback Node unit/HTTP tests on VPS-ARM; NO deployed Operator/Plugin restart and NO live owner/device traffic.
**Architecture:** Node.js ESM `.mjs` / existing Express 5. No TS/Fastify rewrite.

## Motivation / precise delivered scope

Prior `7b5d223` brought individual JSON writer durability to **16/18**, but global epoch / maintenance ingress/drain remained absent. This work provides **a process-local, dev-opt-in maintenance ingress freeze boundary on ACTUAL Operator HTTP and Plugin HTTP**, a limited source of checkpoint observability. This is a genuine real-code mutation admission boundary, NOT a PostgreSQL-backed election, global writer authority, cross-host fence or complete background job drain. No security approval is granted by this gate.

## New shared module

`lib/local-ingress-freeze.mjs`: `LocalIngressFreezeGate`
- Default: freeze is disabled unless explicitly constructed with `enabled:true` (both runtimes enable only when `LR_RC50_DEV_LOCAL_FREEZE=1`).
- `admitHttp(req,res,{health})`: counts each pre-freeze HTTP request until `res.finish` or `res.close`, exactly once; if phase is freezing/frozen returns fail-closed HTTP **503** with `retry-after:60` for all new requests other than exact read-only `GET /healthz`. Streaming/SSE requests count as open until their response ends/closes.
- `beginWork()`: counts explicitly wired background work; refuses new work after freeze starts and gives a once-only release function.
- `freeze()`: explicit one-way local open→freezing→frozen state transition with monotonically increasing in-memory `revision`. A freeze resolves only when locally tracked HTTP/background work has finished. No API to unfreeze. If process is restarted, revision and phase reset — **NOT crash-persistent**, so absolutely NOT a global cutover fence.
- `snapshot()`: phase, revision, in-flight count and whether the *local tracked* work drained.

## Actual dev wiring

1. **`operator-host/executor.mjs`**: instantiates gate before service setup; gates every Unix-socket HTTP request before any route parser/handler, except exact `GET /healthz`. Health includes `localFreeze` snapshot. Local integrated-device heartbeat and device connection reaper timers are paused once gate is not accepting. With opt-in, `SIGUSR2` invokes one-way freeze and logs `rc50_local_ingress_drained` only once tracked ingress requests reach zero. **The log explicitly states** Operator background jobs and multi-host writers are NOT fenced.
2. **`plugin-server/server.mjs`**: same gate inserted directly after host-header validation, BEFORE Paddle webhooks, OAuth, account routes, MCP and public device endpoints. Therefore even unauthenticated mutating requests are stopped when frozen, but exact `GET /healthz` stays accessible and exposes phase. With opt-in, `SIGUSR2` triggers local one-way freeze; logs warning about other processes/writers.
3. **`plugin-server/support-backoffice.mjs`**: `registerSupportBackoffice` now optionally accepts `beginBackgroundWork`, default preserving prior behavior; scheduled support-outbox pump invokes the admission hook. A pump already accepted runs to completion, and its completion is tracked before local drain; new scheduled pump runs skip while frozen. This does not cancel an already running remote ERPNext call and does not freeze all plugin background work.

## How to reproduce safely (dev/isolated instance only)

**Do not signal deployed production processes** and do not set this env var on live hosts. For a separately provisioned test process only:
1. Start that process with `LR_RC50_DEV_LOCAL_FREEZE=1` and isolated state/socket/ports/credentials.
2. Confirm exact `GET /healthz` responds with `localFreeze.phase="open"`.
3. In the isolated test environment only, send **SIGUSR2** to its PID. Operator and Plugin are **two different processes** and must be signaled separately; one process's local revision does NOT fence the other.
4. After freeze begins, any NEW non-health HTTP request returns 503 `local_ingress_frozen`; `GET /healthz` remains 200 with `phase=freezing` if a tracked HTTP/SSE/outbox action remains in-flight.
5. Once the tracked actions finish, health shows `frozen` and the log shows a local drain marker. A stalled SSE or pump can keep the gate in `freezing`. There is **no trustworthy multi-file checkpoint watermark** and no unfreeze action; restart reopens ingress and therefore is unsafe as cutover authority.

## Test evidence, executed on VPS-ARM

```sh
node --test platform-v2/test/local-ingress-freeze.test.mjs
# 7/7 PASS: disabled-by-default and opt-in, in-flight HTTP drain,
# 503 on new POST, health available, background pump accounting,
# idempotent terminal freeze, real source wiring checks,
# actual local 127.0.0.1 ephemeral HTTP request fixture
node --test platform-v2/test/*.test.mjs
# 41/41 PASS, entire platform suite
node --check lib/local-ingress-freeze.mjs
node --check operator-host/executor.mjs
node --check plugin-server/server.mjs
node --check plugin-server/support-backoffice.mjs
git diff --check
# PASS
python3 -B platform-v2/portability/audit_writer_freeze_readiness.py
# PASS but NOT_READY: fsync_proven=16, fsync_not_proven=2,
# single_writer_authority_proven=false
```

Test fixture binds to a random local loopback port, calls fetch for an admitted POST, triggers local freeze programmatically, verifies a new POST gets HTTP 503, `GET /healthz` still works, and the admitted POST then completes before `frozen`. It does NOT launch or exercise actual deployed Operator/Plugin or external APIs.

## P0 still open: what this does NOT prove

- **Global writer epoch**: this gate is in-memory, per-process, opt-in and reset on restart. No PG/Fleet/Agent shared lease, cross-instance monotonic generation, old-host cutoff, transactionally enforced writer revocation or signature origin. A signal to one process cannot stop another process or old server.
- **Complete quiescence**: Operator PTY, SCP, RM, Agent/Fleet dispatch, already accepted asynchronous jobs and some background timers may continue after HTTP response completes. Only local HTTP, integrated device heartbeat/connection reaper and scheduled support-outbox pump are covered; no durable audit/job/outbox watermark proving all writes stopped. A health `drained:true` refers ONLY to these tracked paths. A long SSE can prevent drain indefinitely.
- **Durability**: 16/18 JSON writer surfaces have atomic file+dir fsync, but `account-registry.mjs` and `device-connection-registry.mjs` edits were safety-blocked in earlier turns and were not attempted or bypassed here. Multi-file atomic snapshot, crash-safe restore and cross-host move remain NOT_READY.
- **Real consent and release**: independently authenticated OAuth/Local Wall A/B/verifier-stage/Agent source, complete restore/rollback on AMD and rc50 multi-service CI are NOT_READY; previous persistent HTTP verifier Docker integration remains tool-blocked. No real payment, customer data or key touched.

**NEXT P0:** design and wire *durable shared writer lease/epoch* with source-side mutation checks across Operator/Plugin/Fleet/PTY, not another crypto-only synthetic receipt. Add operator job/outbox drain and a durable snapshot watermark; then test old writer cannot resume after restart/move, using nonproduction devices and data. This local freeze is a useful partial safety primitive, never a production cutover signoff.
