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

## 2026-10-17 one-pass relational Core implementation checkpoint

**The owner requested a single full-stack pass, not more adapter-level completion announcements. This iteration has completed a large SOURCE implementation but has NOT completed the operational cutover.**

- Added immutable Gold-only `017_gold_core_identity.sql` on top of unmodified historical migrations 001..016. It extends normalized `lr_accounts`, `lr_sessions`, `lr_devices`, A/B brute-force protection and adds `lr_team_devices` and `lr_ab_team_actor_grants` with PostgreSQL FKs. The locked schema manifest now has **17 migrations and 40 tables**, with 39 business tables distinct from the read-only migration ledger.
- `platform-v2/src/storage/gold-core-authority.mjs` provides transactionally committed normalized PostgreSQL operations for verified account registration, scrypt password login, SHA-256 bearer sessions, session logout, administrator disable with atomic revocation of session/connection/grant/request rights, device identity registration with a trusted proof verifier, connection-cap enforcement and reuse, one-time local-Wall-gated encrypted B approval, owner/team grant verification across active SQL relationships, OAuth one-time token issuance/consumption, and Paddle signature-verified event ledger/idempotency.
- `platform-v2/src/storage/gold-team-usage-authority.mjs` adds PostgreSQL-backed Pro Team creation requiring active entitlement, hashed single-use invite, member acceptance, device sharing, member revocation closing grants, and owner-billed event accounting under advisory transaction lock. Usage requires verified job evidence and an active AB grant; Team charging additionally requires membership/sharing and an explicit Team budget, with owner and team counters updated together.
- `platform-v2/test/gold-core-authority.test.mjs` (8 tests) and `platform-v2/test/gold-team-usage-authority.test.mjs` (7 tests) exercise the critical transaction interfaces and fail-closed security boundaries using injected PostgreSQL mocks; these prove source behavior but NOT true PostgreSQL locking, multi-process delivery or a functioning HTTP API. `npm run gold:core:test` is the focused reproducible command.

### Independent Core HTTP and private Unix socket source — 2026-10-17 follow-up

- New `platform-v2/src/http/gold-core-http.mjs` maps core relational methods to native HTTP routes for registration/login/me/logout, device enroll/connect, Team operations, private A/B request/approval, OAuth one-time consume, Paddle signature receipt and usage charging. Bearer authentication is required for user-scoped mutations. Privileged ingress is bound **only to trusted callback results**, not caller-controlled body fields; unsupported methods, invalid JSON and oversize bodies fail explicitly. The underlying authority still validates proofs and commits writes.
- New `platform-v2/src/http/gold-core-server.mjs` prepares a **standalone Gold Core component**, opening the verified independent PostgreSQL/Redis data plane **before binding** a private Unix socket (0600 under a private 0700 directory). It refuses missing trust verifiers, failed data-plane admission or existing socket path. On shutdown it releases connections and removes only its own Unix-socket inode. `/healthz` explicitly reports `cutoverComplete:false`.
- New HTTP/network tests `platform-v2/test/gold-core-http.test.mjs` and `gold-core-server.test.mjs` exercise native Node HTTP requests on loopback/Unix sockets with **injected fake authorities and fake data-plane**. A third test, `gold-core-http-sql-roundtrip.test.mjs`, follows real HTTP requests into the actual `GoldPgCoreAuthority` and its parameterized SQL calls using a fake PostgreSQL pool: signup, failed login rollback, login, bearer session access, logout and revoked-session denial. `npm run gold:core:test` includes all three; none is a real PostgreSQL server test.
- **Do not claim production API integration**: the current Operator's canonical routes still use the legacy sync registry graph. There is no configured trusted-verifier package yet for the actual Gold listener, no running PostgreSQL 17/Redis 8, no migration application to a real DB, and no real device or billing E2E. This new component has source wiring and mock-backed HTTP coverage, not a released Gold Operator/Fleet.

### Core-only launcher and live readiness — further source checkpoint

- Added `platform-v2/src/http/gold-core-entry.mjs` with CLI `npm run gold:core:boot`, strictly accepting only an **owner-provisioned 0600 trusted verifier module** inside the independent Gold root with all callback functions and a private AES key. It refuses to open the data plane if any verifier/key is missing. No credentials or fake verification code are generated.
- `platform-v2/src/http/gold-core-server.mjs` now health-checks actual PG (`SELECT 1`) and Redis (`PING`) for every `/healthz` or `/readyz` request; a database outage produces HTTP 503 rather than stale startup-green health. Private Unix socket shutdown protects against unlinking an unrelated socket inode.
- `platform-v2/test/gold-core-entry.test.mjs` checks private file permissions and fail-closed admission; `gold-core-server.test.mjs` checks healthy and unhealthy dependency transitions. Documented prerequisites in `docs/releases/GOLD_CORE_BOOTSTRAP_20261017.md`.
- **This is still ONLY a launchable Core component source.** No actual Gold PG/Redis runtime was started and no complete verifier module is provisioned. The full 23-domain Gold cutover remains blocked. Never report the complete Light Remote application as running.

### Incomplete production bindings — MUST remain blocked

- **Operator:** still starts `AccountRegistry`, `SessionRegistry`, `EnrollmentRegistry`, `DeviceRegistry`, `DeviceConnectionRegistry`, `DeviceAccessGrantRegistry`, pairing/Team/Usage registries and native jobs from legacy state/memory when ordinary runtime is started. New relational services are deliberately NOT substituted into these complex synchronous route dependencies without updating every API, channel, reaper and writer. Enrollment signing/certificates, `poll/recover` A/B, trusted verifier concrete implementations and Fleet worker/result authority remain to integrate.
- **Plugin:** OAuth OIDC/PKCE, account portal, Google, Paddle webhook+subscription entitlement, account recovery, support send worker and Admin still have legacy functions and/or unapproved external-side-effect paths. New Core Paddle method only records an authenticated event ledger; it does not grant or revoke actual subscriptions.
- **Data plane:** a real isolated Gold PostgreSQL 17/Redis 8 instance has NOT been started or migrated. The earlier Docker target capability denial remains a hard local policy boundary; do not bypass. New tests use mock PG clients, and no real restart persistence or cross-process revocation test has run. Existing rc48/rc49 client compatibility remains unresolved.

### Acceptance consequence

The required `LR_GOLD_PG_ONLY=1` full-system gate still refuses both processes before socket/port bind. `npm run gold:cutover:check` is the objective current blocker inventory (23/23 domains unaccepted). New SQL repositories DO NOT mean runtime routes have changed. Do not label Gold ready, do not stop production, and do not claim a time-to-completion without legitimate Gold database access and E2E results.
## Further Gold source hardening — A/B recovery and live dependency enforcement

- Migration **018_ab_pairing_recovery.sql** adds an explicit one-request-to-one-approved-grant foreign-key reference and account binding for poll capability holders. The API `POST /v1/pairing/poll` requires separately verified Agent ingress and a high-entropy poll token. This prevents ambiguous historical grant recovery, leaked public B codes and cross-account polling. Polling returns pending, approved or closed, and revocation/expiry closes an approved result.
- On Wall approval, a PostgreSQL transaction saves `approved_grant_id` on exactly the same one-use A/B request while creating its grant, and clears the encrypted approval B code. No JSON snapshot is used in the new Core authority.
- Both Core `healthz`/`readyz` **and every `/v1/` API request** now check live PostgreSQL and Redis before proceeding; a cache/DB outage returns HTTP 503 without accepting an authentication, A/B or payment request.
- The Gold data-plane schema admission gate now compares PostgreSQL's actual `public.lr_%` **table catalogue** against the complete checksum-verified migration table manifest; a manually spoofed or incomplete version ledger is no longer sufficient.
- Added negative tests for account-scoped A/B polling, revoked-grant recovery, database schema missing/unexpected tables, and API behavior during a simulated dependency outage. **All such tests are mock-based**; no actual Gold PG17/Redis8 runtime has run, and the full 23-domain runtime cutover is still blocked.
## Hard external acceptance gates

- A new isolated PostgreSQL 17/Redis 8 environment has **NOT actually been started**. A prior Light Remote Docker start returned `target_node_capability_missing`; effective device policy wins. **Do not bypass by changing tools/targets, dropping declared Docker capability or using sudo.**
- Gold database credentials must be separate from production and rc.50 UAT. Run locked migrations and role hardening, prove the non-superuser app role and denied unintended permissions on the real PostgreSQL instance.
- Prove account/device/Team/OAuth/billing state survives cold restart of both Operator/Plugin, without loading any JSON or SQLite business database. Prove revocation, replay protection, A/B approval and disconnect across **two processes**.
- Confirm the latest Windows rc48/macOS rc49 client source is authorized and compatible; a prior source replacement operation was locally denied. Do not circumvent.
- Conduct full API/UI E2E and restore rehearsal **without touching production**. No accepted Gold status without green results from this real environment.

**Status: BLOCKED FOR GOLD ACCEPTANCE.** There is no verified production-independent all-PG/Redis system yet. No cutover or production stop is authorized.

## A/B PostgreSQL runtime contract correction — follow-up 2026-10-17

- Audited the exact `GoldPgCoreAuthority.pollPairing` SQL projection against PostgreSQL/pg's object-row behavior. An owner request actor and the optional Team grant actor were both selected as `actor_account_id`; the nullable LEFT JOIN value could mask the verified owner Agent. SQL now projects `request_actor_account_id` and `team_actor_account_id` distinctly, checks the exact requester, and confirms current linked Team actor, member state, device sharing and active actor account before returning approved grants.
- Local Wall Team approval now rechecks the **immutable, PG-bound request actor** against active Team membership + active account inside the approval transaction, rather than requiring an Agent proof in a separate Wall's request context. The Agent was verified when the request was created and is independently reverified when polling. The owner-controlled Wall verifier still remains mandatory.
- Focused mock tests cover object-row alias shadowing, owner vs Team separation, wrong Team actor, revoked membership/device share, approval without Wall-owned Agent proof and rollback on a membership revoke. **No legacy JSON/SQLite path was added.**
- `node --test platform-v2/test/gold-core-authority.test.mjs`: 10/10 PASS. `npm run gold:core:test`: 45/45 PASS. These are **mocked SQL/source tests only**. Gold's 23-domain full runtime cutover is STILL BLOCKED; no independent PostgreSQL 17 / Redis 8 operational E2E, no canonical Operator/Plugin/Fleet migration and no production cutover. Do not infer acceptance from this fix.
