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
- **Still open:** Paddle billing JSON writer (edit blocked by safety tool); Google OAuth configuration/state; account recovery, remaining site/admin service paths, Session/Job/Fleet Redis+PG durability, device-local business storage and remaining canonical writers.
- **Deployment blocked:** VPS-ARM Docker `target_node_capability_missing` through the declared Light Remote capability. No Docker bypass and no alternate transport used. Gold PostgreSQL/Redis independent stack not deployed; no full API end-to-end tested.
