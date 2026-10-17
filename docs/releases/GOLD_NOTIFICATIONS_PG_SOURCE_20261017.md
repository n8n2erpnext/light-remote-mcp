# Gold Account Notifications — PostgreSQL-only Core socket slice (2026-10-17)

## Scope and boundary

The independent `Gold Core` now mounts an **existing relational notification repository** on its private Unix socket. This is an additional *source-level* API slice, **not** the canonical Operator/Plugin data-plane cutover. Production `light-remote-direct` remains untouched. Migration `003_auth_device_communications.sql` already contains `lr_notifications` and `lr_notification_reads`; migration locks remain at exactly `001..020` and were NOT changed.

The implementation constructs `GoldPgNotificationRepository({pool:verifiedGoldPool})` in `platform-v2/src/http/gold-core-server.mjs`, not a file-backed registry. The repository reuses `AccountNotificationRegistry({stateFile:null})` only for input validation; this object has no file path or persistence authority. **The canonical legacy Operator still retains its own JSON-mode notification writer** unless run in its separate explicitly enabled PG canary mode. No source-cutover credit is claimed yet.

## Contract

| Method | Private Gold Core path | Authority | PostgreSQL data |
|---|---|---|---|
| GET | /v1/accounts/notifications | Current Gold `core.authenticate(Bearer)` | Visibility filtered by account ID / plan / group, schedule and cancellation |
| POST | /v1/accounts/notifications/read | Current Gold account session | Upsert immutable first `read_at` scoped to exact notification and account |
| GET | /v1/admin/notifications | Independent `verifyNotificationAdmin(req)` trusted admin verifier | Lists PostgreSQL notifications and relational read counts |
| POST | /v1/admin/notifications/publish | Same admin verifier; identity from its `adminAccountId`, never body | Insert sanitized/scheduled audience notification |
| POST | /v1/admin/notifications/:id/cancel | Same admin verifier | Cancel with PostgreSQL status update |

The admin ingress callback must be supplied by the **owner-provisioned private verifier bundle** with real local admin authentication. It is intentionally not synthesized from a browser Bearer token, `body.authorized`, raw HTTP header, `root` string, or a fake admin object. If the callback is missing, admin endpoints **return 503 without any database changes**; if it rejects, they return 401. The function is not yet made a universal startup prerequisite for all Gold Core roles, allowing non-admin Account inbox to run independently. Its real verifier implementation is **not** delivered in this slice.

For every `/v1/` call, the Gold socket admission gate still checks live PostgreSQL and Redis before entering the route. The private socket requires a 0700 parent directory and 0600 socket; there is no new public TCP listener. No JSON/SQLite fallback was added.

## Proof in source tests (fake PG, real native HTTP)

- `platform-v2/test/gold-notification-http.test.mjs`: forged recipient/admin body rejected, current account identity only, publish actor originates in trusted verifier, method/failure handling, no verifier fail closed.
- `platform-v2/test/gold-notifications-pg.test.mjs`: Account and plan/group scope expressed in parameterized SQL, `lr_notification_reads` idempotent upsert, new repository instance reads existing backend state, cancellation excludes inbox, PostgreSQL outage propagates.
- `platform-v2/test/gold-notification-socket.test.mjs`: starts actual isolated Gold Core over a private Unix socket with a mock PostgreSQL pool and mock Redis; exercises inbox → read → admin count → cancel; also tests missing bearer, failed admin proof and dependency outage. **No actual PostgreSQL/Redis connection** is made by these mocks.

## Remaining blockers

1. Replace mock database with properly provisioned PostgreSQL 17/Redis 8 under the owner-authorized isolated Gold infrastructure. Prior Docker attempt was denied (`target_node_capability_missing`) and MUST NOT be bypassed.
2. Bind the canonical Operator/Plugin notifications APIs to the **same PostgreSQL transactional authority**, removing any parallel JSON writer and respecting the full Admin/Account verifier contract. The existing canonical PG notification canary flag `LR_GOLD_NOTIFICATIONS_PG` is NOT proof of full cutover.
3. Provide and independently review `verifyNotificationAdmin`; confirm the client Account inbox UI and Administrator management UI against that trusted ingress.
4. Perform **real SQL cold-restart, simultaneous Operator/Core processes and cross-account audience tests**, not only fakes. Retain `BLOCKED_SOURCE_CUTOVER 0/23` until all mandatory domains are migrated and independently accepted.

Never stop production solely to validate this source slice.

## Follow-up: PostgreSQL session audience group + operational recipient (2026-10-17)

Two correctness gaps were discovered and fixed on the accepted schema **without adding migrations**:

1. `GoldPgCoreAuthority.authenticate(rawBearer)` originally projected `accountId`, `email` and `plan` from `lr_accounts`, but omitted `group_id`, even though migration 017 introduced that column with default `grp_default`. As a result, PostgreSQL notifications addressed to `audience_type='group'` could silently disappear from the Gold inbox. Authentication now projects `a.group_id` from the **verified database session** as `groupId`. Neither HTTP body nor query `groupId` overrides it.
2. `GoldPgNotificationRepository.publish` now checks a targeted `audience_type='account'` against the live `lr_accounts` table with `status='active'`. An admin request for an unknown, dormant or disabled recipient returns 404 without inserting any notification. This matches the canonical Operator's `assertOperational(accountId)` at a source-level authorization boundary. Broad group/plan audiences are not confused with single-account validation, and cancellation/read semantics are unchanged.

The new real Core+repository HTTP roundtrip test `gold-notification-group-roundtrip.test.mjs` exercises two genuine Gold Authority objects sharing an injected fake PG pool and verifies that `acct_quality` sees `grp_quality` but `acct_other` cannot opt into that group by manipulating URL query parameters. Additional PG notification tests cover plan/group targeting and rejecting dormant/disabled/missing direct recipients. **The SQL contract is mocked; this remains NOT a live PostgreSQL17/Redis8 E2E acceptance.**
