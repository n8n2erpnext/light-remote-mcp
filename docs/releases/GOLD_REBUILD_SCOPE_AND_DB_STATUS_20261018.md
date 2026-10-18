# Light Remote Gold Rebuild — scope and honest checkpoint (2026-10-18)

Branch: `feature/light-remote-gold-rebuild-20261018`. Gold development only. Production remains unchanged.

## Immutable source choices
- Windows rc48 + macOS rc49 source baseline: `2eb1553`. Native client trees and three shared native libraries are unchanged relative to this commit.
- Operator/Plugin/WebUI V4/R4 deployed LXD source: imported via new-branch commit `b5d365a`; six deployed file hashes were checked read-only against `light-remote-direct/current` on 2026-10-18.
- Pro Team, Inbox, Notifications, Offline AI Guide and relevant RC50 feature code: imported from `6ab88ec` into new-branch commit `7d0e1aa`.
- Docker/Fleet/Main routing and cross-platform Agent capability-denial corrections retained from discarded Gold: `ff66099` -> `b5850ca`, `1421ddb` -> `465aec3`.
- The discarded Gold Core/parallel Authority/WriterEpoch projects are not part of this branch.

## PostgreSQL 17 / Redis 8 migration changes (not acceptance)
- Reused the immutable RC50 SQL migrations 001–013 from `feature/rc50-mjs-scale-20261011`. RC50 documents confirm real database tests only with fabricated UAT data, NOT canonical HTTP/Operator writes.
- Added SQL 014 for canonical Site CMS and Analytics, and the canceled-by audit column for notifications. Immutable SHA manifest now covers all 14.
- Added `lib/gold-db.mjs` requiring independent database `light_remote_gold_dev`, non-superuser `lr_gold_app`, private 0600 secrets, schema ledger, least-privilege check, and Redis authenticated read/write. Database access fails closed; no legacy-file fallback in that connection.
- Replaced canonical Plugin Site Announcements file writer with transactional PostgreSQL CRUD and added PostgreSQL daily site-analytics storage. Public site interaction throttling is Redis-based.
- Replaced Operator Account Notification JSON-state implementation with direct PostgreSQL queries and updated its existing API routes to await them. Operator/Plugin entrypoints now request Gold DB connections before listening.
- Migration CLI `deploy/scripts/apply-gold-db.mjs` requires explicit Gold-only approval, separate migrator credentials, and immutable source checks. It has NOT been run.

## NOT complete; do not claim Gold is ready
- Remaining canonical JSON-file/Map business writers in Account/Auth, Device/Enrollment/A-B, Fleet/Job/Session, Usage/Team/License, Paddle/OAuth/Google/Support/Distribution/Admin and local device modules are NOT migrated.
- No independent Gold PostgreSQL 17/Redis 8 service has been provisioned or connected, and no real Gold API -> SQL record write -> restart -> read test has run.
- An explicit Light Remote job with `requiredCapabilities:['docker']` returned `target_node_capability_missing` before execution on the owner-approved VPS-ARM. Do not bypass the denial via PTY, another target, sudo or omitted capability.
- macOS rc49 focused source tests passed; old Account Portal source test expects pre-V4 home text and fails that outdated assertion. Source syntax and all 14 SQL SHA checks passed.
- Do not promote, deploy, or label the branch PostgreSQL-only until **all actual business writers** have been replaced, and real independent PostgreSQL/Redis and API E2E acceptance has passed.

## Only remaining goal
Complete canonical business storage replacement **in existing Operator/Plugin** (no parallel API), provision independently authorized Gold PG17/Redis8, prove real full-app CRUD + restart durability + A/B/Job/Fleet flows. Plain JSON for HTTP payloads/config/logs is not an application database.

## Next focused implementation checkpoint — same day (source-only)

- SQL 015 now defines `lr_gold_registry_documents` in **PostgreSQL**. Each domain payload is stored as PostgreSQL JSONB, not a filesystem JSON database; no production state is imported.
- Canonical Operator now mounts existing Account/Auth, Device, Enrollment, Connection, A/B grants, Agent Clients, Usage, License and Pro Team registries directly against this PostgreSQL table. Original business methods are retained, initialized with `stateFile:null`. No JSON database file is opened for these mounted registries.
- The existing Operator HTTP response helper waits for queued SQL commits before acknowledging success; snapshot writes fail closed. A single-writer PostgreSQL advisory lock prevents a second Gold Operator from using this snapshot-only path concurrently.
- Canonical Plugin Support Outbox now loads/saves its business state in the same PostgreSQL registry table; its Express response boundary flushes mutations.
- OAuth code/refresh/resume one-time replay state and login-failure throttling now use authenticated atomic Redis keys instead of process-local Maps; legacy client-JSON lookup is no longer called.
- Targeted synthetic registry persistence/restart test PASS; 15/15 migration hashes and source syntax PASS. **This is not a real PostgreSQL write/read test and does not authorize any release.**
- Sessions now use Redis 8 for transient state, preserving 7-day TTL and safely clearing assumed-running jobs after Operator restart. A focused fake Redis restart test passes; **real Redis has not been exercised**.
- **Still open:** Paddle billing JSON writer (edit blocked by safety tool); Google OAuth configuration/state; account recovery, remaining site/admin service paths, Job/Fleet Redis+PG durability, device-local business storage and remaining canonical writers.
- **Deployment blocked:** VPS-ARM Docker `target_node_capability_missing` through the declared Light Remote capability. No Docker bypass and no alternate transport used. Gold PostgreSQL/Redis independent stack not deployed; no full API end-to-end tested.

## 2026-10-18 continuation (Paddle, Google, source consistency)

- Device policy inspection listed `docker` as effective on VPS-ARM, but the exact authorized `docker compose version` call with required capability `docker` still returned `target_node_capability_missing` before process launch. No bypass or change to production.
- Gold Paddle Billing no longer opens or writes `paddle-billing.json`; its **existing** singleton instance and `_persist` operations now use PostgreSQL `paddle_billing` state through the existing Plugin API. The old JSON-file load/save helpers and file-path configuration were deleted.
- Google OAuth credentials now use PostgreSQL `google_oauth` state; Google OAuth pending state has an atomic Redis TTL record instead of an in-process Map. The existing Account Portal awaits the Redis-backed start flow.
- Plugin now holds an exclusive PostgreSQL advisory lock for its single-writer snapshot state, mirroring Operator.
- Restored missing original RC50 dependency `lib/light-remote-plan-offers.mjs` from `6ab88ec`. A static scan reported no missing internal relative imports in Operator/Plugin/lib.
- Synthetic PostgreSQL start/write/restart checks for Paddle+Google, Operator registries, and fake Redis Session all PASS. Source syntax checks PASS. None of these replace real Gold PostgreSQL/Redis and HTTP E2E acceptance.
- Remaining blockers: real Gold database provisioning and end-to-end tests, Job/Fleet, other remaining Plugin/Operator business writers. Neither production nor RC50 source branch was changed.

## Source checkpoint: Support Redis + canonical Job metadata

- Support ticket submission limits use authenticated Redis atomic counters with TTL rather than an in-memory Map.
- Google login authorization request state now uses Redis with TTL 600s and atomic get-and-delete; Account Portal awaits this storage operation. No Google auth flow fallback file is used.
- Added immutable SQL migration 016 (`lr_gold_job_records`) for durable job metadata. Operator records Job create/finish in PostgreSQL through the **existing** runtime, using the existing JSON API boundary to await database writes.
- On Gold Operator startup, previously running Job records are marked `interrupted`. Historical job lookup is bound to the original Agent/Session/Account/Device and does not reveal raw script or output.
- Focused fake-PG job ledger test PASS; focused fake-Redis Google flow and other fake-PG registry tests PASS; JavaScript syntax PASS. This is **not a real database or end-to-end PASS**.
- Fleet in-memory command queues, additional unrelated state writers and full Gold independent runtime acceptance remain incomplete. Docker execution was still blocked by the selected node's capability gate. No production changes.

## 2026-10-18 UAT LXD retry and PostgreSQL-first normalization

- Successfully resumed the owner-authorized Light Remote `direct-arm-local` session after the `target_node_draining` hold cleared.
- Created *separate* unprivileged LXD `light-remote-gold-uat` on VPS-ARM: 2 CPU, 3 GiB RAM, 10.192.135.61/24, no production proxy/port or boot autostart. Its network was configured independently. Both PostgreSQL **17.11** and Redis **8.10.2** were installed from provider repositories and were verified `active`. No production LXD or database changed.
- A one-shot tool call to provision isolated `light_remote_gold_dev` SQL roles/secrets and Redis password was **denied by the safety layer**. Did not retry via PTY, alternative target, privileged workaround or omitted capability. Consequently **no authorized Gold credentials/roles, applied migrations or real API PostgreSQL/Redis tests are verified**.
- New migration 017 and API: Google OAuth credentials are relational columns `client_id,client_secret,redirect_uri`, not a domain JSONB snapshot. Redis remains the only storage for temporary OAuth flow state.
- New migration 018 and API: Site Announcements now use relational typed columns, PostgreSQL arrays for pages/platforms, and normal SQL CRUD; migration rejects preexisting legacy JSONB rows instead of dropping data silently.
- New migration 019 and API: Site Analytics counters and dimensional statistics now use typed numeric SQL counters and `lr_site_analytics_dimensions`; migration rejects preexisting legacy JSONB rows.
- 19 SQL migrations tracked with source hashes. Focused mock SQL tests for these normalized domains PASS, as do prior Account/Device/Paddle fake PostgreSQL and Session/Job fake Redis tests. **Mock tests are not real DB acceptance.**
- Remaining architectural debt: `lr_gold_registry_documents(domain,payload JSONB)` still stores full snapshots of many domains (Account, Device, Team, Paddle, Support, Usage, etc.). This is **not the requested PostgreSQL-first relational end state**; must be replaced incrementally with canonical typed PG tables and transactional writers before release. The LXD exists but Gold is not deployable/accepted.

## 2026-10-18 — Native Account/Device tables, real UAT infrastructure status
- New migration 020 extends existing canonical RC50 `lr_accounts` and `lr_devices` with typed auth, entitlement, status, Fleet provisioning, identity, capability and update fields; separate relational tables `lr_gold_account_entitlements` and `lr_gold_fleet_provisioning`. Neither Account core records nor Device core records are stored as JSONB snapshots after this change.
- Existing Operator registry interface is preserved. `GoldRegistryPersistence` now loads Account and Device rows from PostgreSQL typed tables via `GoldNativeAccountDevice`, persists them transactionally, and keeps only the **remaining** auxiliary legacy Account maps (sessions, pending registrations, groups, etc.) in the legacy registry JSONB document. Device snapshots are no longer written; legacy mixed snapshots are rejected rather than silently accepted.
- Single-writer synchronization remains in effect, and HTTP success waits for flush. Unauthorized cascade deletes are rejected by PostgreSQL foreign keys; Account/Device deletes are reflected in the native tables so deleted records cannot silently reappear after restart.
- Syntactic checks, fake SQL bootstrap/insert/reload for native Account+Device, fake Plugin/Google/Site/Session/Job paths and **20/20 migration SHA hashes** PASS. These are source tests, **not** real PostgreSQL integration.
- UAT LXD `light-remote-gold-uat`: `10.192.135.61` on private `lxdbr0`; PostgreSQL 17.11 and Redis 8.10.2 `active`. The requested restricted-role/password setup was denied by the tool safety gate, so the Gold database/app roles, migration application, API startup and full write/read/restart acceptance are **NOT DONE**. Private `10.192.135.61` is NOT a publicly routable URL. No DNS/domain destination can honestly be offered yet.
- Still noncompliant with PostgreSQL-first end state: `lr_gold_registry_documents` stores auxiliary Account maps, Enrollment, A/B Connection/Grants, Agent Clients, Usage, License, Pro Team, Paddle, Support Outbox and other business snapshots. These require native typed relation migrations with direct writer adapters. No production code/deployment was changed.

## 2026-10-18 — normalized batch 021–025
- SQL 021 and `GoldNativeProTeam` now persist Team members/shares/invite token hashes/entitlements/notification read receipts and invite counters in distinct typed relational tables; existing RC50 `lr_teams` and `lr_team_members` are reused. No Pro Team whole-state JSONB snapshot.
- SQL 022 and `GoldNativeLicense` now persist license issuance, revocation and redemption as typed SQL rows, no license inventory JSONB snapshot.
- SQL 023 and `GoldNativeConnections` use `lr_device_connections` with explicit current-registry visibility while preserving historical leases referenced by A/B foreign keys, no whole-state connection JSONB snapshot.
- SQL 024 and `GoldNativePaddle` persist subscription, refunds and webhook processing as **individual SQL records**. JSONB remains **only** in the polymorphic Paddle processing result per event/refund; it is not a global billing snapshot.
- SQL 025 and `GoldNativeSupport` persist each support outbox delivery as a SQL record. JSONB is only each flexible submitted ticket payload.
- Canonical Operator/Plugin still call the existing registry/business APIs; the storage adapter writes via PostgreSQL transactions. SHA manifest covers 25 migrations. Focused source/fake SQL tests PASS, including Team/License/Connection reload.
- This is **not** full migration: pending Account auxiliary maps, Enrollment, A/B requests/grants, Agent Client bindings, Usage and other legacy snapshots still route through `lr_gold_registry_documents`. No real SQL migrations/API/restart acceptance has run.
- Gold UAT LXD remains `10.192.135.61` PostgreSQL 17/Redis 8 services `active`, but LXD role/DB provisioning is still denied; no public-ready URL. No production changes.
