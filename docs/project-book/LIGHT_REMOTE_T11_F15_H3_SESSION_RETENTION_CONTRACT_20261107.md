# T11-F15-H3 — Session retention and audit decision contract

Date: 2026-11-07. Scope: **Desktop V4 source and GoldABV2 canonical session services only**. Production, Gold Lab, currently installed Windows client, real B approval and signed update feed are out of scope.

## Current verified storage

GoldSessionRedis persists the authoritative SessionRegistry snapshot to Redis 8 at its existing namespaced runtime:sessions key, with a **renewed 604800-second (7-day) key TTL on writes**. No immutable event archive is created. Its contents can disappear after inactivity/Redis key expiry. SessionRegistry prunes closed or expired sessions after its effective historyMs interval measured from their terminal timestamp; the runtime default is 604800000 ms but OPERATOR_SESSION_HISTORY_MS can configure another interval. Therefore **the snapshot TTL and per-terminal retention interval are not interchangeable**, and neither guarantees recovery of any older individual session. Redis restart recovery does not prove execution survived restart.

Existing PostgreSQL GoldJobLedger retains a different class of data: bounded Owner-scoped job metadata, subject to its own GC. It does not create a permanent session ledger.

## H3 implementation decision

**Keep bounded recovery and explicit provenance, with NO indefinite audit enabled by default.** This source patch does not change Redis TTL, historyMs, storage schema, Account authority, session close behavior or Device Policy.

GoldSessionRedis.retentionPolicy(registry) exposes only immutableAudit=false, snapshotTtlSeconds=604800, terminalPruneAfterMs=registry.historyMs. It returns no Redis key, workspace, script, output, PII fields, token or raw snapshot. A missing/invalid backing contract is a server error, not an invitation for the client to infer lifetime.

For a signed Owner session-history page, Operator derives scope from current Owner membership. SessionRegistry.list() performs terminal pruning; the Redis backing then flushes the corresponding deletion before returning. After each asynchronous boundary, Operator rechecks live Owner session/email/status and device membership/revocation. If storage persistence or authorization changes fail, it refuses the page rather than sending a stale or ownerless row. A cursor remains scoped to the Owner/kind/current member revision, and a changed set requires restart.

The private Owner portal accepts retention metadata only with the Redis-retained session source. Native WebView projection validates fields and strips untrusted extras. UI displays the 7-day **renewable snapshot TTL** and actual terminal-prune interval as distinct limits; it explicitly says the data is not an immutable archive. Read-only: Owner close, job cancellation and execution are not granted.

## Verification evidence and nonclaims

Source tests include fake Redis TTL expiration without writes; restore of a retained terminal session after restart; flush of terminal prune before successful Owner response; cross-account/device-owner change during async flush; Redis failure denial; source-kind marker and metadata tampering; native no-secret projection; and UI retention display. Gold CI and Windows/macOS/Ubuntu native CI remain a separate exact-SHA gate before declaring H3 fully validated.

A fake Redis clock test is **not** a live Redis 8 integration/production load test. Separate PostgreSQL job p95 measurements from H2 cannot be reused as Redis latency metrics. No real Owner/B physical acceptance is claimed.

## Optional separate immutable session-event audit (not authorized or implemented)

A future product decision must specify a finite retention window and legal/privacy basis, necessary event types and minimum fields, Owner access versus agent access, storage location/encryption, concurrency and ordering, signed integrity/anti-replay model, repair/erasure on Owner removal or device unlink, export scope, migration/rollback, and GC/p95 budget. A minimal candidate record might contain account scope, device scope, session ID, event kind, occurred-at, and a bounded reason code; **do not record workspace, command, console content, filename, access token, approval secret, full label or unbounded metadata**. Do not repurpose an existing audit table for new indefinite session history without checking its schema, permissions and retention.

Default disposition: **no extra store, no migration, no indefinite audit**. Only proceed after the Owner explicitly selects a bounded audit/retention policy and approves the separate data-purpose design. This decision is independent of source-only H3 recovery/provenance tests and physical Owner/B UAT.
