# Gold PG-only integration gate — authoritative source status (2026-10-17)

## Acceptance target from owner

The new Light Remote instance must continue functioning independently even if the old production is offline (hypothetical test, **not a request to stop production**). This includes Operator, Plugin, API, V4 site/Admin/Account, enrollment, A/B pairing, Team/Inbox, billing, support, client downloads, security checks, and reconnect/resume. All **business-authoritative data** must be PostgreSQL 17; Redis 8 only manages ephemeral TTL, rate limits, leases, caches and coordination.

The following **are NOT standalone business databases** and may remain encrypted files when justified by key-management policy: private signing keys, runtime certificates, installation artifacts, static assets, nonauthoritative process logs and configuration.

## Decision: stop treating individual PG adapter unit tests as Gold completion

The `feature/production-gold-pg-redis-20261017` branch contains many **source-only, independently tested** PostgreSQL/Redis repositories and migrations 001–016. It still boots its default Operator and Plugin with JSON-backed or process-local registries. The historical RC.50 PG repositories are UAT-scoped and are not a production runtime replacement.

**New mandatory check:**

```bash
npm run gold:cutover:check
npm run gold:cutover:test
```

The first command emits machine-readable per-domain blockers and deliberately exits nonzero until ALL known business-state authorities are wired to verified PostgreSQL (or Redis if exclusively ephemeral). The second tests fail-closed startup for both processes, including the requirement that partial canary flags cannot pass the entire system. Full Gold mode is `LR_GOLD_PG_ONLY=1`; while incomplete, **Operator/Plugin refuse startup before listening**. Existing production/default startup behavior is unchanged.

The audit currently covers **23 major known state domains, none accepted as fully converted**. This is not a claim that source modules have zero PG work; it says the default runtime still has a live legacy path. There may be additional minor writer paths; the final runtime audit must close those as well. The source-scanning gate is necessary but never substitutes for live tests.

## Core migration — the part that was still missing

**One integrated Core release, not dozens of unrelated canaries.**

1. **Identity/authorization:** Replace the synchronous `AccountRegistry` and its multiple maps (accounts, account sessions, email/pending registration, password/reset/owner proofs, Google intents, group membership, entitlement) with transactional PG-domain services. Update all callers and account authentication endpoints to `await` durable writes/reads. Never retain a synchronous JSON snapshot as another source of truth. Password hashes and OAuth one-time proofs must remain protected/one-time.
2. **Device/connection/A-B:** PG-authoritative enrollment binding, inventory, reconnect grace, device connection, A/B request and one-use approval, agent/client sessions and revocation. Use transactions, unique keys and compare-and-swap lease/version checks. Reject expired grants; a revocation must survive restart and be visible to every worker.
3. **Fleet/usage/Team:** PG jobs, result/outbox, quota, account billing authority, Team memberships, device sharing, approvals and Inbox. Redis TTL is **not sufficient for permanent entitlement, usage charging or lease history**.
4. **Plugin/payment/public API:** Replace remaining OAuth, Paddle billing state/idempotency, recovery, admin, Google OAuth, support and content writers. Preserve V4 UI behavior and route contracts. PG/Redis connections must be shared/health-checked and fail closed instead of falling back to JSON.
5. **Reconcile signed client artifacts** and pass Windows/macOS/Linux API compatibility and A/B user journeys before Gold product acceptance.

## Hard external acceptance gates

- A new isolated PostgreSQL 17/Redis 8 environment has **NOT actually been started**. A prior Light Remote Docker start returned `target_node_capability_missing`; effective device policy wins. **Do not bypass by changing tools/targets, dropping declared Docker capability or using sudo.**
- Gold database credentials must be separate from production and rc.50 UAT. Run locked migrations and role hardening, prove the non-superuser app role and denied unintended permissions on the real PostgreSQL instance.
- Prove account/device/Team/OAuth/billing state survives cold restart of both Operator/Plugin, without loading any JSON or SQLite business database. Prove revocation, replay protection, A/B approval and disconnect across **two processes**.
- Confirm the latest Windows rc48/macOS rc49 client source is authorized and compatible; a prior source replacement operation was locally denied. Do not circumvent.
- Conduct full API/UI E2E and restore rehearsal **without touching production**. No accepted Gold status without green results from this real environment.

**Status: BLOCKED FOR GOLD ACCEPTANCE.** There is no verified production-independent all-PG/Redis system yet. No cutover or production stop is authorized.
