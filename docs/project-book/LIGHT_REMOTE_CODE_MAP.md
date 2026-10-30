# Light Remote Code Map — Gold P2 Baseline

Status: verified-source-map (as of Gold SHA 47556b829425784e4c1240c88f08e7272970595f)
Date: 2026-10-30
Scope: production-facing source ownership, admission/grants, native effects and release evidence
Supersedes: none
Primary sources: [Project Book](LIGHT_REMOTE_PROJECT_BOOK.md), [Git P2 plan](../gold/GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md)

This is a **map of source code**, not a proof the same source is currently running in Gold UAT or rc47. Always check process runtime SHA, module provenance and deployed migration first.

## 1. Entry and trust topology

```text
MCP Client (ChatGPT/Claude/etc)
     │ authenticated account OAuth + tool scopes
     ▼
plugin-server/tools.mjs — helper and tools
plugin-server/operator-adapter.mjs — authorized Operator requests
     │  account auth alone is NOT device control
     ▼
operator-host/executor.mjs — Operator authority, service composition
     ├─ executor-routes-account.mjs — account/team/invites and owner portal APIs
     ├─ executor-routes-plugin.mjs — plugin-facing routes
     ├─ executor-routes-device-channel.mjs — device enrollment, A/B, heartbeat,
     │   signed channel, working session creation and terminal receipt path
     └─ executor-routes-runtime.mjs — runtime routes
         │ verified device channel + grant + policy + session/worker locks
         ▼
device-agent/operator-agent.mjs — enrolled Agent
device-agent/local-wall.mjs — local consent /approve, Wall UI
device-agent/fleet-wall-runtime.mjs — Fleet UI, status and jobs
device-agent/execution-epoch-journal.mjs — durable local execution evidence
     │
     ▼
OS process / Files / PTY / RM V2, subject to effective device policies
```

An MCP login provides account identity only. Device operations require device enrollment identity and a separate authenticated A/B grant, device policy, active session and execution authority. Never route based solely on visible Short ID or nickname.

## 2. A/B V1 source owners vs V2 NOT YET IMPLEMENTED
- [Legacy pair registry](../../operator-host/device-pairing-registry.mjs) — 4+4 rotating A, currentByDevice, redeem.
- [Grant registry](../../operator-host/device-access-grant-registry.mjs) — B approval, 24h absolute grant bound to account/Agent/device/connection.
- [EnrollmentRegistry](../../operator-host/enrollment-registry.mjs) — device key binding and signed channel replay protections, not the new target resolver.
- [Helper tool](../../plugin-server/tools.mjs) — currently receives legacy aCode; does not have shipped V2 targetQuery.
- [Operator adapter](../../plugin-server/operator-adapter.mjs) — legacy pairBegin/recover; current onboarding still instructs copying A from Wall.
- [Device channel routes](../../operator-host/executor-routes-device-channel.mjs) — device pairing begin, pending grants, owner approval and working-context source routes.
- [Local Wall](../../device-agent/local-wall.mjs) — legacy A and B entry; /account V2 B approval not currently accepted.
- [V2 Product Contract](../gold/GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md) — design only: stable Short ID6 visible on idle Wall; A suffix5 on Agent request, independent B, account-scoped discovery, exact pending correlation and old-client compatibility.

### P2-I2c server-internal owner pending adapter (source-only, after 28766f4)

- [Owner pending adapter](../../lib/gold-ab-v2-owner-pending-adapter.mjs) — **NOT imported by Operator or exposed as an HTTP route**. Its only entry accepts the actual server request and calls an injected, server-session-derived `authenticateOwner(request)`; it never consumes body-supplied account/Agent/client identity. Every call rechecks canonical device ownership, current connection ID and expiry, enrolled signed connection verifier, action policy and an OFF-by-default feature switch. Refresh/Deny additionally require server-checked Origin+CSRF via `verifyOwnerMutation`.
- The adapter contains read-only `list/view`, owner-selected `refresh` and `deny`; output is strictly allowlisted (no B plaintext, ciphertext, HMAC, Redis index). It **intentionally has no approve method or grant issuance**. Its hooks are required and fail closed; future HTTP integration must supply Operator-authenticated implementations, not request JSON.
- [Negative source test](../../deploy/scripts/selftest-gold-ab-v2-owner-pending-adapter.mjs) — mocked account sessions, denied cross-owner and revoked device, stale connection, policy/enrollment/flag OFF, CSRF/Origin failure, spoofed request body ignored, no B spill, and no grant path. Gold GC workflow runs this test. Source fixture only; no real OAuth request, deployed Wall or native device acceptance.
- Existing legacy `/v1/device-access/*` in [device channel routes](../../operator-host/executor-routes-device-channel.mjs) and `pairBegin/recover` in [plugin adapter](../../plugin-server/operator-adapter.mjs) remain V1 and are **not authorized integration paths for V2**. Need exact server-authenticated Agent request identity and real 24h grant preparation/commit next, with a distinct idempotent request binding before introducing any V2 route.

### P2-I2d owner-only Operator HTTP route, SOURCE ONLY

- [Gold A/B V2 owner HTTP](../../operator-host/gold-ab-v2-owner-http.mjs) mounts in [Operator](../../operator-host/executor.mjs) before old routes, but **defaults to 404** unless `LR_GOLD_AB_V2_OWNER_PENDING_HTTP=1`. To enable in an explicitly authorized isolated runtime it requires a 32-byte dedicated key under `LIGHT_REMOTE_GOLD_ROOT` (0600), exact HTTPS owner origin, and nonempty owner-account and device allowlists. Never set these in production/Gold UAT as part of source-only work.
- Routes `GET /v1/accounts/ab-v2/devices/:deviceId/csrf`, `GET .../pending`, `GET .../pending/:requestId`, `POST .../pending/:requestId/refresh|deny`; **no approve route**. The route uses real Operator `requireAccount(req)` (session header authenticated by AccountRegistry), canonical DeviceRegistry, EnrollmentRegistry nonrevoked public-key/policy binding, DeviceConnectionRegistry and `accounts.assertOperational`. Redis requests are scoped to the current connection and owner; unapproved or revoked devices fail closed. Per-account+device Redis-backed HTTP request limits are applied only AFTER trusted owner/device preflight and BEFORE Redis pending operations.
- Mutations require session-bound HMAC CSRF and same-origin validation when browser Origin is present. The account portal proxy and Local Wall do not yet expose these routes; they must enforce browser same-origin/CSRF when wired. No helper/A/B grant or public remote access granted by any read/list/refresh.
- [HTTP fixture](../../deploy/scripts/selftest-gold-ab-v2-owner-http.mjs) tests actual local HTTP, 401/403/404/409/429, CSRF/cross-origin, cross-account no Redis writes, revoked/binding mismatch, connection rotation, allowlist/feature-off, read-only response filtering and **no approve**. Includes a constructed Operator factory fixture with mock Redis/enrollment; not installed-Agent/real OAuth UAT.

### P2-I2e account portal preview, SOURCE ONLY

- [Owner cookie proxy](../../plugin-server/account-ab-v2.mjs) and [account portal API](../../plugin-server/account-portal.mjs): `/account/api?action=abv2-csrf|abv2-pending|abv2-view|abv2-refresh|abv2-deny` uses `__Host-light_remote_account` server-side session token only. The browser never receives this token. Explicit `LR_GOLD_AB_V2_ACCOUNT_UI=1` is necessary **in addition to** Operator's default-OFF `LR_GOLD_AB_V2_OWNER_PENDING_HTTP`, secure key/HTTPS-origin and per-owner-device allowlists. POST requires exact browser Origin and `x-light-abv2-csrf`; only `deviceId`, exact pending `requestId` and Refresh `expectedAttempt` are forwarded (no supplied account/Agent/connection identifiers or B). No approve route or actual grant.
- [Account dashboard](../../plugin-server/account-portal/index.html) and [V2 browser module](../../plugin-server/account-portal/ab-v2.js): owner-selectable pending list, per-request Refresh/Deny; **hidden by default** until the real Operator feature responds successfully. DOM uses `textContent` for dynamic values, no B code and no Approve. Legacy V1 dashboard remains unchanged when OFF.
- [Source fixture](../../deploy/scripts/selftest-gold-ab-v2-account-portal.mjs): validates cookie-only forwarding, wrong method/ID/body, Origin/CSRF denial, default OFF, no cross-account parameters, hidden UI and absent B/Approve. These are source-only unit/static checks, not browser-authenticated E2E.
- **Local Wall STANDBY/approval is NOT wired**: it must use the device's Ed25519 signed channel and locally authenticated owner session, not forward the cloud account cookie to a device. Short ID display requires first preparing and validating PG043. Real B approval→durable 24h grant idempotency remains P2-I2 critical blocker.

### P2-I2f Local Wall signed preview — source only, no grant

- [Operator signed preview](../../operator-host/gold-ab-v2-signed-preview.mjs) built in [Operator](../../operator-host/executor.mjs) and invoked by [device channel routes](../../operator-host/executor-routes-device-channel.mjs) with `verifiedChannelContext(envelope,'abv2-pending-preview')`: Ed25519 enrolled-device signature, nonce replay rejection and Redis trusted-channel rate check. The signed principal supplies owner and exact device; canonical enrollment public key, device, owner verified email and current connection/policy are all revalidated. Its output uses `safeGoldAbV2Pending` allowlist and returns no B/hashes. **Read-only**. Requires `LR_GOLD_AB_V2_WALL_PENDING_PREVIEW=1`, plus the owner Operator HTTP/key/HTTPS origin/account/device allowlists already default-OFF.
- [Device public channel allowlist](../../plugin-server/device-public.mjs) now recognizes signed action; ordinary public unauthenticated HTTP cannot select the device owner due to Operator signature verification.
- [Device Agent](../../device-agent/operator-agent.mjs) signs this action and compares server-owned account email to the account email authenticated at Local Wall, without forwarding any account OAuth cookie. Both daemon and wall-only companion register callback.
- [Local Wall](../../device-agent/local-wall.mjs) requires local account session email to query `GET /api/abv2/pending`; nonaccount recovery users denied. [Preview fragment](../../device-agent/wall-ab-v2-preview.mjs) injects a hidden read-only list into legacy `/approve`, shows only when HTTP 200, renders with textContent, and retains V1 B approval untouched.
- [Signed backend fixture](../../deploy/scripts/selftest-gold-ab-v2-signed-preview.mjs) and [Wall signed-route/HTTP fixture](../../deploy/scripts/selftest-gold-ab-v2-wall-preview.mjs) PASS on source. Real installed-Agent / browser E2E and Gold UAT remain unverified. **No Refresh/Deny via Local Wall yet**, only status refresh; existing `/account` owner actions source-only. No grant or V2 owner B approval.

### P2-I2g — OAuth-signed Helper targetQuery preflight (SOURCE ONLY)

- [Helper HMAC proof](../../lib/gold-ab-v2-helper-proof.mjs): 32-byte 0600 dedicated `LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE` under `LIGHT_REMOTE_GOLD_ROOT`, domain-separated HMAC SHA256, binds **authenticated OAuth accountId+opaque clientId+derived agentId+exact targetQuery+iat+random nonce**. Operator verifies timing-safe signature, ±30s freshness and Redis NX 90s replay guard before **any owner SQL**. Never trust request JSON account/client/agent claims without this signature.
- [Operator target handler](../../operator-host/gold-ab-v2-helper-target.mjs) in [Operator](../../operator-host/executor.mjs): gated by explicit `LR_GOLD_AB_V2_HELPER_TARGET_QUERY=1` AND owner HTTP/key/origin/account/device allowlists, default OFF. `POST /v1/plugin/abv2/target-resolve` read-only; checks operational+verified owner, verifies actual **PG043 table exists** (otherwise 503), selects bounded owner-owned Short ID rows, rechecks enrollment public key/revocation/policy/device and allowlisted device IDs, resolves 0/1/N with [Short ID resolver](../../lib/gold-device-short-id.mjs); no silent Main fallback. The result is sanitized metadata + `approvalState:not_issued`, `helperReady:false` even on single match; NO A/B request, poll token, grant or session attach.
- [OAuth Agent adapter](../../plugin-server/operator-adapter.mjs) signs the lookup only from its `guarded` authenticated OAuth identity. [MCP Helper tool](../../plugin-server/tools.mjs) adds optional `targetQuery`, conflicts with legacy `aCode`, `continuation`, `helperGroup` and leaves all existing schemas and V1 flow intact. With flag OFF it returns an explicit V1 fallback instead of scanning targets. **This is target discovery only, not Agent-first pairing complete**.
- [Proof/PG fixture](../../deploy/scripts/selftest-gold-ab-v2-helper-target.mjs) executes HMAC, changed principal/query, replay, expiry, unauthorized device, duplicate-name ambiguity, Short ID exact-match, revocation, missing PG043 fail-closed. [Tool source gate](../../deploy/scripts/selftest-gold-ab-v2-helper-tool.mjs) statically checks schema and OFF-path without installing optional `zod` into the VPS-ARM source worktree. Gold GC workflow runs both. No live UAT/native OAuth browser E2E.

### P2 hotfix — separate 24h A/B countdown per Agent on Local Wall (source candidate)

- [V1 durable grants](../../operator-host/device-access-grant-registry.mjs): each Agent's signed owner-approved A/B grant has an independent `approvedAt`, `absoluteExpiresAt` (max 24h) and connection-limited `expiresAt`. `activeGrantsForDevice(deviceId,connectionId)` returns ALL active Agent grants, not just the oldest/first. `activeForDevice` remains a most-recent personal grant compatibility view for old clients. A repeated B owner approval for the SAME Agent atomically replaces only that Agent's previous grant in the same state snapshot; approvals never renew/close another Agent's grant or reset another timer.
- [Signed device status](../../operator-host/executor-routes-device-channel.mjs): `/v1/device-channel/status` returns `access.activeGrants[]`, minimal display fields (Agent identity, label, purpose, timestamps only; no grantId/connectionId/account secrets), plus backward-compatible `activeGrant`.
- [Local Wall](../../device-agent/local-wall.mjs): the former single `Agent A/B access` timer is replaced by one countdown **per Agent**, each based on its own `min(absoluteExpiresAt,expiresAt)` and updated once per second. Real `device_access_approved` events force a status read; owner `/api/approve` and legacy scoped `/api/access/:id/approve` invalidate the normal observer cache immediately after success. Rendering via textContent only. Old single-grant server data still falls back gracefully.
- [Independent clock and loopback fixture](../../deploy/scripts/selftest-gold-ab-reauthorization-clock.mjs): Agent A 90s left + new Agent B at 24h, individual expiry, same-Agent reapproval, Team Agent independence, restart reload, account+connection scope, signed status safe metadata, local Wall actual B approval cache invalidation, HTML timer DOM and SSE refresh PASS. [Updated V1 fixture](../../deploy/scripts/selftest-v09-device-access-grant.mjs) now asserts per-Agent owner approvals, instead of obsolete one-approval-for-all assertion. Gold source gate includes both tests. **Source-only: Windows rc49/production and Gold UAT untouched; deployed client screenshot not yet fixed until controlled release.**

### P2-I2h1 — Agent-first V2 request issuance behind three OFF gates (SOURCE ONLY)

- [Signed helper proof](../../lib/gold-ab-v2-helper-proof.mjs) now distinguishes HMAC purposes `resolve` and `issue`, and binds issue proof to exact `selectedDeviceId` and 32-hex `requestKey`, alongside verified OAuth account/client/derived Agent, exact Short ID query, timestamp and nonce; independent Redis NX replay guard. Neither purpose substitutes for the other.
- [Operator helper](../../operator-host/gold-ab-v2-helper-target.mjs): distinct private `POST /v1/plugin/abv2/request-issue`, **default OFF** flag `LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE=1` requiring both `LR_GOLD_AB_V2_HELPER_TARGET_QUERY=1` and `LR_GOLD_AB_V2_OWNER_PENDING_HTTP=1` plus secure keys, HTTPS origin, allowlisted owner/device, PG043 existing. Revalidates verified owner, enrollment public key/policy, online device, exact stable Short ID, signed selected device and active connection **before Redis issuance**. Never guesses Main or issues to arbitrary name/other account.
- [Pending Redis](../../lib/gold-ab-v2-pending-redis.mjs): optional idempotent `requestKey` derives opaque requestId via secret HMAC over owner/actor/Agent/client/device/connection/requestKey. Redis EVAL checks existing scoped row **atomically** before new issue rate counters; retry returns same requestId and current sealed B (including after Refresh), rather than issuing a second B. The stored client identity is an opaque `oauth-SHA256(clientId)`, not the raw OAuth client ID. A=immutable Short ID plus 5-character rotating suffix; B=4+4 only returned to authenticated Agent. Owner pending view never receives B.
- [MCP Helper](../../plugin-server/tools.mjs) and [OAuth adapter](../../plugin-server/operator-adapter.mjs): `targetQuery` + `startAbV2:true` optionally `requestKey` resolves 0/1/N, only issues if exactly one online match; without this explicit input, discovery and legacy V1 pairing are unchanged. Returns `requestId`, B and `requestKey` for Agent-only retry, **`status:v2_pending_unapproved`, `helperReady:false`**, with `nextAction:owner_v2_b_approval_not_enabled`. **NO V2 owner B approval endpoint yet, no durable 24h grant, no Helper ready/attach.** Never direct owner to V1 `/approve` as if it accepts V2.
- [Issue fixture](../../deploy/scripts/selftest-gold-ab-v2-helper-issue.mjs): actual HMAC proof + mocked Redis atomic issue/agent scope, retry, changed OAuth client, tampered Short ID/device, replay, expired proof, PG043 absence, offline/revoked/changed connection and no-ready all PASS. [Isolated Redis8 fixture](../../deploy/scripts/selftest-gold-ab-v2-pending-redis.mjs) gains true Lua idempotency + post-Refresh retry assertions but **must only be run in no-NIC clone with explicit test opt-in**. No live Gold/Windows acceptance.

### P2-I2h2a — deterministic per-Agent V2 grant candidate (NOT OWNER-WIRED)

- [DeviceAccessGrantRegistry](../../operator-host/device-access-grant-registry.mjs) adds `approveVerifiedV2` as a **strictly internal** receiver of an already authenticated, Redis-verified owner B receipt. The function **does not verify B**, and is deliberately NOT routed to owner HTTP/Local Wall/Helper. The `dag_v2_<request hex>` ID is deterministic for one exact 32-hex V2 requestId and persists through the existing Gold PostgreSQL native AB grant registry; no schema 044 is required for the ID itself.
- Receipt must provide owner, device, connection, Agent and Redis-server verifiedAt. The function validates all identifiers, hard connection expiration and verifiedAt, preserves the original **verifiedAt + 24 hours absolute expiry**, and returns the SAME grant (not 24 hours more) on retry/restart. A new V2 approval replaces only prior grants of the same owner/device/Agent; grants of other Agents remain independent. Once revoked/closed, the same deterministic request can never resurrect a grant. Synchronous persistence failures roll back in-memory changes; async Gold persistence still requires an explicit **`await goldRegistries.flush()` before returning success**.
- [Source fixture](../../deploy/scripts/selftest-gold-ab-v2-verified-grant.mjs) verifies deterministic grant IDs, restart, no lifetime extension, independent Agent timers, scope mismatch and closed-grant no-resurrection. Gold CI source job includes it; **real PostgreSQL flush and Redis B receipt/recovery remain unverified**.
- The intended Redis B approval→receipt→PG flush bridge could not be completed in this session, and the attempted partial Redis changes were restored. **No V2 B endpoint, grant issuance via HTTP, or Helper ready is active**. Old V1 path and existing per-Agent clock behavior remain intact.

### P2-I2h2b — internal Redis verified-B to PostgreSQL grant coordinator (SOURCE ONLY)

- [Pending Redis](../../lib/gold-ab-v2-pending-redis.mjs) gains **owner-scoped, atomic** `grant_receipt` and `grant_commit` Redis Lua operations. B is verified by the existing atomic `approve` action, yielding server `approvedAt` and request attempt. `grant_receipt` returns only the exact approved requestId, attempt, owner/actor, Agent/client, device/connection and server timestamp, **never B, box or hash**. `grant_commit` checks deterministic grantId, exact attempt and approvedAt before atomically changing `approved → granted`; repeated commit is idempotent. `approved` remains Redis-only and is NOT a durable grant. Owner views now recognize `granted`.
- [Internal coordinator](../../operator-host/gold-ab-v2-grant-coordinator.mjs): revalidates authenticated owner/device/connection before B, after B and after PG readback; converts Redis server-time receipt to deterministic per-Agent grant using `approveVerifiedV2`; then **awaits GoldRegistryPersistence.flush() and verifies a matching PostgreSQL grant row** before marking Redis `granted` and returning success. If stopped between Redis verification and PG or between PG and Redis commit, same requestId/approvedAt retries with no extra 24h. No route/Helper-ready is wired.
- [Operator owner adapter](../../operator-host/gold-ab-v2-grant-operator.mjs): separately OFF `LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE=1`, requires owner HTTP + Helper issue flags, exact owner/device allowlists, 0600 seal key, HTTPS Origin, session-bound CSRF, verified operational account, enrolled public identity key, policy and current connected device; reads back `lr_ab_grants` with exact owner/device/connection/agent/approvedAt/absoluteExpiresAt/closedAt before Redis commit. **Source factory only, not instantiated in live Operator or exposed in /account or Wall.**
- [Coordinator fixture](../../deploy/scripts/selftest-gold-ab-v2-grant-coordinator.mjs) and [Operator adapter fixture](../../deploy/scripts/selftest-gold-ab-v2-grant-operator.mjs) PASS owner/CSRF, wrong B, stale attempt, owner change, revoke, no PG confirmation, restart/retry, failed final Redis commit, per-Agent timers. [Redis8 no-NIC fixture](../../deploy/scripts/selftest-gold-ab-v2-pending-redis.mjs) adds receipt/commit assertions but remains **NOT RUN** pending isolated clone. Native Postgres + installed Agent E2E remain pending.

## 3. Durable session and nickname
- [Session Registry](../../operator-host/session-manager.mjs) — open, hold, resume, display `label`; immutable sessionId.
- [Redis session persistence](../../lib/gold-session-redis.mjs) — registry snapshots/mutator whitelist; new rename setter must participate in durable writes.
- [Operator device channel working-context route](../../operator-host/executor-routes-device-channel.mjs) and [plugin adapter](../../plugin-server/operator-adapter.mjs) — currently hardcode `ChatGPT Light Remote` in session open path. A helper label alone does not yet create a durable Agent-selected name.
- [Naming specification](../gold/GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md) — first Agent-picked name, non-blocking, owner override; not shipped.

## 4. Team → Pro Share
- [Pro Team registry](../../operator-host/pro-team-registry.mjs) — five-seat internal source and invitations/device sharing; preserve.
- [Team authorization](../../operator-host/team-member-auth.mjs) and [Team Dispatch Authority](../../operator-host/team-dispatch-authority.mjs) — guest identity and preview scopes; do not equate preview to live remote execution.
- [Native Pro Team PG](../../lib/gold-native-pro-team.mjs) — persistent team representation.
- [Operator](../../operator-host/executor.mjs) has `teamSessions=null` and [account routes](../../operator-host/executor-routes-account.mjs) expose `crossAccountExecutionEnabled:false` as inspected. Pro Share narrower owner+one guest execution has NOT been activated, metered or sold.
- The enterprise IT Support per-branch/per-group model is **future reference only**; do not create an enterprise entitlement/authorization engine in core P2.

## 5. P1/P2 GC, proof and release
- [Signed execution epochs](../../lib/gold-execution-epoch.mjs) — account/device/epoch authority and execution-start records.
- [Reconnect proof](../../lib/gold-reconnect-proof.mjs) — signed inventory, fenced uncertain side effects.
- [Agent durable journal](../../device-agent/execution-epoch-journal.mjs) and [terminal spool](../../lib/native-terminal-receipt-spool.mjs) — local durable evidence; local ACK is NOT a server ACK.
- [Device resource claims](../../lib/gold-device-resource-locks.mjs) — exact signed terminal receipt ACK transaction/fence release, preserving unknown/no-PID.
- [Verified channel fixture helper](../../lib/gold-verified-channel-context.mjs) — test fixture ONLY; not imported by production Operator `executor.mjs` at source audit.
- [SQL migrations](../../platform-v2/sql/migrations.lock.json) — version-locked manifest through 042; Gold UAT live still 039 at last observation.
- [PG epoch/GC harness](../../deploy/scripts/ci-gold-epoch-pg.mjs), [signed HTTP + enrollment fixture](../../deploy/scripts/selftest-gold-signed-http-duplex-pg.mjs), [Gold CI workflow](../../.github/workflows/gold-connection-lifecycle-gc.yml).
- Gold standalone CI 4/4 PASS on source SHA `d6892d7` is a fixture result. Subsequent docs-only commits do not mean another CI run succeeded.

## 6. Update rule
When code entrypoints, authority, persistence, major routes or trusted data flows change, update THIS map with the new exact source SHA and tests. Do not attempt to list every method in the repository; use targeted bookmarks and refer to actual source. When claims are not verified, mark as future or source hypothesis, not current runtime.

## 7. Engineering truth gate (documentation governance; NOT a production execution path)

- [Guard](../../deploy/scripts/check-project-truth-sync.mjs) — parses staged and Git-committed blob IDs, computes deterministic source SHA-256, checks synchronized checkpoint, dated Worklog, and Code Map on runtime/trust-boundary changes. `--stamp` writes and stages a fresh source digest in the **single** `.light-remote/CURRENT_CHECKPOINT.json`.
- [Fixture regression](../../deploy/scripts/selftest-project-truth-sync.mjs) — synthetic disposable Git repo tests missing Worklog, missing checkpoint, stale code digest, authority-map requirement, compliant same-commit source and range.
- [Local pre-commit](../../.githooks/pre-commit) and [Gold GitHub Actions gate](../../.github/workflows/gold-project-truth-sync.yml) — same policy enforced during local authoring and remote CI. The hook must be enabled per Gold worktree; CI cannot replace GitHub required-status branch protection.
- Existing [document catalog integrity](../../.github/workflows/gold-doc-library.yml) remains responsible for source catalog SHA-256 and canonical relative bookmarks.
- **Authority limitation:** this is a *source/documentation consistency guard*, not an assertion that a Gold candidate is live, owner-accepted, or safe to release. It never mutates operator runtime, device agents, A/B grants, billing, PostgreSQL, Redis or production.

## 8. P2-I1 device Short ID candidate source (2026-10-30, not deployed)

- [Candidate schema 043](../../platform-v2/sql/043_gold_device_short_ids.sql): separate immutable six-character public Short ID reservation table with unique active device binding, permanent tombstone on device deletion, unchanged existing device UUID and ownership. **This SQL is intentionally NOT listed in migrations.lock.json and never applied to live Gold**: P2-A runner and rollback preimages remain pinned through 042. A reviewed upgrade/rollback release lane and owner approval are required before registering/applying 043.
- [Device Short ID library](../../lib/gold-device-short-id.mjs): crypto-strong Crockford 6-char allocation, concurrent SQL uniqueness/collision retry, bounded backfill, owner-scoped PostgreSQL lookup and pure 0/1/N resolver across **preauthorized** device rows; discovery cannot mint A/B or grant execution.
- [Source fixture](../../deploy/scripts/selftest-gold-p2i1-short-id.mjs): non-granting target matching, duplicate names and private device isolation.
- [No-NIC PG clone fixture](../../deploy/scripts/ci-gold-p2i1-short-id-pg.mjs): isolated PostgreSQL applying candidate 043 to disposable database, concurrent allocation, immutable Short ID and deletion tombstones, device rename and cross-owner visibility. Successful direct clone execution 2026-10-30: exit0, stderr empty, disposable DB deleted and clone STOPPED. This does not test installed Agent / real Operator / Wall or release.
- [Gold source CI](../../.github/workflows/gold-connection-lifecycle-gc.yml): new module and fixture syntax/unit test participate in source gate; PostgreSQL integration fixture has a strict clone/no-NIC guard and does **not** run on networked GitHub runners.

**Next wiring:** review actual PG039→043 migration/rollback and lock update safely, backfill existing Gold devices on an isolated clone, then implement authenticated Operator device-list/resolver surface and Wall STANDBY Short ID, preserving A/B V1. Future enterprise IT Support RBAC is deferred; no org/branch/group implementation.

## 9. P2-I2 Redis A/B V2 pending state candidate — 2026-10-30

Source file: [gold-ab-v2-pending-redis.mjs](../../lib/gold-ab-v2-pending-redis.mjs). Redis8 atomic Lua issue / Agent poll / owner Wall view / Refresh / approve / deny. A = immutable device Short ID 6 + rotating suffix 5. Independent B = 4+4 legacy-readable characters. Pending TTL = 300 seconds measured by Redis server TIME. B is AES-256-GCM encrypted in Redis and HMAC checked; plaintext B is returned only to the bound Agent and never through owner-scoped Wall views. Manual Refresh CAS replaces A suffix and B for exactly one request/attempt, resets the server deadline and Redis storage TTL, while polling never extends it. Issue, refresh and wrong-B attempts are bounded. This is source-only: approval state does NOT create a 24-hour A/B grant.

Source CI: [selftest-gold-ab-v2-source.mjs](../../deploy/scripts/selftest-gold-ab-v2-source.mjs). Real no-NIC clone test: [selftest-gold-ab-v2-pending-redis.mjs](../../deploy/scripts/selftest-gold-ab-v2-pending-redis.mjs). Clone Redis8 Unix-socket fixture PASS including concurrent CAS refresh, cross-Agent/cross-owner rejection, old B rejection, wrong B lockout, clock expiry, retry and persistence across service object recreation. Redis stopped and clone STOPPED after tests. The actual Operator/Helper, Wall and account routes, CSRF, enrolled connection/policy checks, device pending index and grant-registry handoff are NOT implemented in this stage; schema 043 remains candidate and UAT live unchanged. Do not activate public features. Future IT Support RBAC is not part of this release.

## 10. P2-I2 owner/device/connection pending index — 2026-10-30

[Redis V2 pending store](../../lib/gold-ab-v2-pending-redis.mjs) now derives an HMAC-keyed owner/device/connection pending index and writes its request ID within the same atomic Redis issue transaction. The index stores request IDs and deadline scores, never plaintext B. `listDevicePending()` authorizes exact owner/device/connection scope via `wallView` for each request, returns at most five pending requests, and does not perform fleet-wide Redis scans. Explicit manual Refresh updates the index expiry and TTL; approval, denial, lockout and expiry remove the request from the index. [No-NIC Redis fixture](../../deploy/scripts/selftest-gold-ab-v2-pending-redis.mjs) validates two simultaneous Agents, owner/connection isolation, Refresh CAS, no B disclosure, and terminal index cleanup. Source module is NOT connected to OAuth/CSRF/Wall routes or the grant registry; caller authorization and signed device identity checks must be built before exposing any endpoint. This is NOT future enterprise RBAC.
