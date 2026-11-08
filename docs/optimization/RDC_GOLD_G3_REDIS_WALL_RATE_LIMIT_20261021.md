# G3 Gold — Redis-backed signed-channel quota + Local Wall status backoff (2026-10-21)

**Scope** `feature/light-remote-gold-rebuild-20261018` **ONLY**. The owner explicitly forbids touching production. Screenshot `wall.dashboard.thaiduy.store` currently shows `local · cloud connected · status rate limited`; that Wall is served by an existing production `/opt/gpt-operator-agent/current` process on VPS-ARM and cannot be changed in a Gold-only patch. **Do not claim the production banner is fixed** until a separately owner-approved production release. No production service changed in this checkpoint.

## Actual diagnosis

- `device-agent/local-wall.mjs::renderHeader` produces the literal `status rate limited` only when signed `getRemoteStatus()` returns a 429 or `rate_limited`. The browser retains `cloud connected` because the local lease still reports connected; an observer quota denial does **not** mean the Agent/remote command route disconnected.
- Current source `operator-host/executor.mjs::enforceTrustedChannelRate` used in-process `Map` fixed-minute buckets, keyed by device/lane, observer budget default **240/min**. Plugin `device-public.mjs` independently already uses Redis for unauthenticated/public per-IP traffic, and can also return 429. The screenshot alone doesn't prove **which** limiter returned the 429; do not claim a confirmed numerical overload.
- Local Wall /api/status did signed remote query **once per browser request**, no shared TTL. Multiple tabs and SSE event refreshes increase those queries. Legacy Wall deployed on the VPS-ARM is not the Gold source.
- Gold already has an authenticated Redis client (`goldStorage.redis`) and `lr:gold:<instance>:` namespace, isolated inside `light-remote-gold-uat`. No Cloudflare proxy API, Worker, CDN or WAF is involved or needed.

## Source patch

1. `operator-host/trusted-channel-rate-limiter.mjs`: use atomic Redis `INCR` + TTL in Lua, device SHA-256-scoped key per minute/lane (runtime/observer/fleet/control/rm-live), original env-configured quotas unchanged. Count only **after Ed25519 channel proof verification**. Return original `429 rate_limited`, `scope=device-channel-<lane>`, bounded `retryAfterSeconds`. Redis error -> deterministic **503 fail-closed**, never silently create a local fallback counter. Clean Redis expiry prevents immortal in-memory buckets.
2. `operator-host/executor.mjs` + `executor-routes-device-channel.mjs`: replace in-memory Map limiter; await Redis validation in all 25 signed routes, including streaming hello. Cross-process count is consistent.
3. `device-agent/wall-status-cache.mjs`: one remote request per 12s per device on the **same Wall server**, deduplicate concurrent callers across tabs, back off according to bounded Retry-After after 429, preserve last known remote status marked **stale/cached**, refresh on device change/disconnect; never present stale remote data as a new live successful response. Report remaining retry seconds.
4. `device-agent/local-wall.mjs`: use cache for ordinary status polling, show `status cached (rate limited)` when rendering known stale state. B-code approval lookup uses `force:true`, bypassing TTL on explicit owner intent so newly created pairing doesn't become invisible to Wall for 12s. The server still validates all authorization and quotas.
5. Client release manifest `client/core-files.json` and host-wall installer `deploy/scripts/install-host.sh` include the new `wall-status-cache.mjs` module, avoiding broken staged imports on Windows/macOS/Linux. Gold CI adds `selftest-g3-redis-wall-status-rate.mjs`.

## Verification

- Synthetic isolated deterministic regression: Redis shared quota/device/lane/minute; fail-closed outage and namespace validation; Wall 12 simultaneous calls → one upstream read; bounded 429 backoff with stale flag/recovery; disconnect/reset; manual B approval refresh. All marked PASS on VPS-ARM.
- **Actual Gold LXD Redis** smoke with `gold-uat` user, active Redis URL read locally without exposing credentials: atomic `INCR` across two independent limiter instances and key TTL PASS; transient test key removed. Gold service remained healthy.
- G3 previously accepted real Windows #453 read-only 20-second PowerShell job across isolated Gold Preview proxy restart, exactly one `queued/dispatched/completed/finished` event in observed Operator activity, stdout marker correct. No proof of exactly-once for arbitrary side-effecting commands. Strict admission remains OFF.

## Safe deployment rules / next gate

- Never mutate `light-remote-direct`, production Local Wall `/opt/gpt-operator-agent/current`, Cloudflare or NetBird. Preserve preexisting GitHub Release→R2 sync and pg-cloudflare transitive dependency.
- For isolated Gold UAT cutover only, use immutable SHA candidate, code+Postgres+systemd backup, exact source parity, zero active sessions/jobs, 10 stable health samples and proven rollback. Keep strict OFF. Do not call the production banner resolved by a Gold UAT rollout.
- Then physical soak N/p50/p95 and RSS and Gold-only strict gate before G3 DONE; G4 unopened.
- Four preexisting untracked deploy UAT paths remain untouched.
