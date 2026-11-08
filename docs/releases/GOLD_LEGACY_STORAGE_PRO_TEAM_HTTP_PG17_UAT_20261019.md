# Gold legacy JSON/SQLite and Pro Team HTTP/PG17 audit — 2026-10-19

Branch: `feature/light-remote-gold-rebuild-20261018`. Gold UAT LXD: `light-remote-gold-uat` (PostgreSQL 17, Redis 8, isolated). **Production was not modified**.

## Goal and exact boundary

Check for remnants of prior business-state JSON files / SQLite backing stores; require PostgreSQL typed tables as the canonical durable business authority. Examine Pro Team with real owner/member HTTP sessions, PostgreSQL durability, authorization failures, local A/B boundary, billing and cleanup. Keep necessary **device-local config** and **operational logs** distinct from business registries.

## Legacy audit — result

The new repeatable `deploy/scripts/audit-gold-legacy-persistence.mjs` ran **PASS** inside Gold LXD with its actual unprivileged PG app role:
- All **11 canonical registry domains** are mounted through `GoldRegistryPersistence` to SQL: accounts, devices, enrollments, connections, access grants, agent clients, usage, licenses, Pro Team, Paddle and Support (two are mounted by Gold Plugin; actual UAT source for the other nine is Operator).
- All production registry classes still contain legacy file serializers for **production compatibility**, but Gold passes `stateFile:null` for canonical domain instances and now **rejects** any non-null legacy file path at `GoldRegistryPersistence.mount` with `gold_legacy_statefile_forbidden:<domain>`; Gold cannot silently fall back to those writers.
- No runtime DB files with suffix `.sqlite`, `.sqlite3`, `.db`, nor business registry JSON snapshots under Gold `/var/lib/light-remote-gold-uat` or active app root (ignoring installed vendor dependencies).
- Only `wall/auth.json` (local account-only Wall auth settings) and `wall/device.json` (device-local identity/enrollment/policy) remain in runtime's **config state**. These are not Account/Team canonical server snapshots.
- PostgreSQL has 31 schema migrations; generic `lr_gold_registry_documents` JSONB snapshot table does **not** exist. Native Team tables are relational.
- **Important exception**: `/var/log/light-remote-gold-uat/operations.jsonl` remains ACTIVE for append-only operational activity diagnostics and ring-history restoration. This is JSONL logging, **not** a SQLite or canonical Account/Device/Pro Team state registry. A strict future requirement to eliminate *all* file-based activity recovery (not just JSON business snapshots) must migrate this to an appropriate Redis recent-activity stream and/or PostgreSQL audit table. Do not claim "zero JSON files everywhere".
- Shared code `operator-host/free-benefit-registry.mjs` still contains a legacy JSON writer but is **not instantiated** in Gold `executor.mjs`; global removal would risk the separate production stack.
- `lib/native-fs.mjs` file writes are explicitly authorized remote filesystem operations, not server registry persistence. The local Wall agent also keeps its own device configuration.

## Pro Team native business/API test evidence

Script `deploy/scripts/uat-gold-team-http.mjs` used synthetic `example.invalid` accounts, registered and email-verified by the actual private Gold Operator registration API; 5 member fixtures, **no real email delivered**. All account/API mutations went through the actual Gold HTTPS Plugin/Operator; invitation generation used the real private Operator Team endpoint without invoking SMTP.

Observed:
1. **Pro alone cannot create Team** (403). Private Gold administrator issues separate Team entitlement. Then owner creates Team with 1/5 seats.
2. Verified email invitation created with encrypted code; correct member sees Inbox notification, wrong account cannot accept, mark-read/accept works.
3. Seat reservations account for pending invitations. Sixth invite rejected (429) and cross-member code replay rejected. 5/5 seats, including owner; member list and membership views correct.
4. Share owner's existing synthetic UAT device; member sees shared device and `crossAccountExecutionEnabled:false`. Browser session cannot impersonate a ChatGPT OAuth actor (`team-access-request` => 409).
5. Owner self-removal rejected (403). Member removal releases seat, new invited member can replace; unshare removes devices from membership.
6. **Restart Gold Operator/Plugin**, then real HTTPS read still shows 5/5 seats with no shared devices (`GOLD_TEAM_REAL_HTTP_AFTER_RESTART=PASS`).
7. Removing all synthetic members and revoking the separately issued Team add-on succeeds; follow-up Team create denied. An isolated single-writer cleanup with Gold services temporarily stopped removed remaining synthetic Team and all 5 member accounts. After restart all **7 related Pro Team tables contain 0 rows**, no member fixture remains, and original Gold demo account retains its Pro plan.
8. Owner-billed member usage SQL acceptance from `platform-v2/sql/test_team_owner_billed_rollback.sql` actually ran on PostgreSQL and reported `RC50_TEAM_OWNER_BILLING_AB_ROLLBACK_PASS`. It checked owner billing/actor trace, duplicate event idempotency, monthly budget, closed/expired member grant, revoked member, closed agent session, revoked Team add-on, and `ROLLBACK` with no SQL fixture retained.

## Bugs fixed during this audit

- Gold-only UAT missed `OPERATOR_TEAM_INVITE_SECRET_FILE`; the first real Inbox invite failed `team_inbox_key_not_configured`. Generated a separate **32-byte random key** inside Gold LXD with owner `gold-uat`, mode **0600**. Private file `/opt/light-remote-gold-uat/secrets/team-invite.key`; a systemd drop-in points to it. Only the **drop-in template** `deploy/gold-demo/30-gold-team-invite-key.conf` is committed; never commit/share the key itself. Operator restarted and Inbox flow passed.
- `accessGrants.revokeTeamMember is not a function` from real HTTP member removal. Implemented account+device **scoped grant/request revocation** rather than closing the owner's A/B or another member's grant.
- Pro Team removed member/device from its in-memory state *before* attempting A/B revoke. Reordered revoke before membership/share mutation; failures no longer return a 400 after the business change was already enqueued.
- Team member approval request previously discarded `purpose:'team-member'`, and `GoldNativeAB` hardcoded `'device'`. Added explicit purpose validation, recording, readback and typed PostgreSQL upsert. The existing `lr_agent_bindings` check **continues to refuse Team grants as direct device bindings**; cross-account execution remains disabled pending separate explicit authority.
- Revoking Team add-on now revokes the relevant Team member A/B grants for any still-shared devices (without touching owner/direct grants).
- Gold-only `GoldRegistryPersistence.mount` now throws when given any legacy non-null `stateFile`, enforcing SQL-only business state instead of silently accepting file-backed fallback.

## Restart safety: Gold NetBird Wall

- The Wall unit was found `inactive (dead)` after tests restarted its `Requires=` Gold Operator/Plugin dependencies. Its process had exited normally, not crashed, but the old service did not automatically come back.
- Fixed only the Gold Wall unit `deploy/gold-demo/light-remote-gold-wall.service`: `PartOf=light-remote-gold-operator.service light-remote-gold-plugin.service` and `WantedBy=light-remote-gold-operator.service`. Re-enabled the unit in Gold LXD.
- **Acceptance**: initially Wall `active`, NetBird `http://100.94.184.141:5591/` -> HTTP 303 login; deliberately restarted both Gold Operator and Plugin; **all 3 services again active, Wall NetBird still HTTP 303**, and production remains HTTP 200.
- A single `device_channel_failed http_502` event occurred after the Gold restart; Gold MCP `light_remote_connection_helper({})` subsequently returned **ready** and prior linked device **online** (held ChatGPT agent session). We **do not claim** full Wall's own device-channel job execution or an uninterrupted channel through restart until explicit on-device enrollment and test.

## Regression audit

- Ran **16 passing Gold source regression commands** after updating legacy mock `selftest-gold-agent-usage-native.mjs` (the mock had stale binding JSONB position from the earlier `account_id` SQL fix).
- The real Gold LXD audit passed again after the legacy-state fail-closed guard was deployed and Gold Operator/Plugin restarted.
- Gold Wall key mode `0600` and private file location checked. The key bytes never enter Git.

## Verification and limitations

- `selftest-gold-team-scoped-revoke.mjs`: passes actor-scoped revoke, denial of pending approval, preservation of owner/other-member grant, purpose validation and add-on-wide revocation.
- `selftest-gold-ab-native.mjs`: passes encrypted B code reload, including team-member purpose through native adapter fake SQL; pure tests are **not** real cross-account dispatch.
- Real PostgreSQL Team owner billing transaction and real Gold HTTP Team CRUD/restart tests: PASS.
- Cross-account device command execution is **intentionally disabled** in this Gold MVP, so a real Team member Fleet job was not run and is not marked PASS.
- Real SMTP email delivery was deliberately not invoked. Full delivered-email end-to-end remains untested.
- The reusable HTTP UAT script takes `GOLD_TEAM_HTTP_OWNER_PASSWORD` and `GOLD_TEAM_HTTP_MEMBER_PASSWORD` only at invocation time; no login credential is stored in Git. After the documented UAT cleanup, re-running a fresh test needs a newly generated synthetic fixture and runtime-supplied test password.
- The old appendix files under `deploy/gold-uat/` and other preexisting untracked UAT scripts were preserved untouched.

## Completion state

**Pass:** no legacy JSON/SQLite canonical business persistence in active Gold, a runtime fail-closed legacy writer guard, real Pro Team owner+member API workflow, seat/budget/revoke/restart/cleanup, Gold services healthy. **Not claimed:** removal of all JSON configuration and logging bytes, live multi-member remote job dispatch, real invite email delivery.
