# Light Remote Gold P2 — Rolling Implementation Handoff

Status: CANONICAL ROLLING HANDOFF, source-only milestone
Date: 2026-10-30
Scope: Gold P2-I1 / P2-I2 A/B V2; next-session continuation, security boundaries and exact recovery position
Supersedes: no historical evidence; use this as the **read-first current P2 execution handoff** alongside `.light-remote/CURRENT_CHECKPOINT.json`
Owner decisions: from current Gold integrated plan, NOT a license to migrate or publish
Primary truth: check current repository SHA, source, automated tests, and deployed runtime independently

## 0. Five-minute read-first instructions

1. Connect the authorized official Light Remote plugin to **VPS-ARM** (not a random Main fallback). There is an existing durable session `s_mvueriuz_5db9dea30e943f5e` on target device `direct-arm-local` as observed 2026-10-30; sessions can expire, so **verify readiness and exact target** before executing. Do not reuse old one-time A codes.
2. Worktree: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/gold-windows-stability-20261028`; branch: `feat/gold-connection-gc-reconciler-20261029`; GitHub: `n8n2erpnext/light-remote-mcp`. Current accepted implementation source commit: `8b1863bfc8f7cfd8908bbc33fa3fe9e492ab558f`. Exact GitHub CI: [Gold GC source gate 41041843902](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41041843902) **PASS 4/4**, [Project truth 41041843809](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41041843809) **SUCCESS**, [Library integrity 41041844080](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41041844080) **SUCCESS**. **Always run `git status --short --branch; git rev-parse HEAD; git log -5 --oneline` and compare to origin before coding.** The new milestone commit SHA and CI status must be recorded in the checkpoint after a successful push (or reported as pending), not guessed.
3. Read [Project Book entry](README.md), [Library Rules](LIBRARY_RULES.md), [Project truth](LIGHT_REMOTE_PROJECT_BOOK.md), [Code Map](LIGHT_REMOTE_CODE_MAP.md), [Worklog](LIGHT_REMOTE_WORKLOG.md), [P2 integrated plan](../gold/GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md), [Acceptance Ledger](../gold/GOLD_P2_UNIFIED_ACCEPTANCE_LEDGER_20261030.md), [I0 source audit](../gold/GOLD_P2_I0_SOURCE_CONTRACT_AUDIT_20261030.md) and `.light-remote/CURRENT_CHECKPOINT.json`.
4. Do **NOT** start by migrating Gold UAT or changing production. Everything described here is **source-only** and tested on isolated clone/CI. The owner requested continuing implementation with handoff at a safe checkpoint, not a production release.
5. Next deliverable: **trusted authenticated integration of A/B V2 pending discovery and approval**, then separate migration 043 rehearsal and Short ID Wall STANDBY. Existing V1 remains an explicit rescue path. Do not treat Redis `approved` as a signed real device grant.

## 1. Non-negotiable owner product contract

- A V2 format `ABCD02-GHFDX`: fixed six-character Crockford Base32 device Short ID + **five-character** on-demand rotating suffix. The first six digits/letters remain visible on authorized device Wall STANDBY and authorized `/account` even without an active request; suffix exists ONLY for a pending exact Agent-initiated request.
- B V2 is **4+4** easy-read characters, separate from A; only the requesting authorized Agent may see plaintext B. Owner **types** B into a protected Wall or `/account` screen; never put B into Wall HTML/DOM or any owner-facing API.
- New V2 pending approval TTL = **300 seconds / five minutes from server issuance**. Explicit owner Refresh of the selected still-pending generation invalidates old A suffix+B, atomically creates a replacement generation and new 300s absolute deadline. Helper retries, polling, reload, reconnect and wrong B never extend TTL. Backend Redis server TIME wins over client clock.
- A/B V1 original 4+4 A, 4+4 B and **3-minute A default** remain unchanged for compatibility and manual repair when V2 device discovery fails. Standby `Refresh status` does NOT mint a new A; a visible **Manual pairing V1** rescue path must remain.
- After real explicit owner B approval, existing actual A/B device grant authority remains capped at **24 hours**. An internal Redis pending status alone is NOT a grant; active OAuth owner/session + exact connection + device policy + grant registry and signed device execution channel are separate trust boundaries.
- No silent Main selection for duplicate names. Resolver is scoped to authenticated permitted owner devices or explicitly shared Pro Share devices and returns 0/1/N with at most five candidates.
- After ready, Agent self-chooses a display-only, human-readable session nickname (fruit/animal/insect/flower/plant/place), while immutable sessionId remains canonical; user rename wins, label must never authorize access. Nickname work remains later P2-I3.
- Pro Share (one owner plus one invited guest, proposed Pro $20 +$5 option) is a **later P2-I4 UAT-only business model**, billing OFF until explicit owner launch approval. Old five-seat Pro Team must remain dormant/unchanged. NEVER implement enterprise branch/group RBAC now.
- Future Light Remote IT Support organization, branch, cluster, user/group scoped RBAC example (Leader 100 devices, five staff each two branches) is **future design only AFTER core Light Remote stable**; A06/A07 are FUTURE_NON_BLOCKING and NOT P2 gates.

## 2. Trust and environment separation

| Environment | Last verified | Allowed now |
| --- | --- | --- |
| Production rc47 | Historical production remains untouched | No upgrades, restarts, migration, billing or cutover |
| LXD live `light-remote-gold-uat` | Read-only 2026-10-30: PG schema **039/39**, 1 historical resource claim, 27 UNKNOWN work rows (26 historical pre-dispatch, one started); previously four services active | Read-only verification. Do not claim old native command terminated, fabricate ACK or clear historical rows |
| LXD `gold-p2a-runtime-rollback-20261030` | Isolated networkless clone, device list `root`, `boot.autostart=false`, STOPPED after new tests | Start only for bounded no-NIC PG/Redis fixtures; shut down temporary services, delete fixture data and return to STOPPED |
| Git Gold worktree | branch above, current code and CI | Development, source-only commits, code map/Worklog/checkpoint updates |
| Win10/Win11/macOS/Linux clients | Existing builds, no fresh installed Agent E2E for integrated A/B V2 | Do not claim combined native acceptance |

Critical: Gold UAT has unique historical claims and UNKNOWN work. Neither rollback drills nor source fixtures authorize deleting/releasing those rows. Existing source schema lock remains through 042, live 039, candidate 043 NOT registered.

## 3. Source development completed, with exact file map

### P2-I1 — stable Short ID + limited resolver (commit `76df1ebb513d93b8b8fab2750b4eeeb154aaf2fe`)
- `platform-v2/sql/043_gold_device_short_ids.sql`: additive **candidate** PG17 immutable/reserved six-character Short IDs, unique active device binding, tombstone preserved on delete so no recycle; not in `platform-v2/sql/migrations.lock.json`, not run on UAT.
- `lib/gold-device-short-id.mjs`: crypto-strong Short ID generator, concurrent SQL collision handling, bounded backfill, account-scoped visible list and 0/1/N resolver over a permitted device subset. Never treat Short ID as a capability.
- `deploy/scripts/selftest-gold-p2i1-short-id.mjs`: source fixture PASS.
- `deploy/scripts/ci-gold-p2i1-short-id-pg.mjs`: real PG disposable database on no-NIC clone PASS: 12 concurrent allocators, rename-stable IDs, retired/tombstone ID not recycled, owner isolation. No UAT migration. Source CI accepted 4/4 at this commit.
- **Missing:** real Operator native device persistence integration, Short ID on Wall STANDBY, migration chain/rollback 043, actual owner-resolved Agent flow.

### P2-I2a — pending A/B V2 Redis state (commit `84e248b68106389985fbef60057de0998ab26239`)
- `lib/gold-ab-v2-pending-redis.mjs`: **source candidate**, no actual routes or live flags. Redis 8 single atomic EVAL per state transition: issue, bound Agent poll, owner Wall view, manual Refresh generation CAS, owner approve/deny, server TIME expiry. A6+5/B4+4, 300sec TTL, AES-256-GCM encrypted B in Redis with stable externally managed 32-byte sealing key, HMAC fingerprints for B, wrong-B lockout and issue/refresh limits.
- `deploy/scripts/selftest-gold-ab-v2-source.mjs`: independent format and encrypted-code fixture; CI.
- `deploy/scripts/selftest-gold-ab-v2-pending-redis.mjs`: **real Redis8** no-NIC clone fixture using throwaway Unix socket `/tmp/lr_p2i2_demo.sock`, strict opt-in env `LR_P2I2_REDIS_TEST_ALLOW=1`, verifies concurrent Refresh only one winner, old B rejected, wrong owner/Agent rejected, server expiry, encrypted B not plaintext in Wall/Redis, recovery with a new store object, issued code rate limits and 5 invalid entries lockout. PASS exit0/stderr0.
- Gold Connection Lifecycle GC source workflow 4/4 PASS at `84e248b`, project truth gate and document library integrity PASS. No deployment or grant.

### P2-I2b — scoped pending-list extension (verified source SHA `8b1863b`)
- Same `lib/gold-ab-v2-pending-redis.mjs`: HMAC-separated Redis pending sorted-set **per owner+device+connection**. Issue adds request ID/expiry in same Lua transaction, manual Refresh updates index deadline + TTL, approval/denial/expiry/lockout remove entry. `listDevicePending({ownerAccountId,deviceId,connectionId,limit})` returns up to five pending request summaries with *individual owner scope checks*, never B. No fleet-wide redis SCAN. Designed as a seam for Wall query.
- Extended Redis clone fixture verifies two simultaneous Agent requests remain distinct, owner/device/connection scope cannot enumerate another target, generation rotation and index cleanup. Latest exact test PASS, exit0/stderr0, throwaway Redis shutdown and clone STOPPED. Source CI 4/4, source↔docs checkpoint and library integrity workflows SUCCESS at `8b1863b`; this is NOT a deployed or owner-approved release.
- Critical limitation: owner/device scope arguments in this library are trusted only AFTER a real authenticated route independently validates the principal and current device connection. This is NOT a security endpoint or safe public API by itself.

### P2-I2c — owner pending adapter, source-only candidate (THIS session)

- Started from clean HEAD/remote `28766f4a3225f4aa15cc65cb4d5ce30db30924fd`, VPS-ARM device explicitly authorized, no production or Gold UAT changes.
- New `lib/gold-ab-v2-owner-pending-adapter.mjs`: fail-closed server-internal owner pending list/view/Refresh/deny, NO public routes, no approve/grant. Requires injected server account-session authentication, canonical device ownership, live connection validation, signed enrollment verification, permission decision, OFF-by-default flag, Origin+CSRF for mutations. Request-body owner/actor/client identifiers ignored. Strict response allowlist excludes B/ciphertexts/hash fields.
- `deploy/scripts/selftest-gold-ab-v2-owner-pending-adapter.mjs` checks wrong owner/device/revocation, invalid/expired connection, feature OFF, denied enrollment/policy, CSRF/Origin denials, body spoof, no secret leaks, no approval method. Local source tests PASS together with existing A/B and Short ID source fixtures. The Gold GC source workflow includes this test.
- This is a **typed integration seam, not yet wired to the real Operator `requireAccount`, live HTTP middleware, Agent Helper, /account, or Local Wall**. Real grant↔pending reconciliation and native 24h execution authority are still NOT implemented. Exact new commit SHA and CI pending until Git push completes.
- Trust route audit: `operator-host/executor.mjs:1291` defines `requireAccount(req)`; `executor-routes-account.mjs:530` owner device listing uses it. Legacy `executor-routes-device-channel.mjs:273–380` still serves V1 pairing/access/Agent client; `plugin-server/operator-adapter.mjs:58–92` uses legacy `pairBegin/pairRecover`. Do not reuse V1 body-supplied identity as trusted V2 OAuth context.
- NEXT: bind genuine authenticated Operator callers to adapter with negative HTTP tests and revalidation; design idempotent prepare/owner B/grant reconciliation, then only later add approval route. Keep feature flags OFF and clone STOPPED.

## 4. Critical upcoming integration gaps — do not skip

1. **Resolve user/Agent identity from verified server OAuth and attached session**, not from request JSON. Reject all attempts to spoof `ownerAccountId`, `actorAccountId`, `agentId`, `clientId`, `deviceId`, `connectionId`; authorize target device against caller's permitted set. For now owner only; Pro Share later with its own exact share grant.
2. **Real enrolled device binding and status**: verify device UUID, immutable Short ID from canonical PG, active signed connection ID, enrollment revocation and current device policy on issue, refresh, approval, session creation AND dispatch. Stale connection must fail closed and invalidate old pending attempts.
3. **Protected Wall and `/account`**: get pending list via authenticated server route; CSRF and origin/session checks for Refresh/B approval; owner sees A/agent/expiry, NEVER B plaintext; expiry/countdown UI reflects backend state. In STANDBY show Short ID6 without auto-rotating suffix; offer explicit legacy V1 manual fallback.
4. **Grant handoff is not implemented**: `GoldAbV2PendingRedis.approve()` updates Redis pending state only. The current `operator-host/device-access-grant-registry.mjs` holds actual 24-hour A/B grants and has its own requests. Need a carefully designed transactional **prepare → owner B approve → actual grant issuance → helper ready** contract with idempotency/recovery and live grant verification; do NOT report helper ready based on Redis `approved`. Reconcile/compensate if Redis pending becomes approved but real grant creation fails; preserve true audit events.
5. **Agent Helper**: `plugin-server/tools.mjs` helper currently advertises a legacy `aCode` pattern 4+4; `plugin-server/operator-adapter.mjs` has legacy pairBegin/recover. Add a compatible target-query / explicit Short ID path without removing A/B V1 schema or forcing client upgrade; recover exact request+Agent, not newest request.
6. **New persistence**: PG migration 043 remains outside current `migrations.lock.json` which is pinned at 042 for P2-A. Do not casually insert migration 043 into live runner; complete isolated version-43 migration + rollback/restore on clone with old code compatibility FIRST, then owner-authorized UAT only.
7. **Redis key secrecy/lifecycle**: encryption key must persist across planned restart/leader failover via existing secure config, never file/git/log. All Redis keys need namespace, TTL and owner-bound lookup; use rate limits and request/attempt CAS; never send ciphertext to Wall. Multi-Operator/read-after-restart tests required.
8. **Security code**: source-level fixture is not equivalent to installed native Agent ↔ Operator signed terminal ACK. Keep historical claims and claims journal intact. Protect all job dispatch from stale grants/epoch/revocation.

## 5. Precise next-step order, with safe stop points

**N1 (source-audited 2026-10-30)** Read `operator-host/executor-routes-device-channel.mjs`, `operator-host/executor-routes-account.mjs`, `operator-host/executor-routes-plugin.mjs`, `operator-host/device-access-grant-registry.mjs`, `operator-host/device-pairing-registry.mjs`, `plugin-server/tools.mjs`, `plugin-server/operator-adapter.mjs`, `device-agent/local-wall.mjs`, `lib/gold-native-account-device.mjs`; create a specific route/trust-caller map in the Code Map or I0 source audit. **Do not** assume endpoints exist.

**N2 (owner pending adapter source-only added; full Operator wiring NOT done)** Connect the new fail-closed owner adapter to real server-side requireAccount/session + signed enrollment/policy/connection checks behind flag OFF. Independently add trusted Agent identity/target resolution and exact request correlation; run negative HTTP tests. Redis V2 already enforces issuance/attempt rate limits; do not confuse adapter fixture with live auth or native acceptance.

**N3** Design **actual approved grant issuance** using existing grant registry and Operator ownership/replay contracts; decide safe atomic/reconciliation boundary before changing code. Add 24h grant and old-client tests; never promote Redis-only status to ready.

**N4** Bring 043 into independently tested version 43 migration + rollback chain on isolated clone, then Short ID backfill and active readback on local Wall STANDBY (server-owned Short ID, no changing UUID on rename). Prior P2-A 039→042 receipts still remain historical evidence only.

**N5** Wire Agent-first targetQuery/helper, Local Wall Pending+STANDBY, owner `/account` approval/Refresh with CSRF, manual V1 fallback, multi-Agent-specific request IDs. Implement true UI tests and native installed-Agent E2E only after candidate freeze.

**N6** P2-I3 Agent-chosen durable nickname and P2-I4 Pro Share small one-guest owner-scoped path, flags disabled. P2-I5 one integrated frozen candidate, one P2-C final physical UAT, P2-D signed updaters, P2-E explicit owner release decision. Future IT Support enterprise RBAC remains AFTER core stabilization.

## 6. Test reproduction and provenance

Source-only unit:
```bash
node --check lib/gold-ab-v2-pending-redis.mjs
node deploy/scripts/selftest-gold-ab-v2-source.mjs
node --check deploy/scripts/selftest-gold-ab-v2-pending-redis.mjs
node deploy/scripts/selftest-gold-p2i1-short-id.mjs
```

Read-only Git sanity:
```bash
git status --short --branch
git rev-parse HEAD
git log -5 --oneline
git diff --check
node deploy/scripts/check-project-truth-sync.mjs --head
node deploy/scripts/generate-doc-catalog.mjs --check
node deploy/scripts/check-doc-links.mjs
```

Real Redis8 fixture **requires deliberate owner-authorized isolated no-NIC clone**, not plain GitHub Actions or UAT live:
- Verify clone is `gold-p2a-runtime-rollback-20261030`, STOPPED, `boot.autostart=false`, has only `root` device and no NIC. Do NOT attach network to it.
- Start clone temporarily. Staging root from prior fixture: `/var/tmp/light-remote-p2b-http-3cc75476cbf657d1b0dcd3dea054f9843f685cd0`; check existence, do not assume it persists forever. Push the two relevant files from source worktree using `lxc file push`.
- Start *throwaway* Redis on Unix socket using `redis-server --port 0 --unixsocket /tmp/lr_p2i2_demo.sock --unixsocketperm 777 --daemonize yes --save '' --appendonly no --pidfile /tmp/lr_p2i2_demo.pid` (no TCP, no persistent data). Execute fixture with `LR_P2I2_REDIS_TEST_ALLOW=1 LR_P2I2_REDIS_SOCKET=/tmp/lr_p2i2_demo.sock`.
- Expect tests named `GOLD_ABV2_REDIS_CAS_REFRESH_NO_CROSS_AGENT`, `GOLD_ABV2_B_SECRET_8CHAR_OWNER_DENIAL`, `GOLD_ABV2_SERVER_TIME_300S_AND_NO_OLD_B`, `GOLD_ABV2_RATE_LIMIT_REPLAY_EXPIRED`, each PASS, exit 0/stderr empty. Afterward `redis-cli -s /tmp/lr_p2i2_demo.sock SHUTDOWN NOSAVE`, `lxc stop` and confirm STOPPED/no autostart. Do not operate live Redis.
- For PG043 isolated test use `deploy/scripts/ci-gold-p2i1-short-id-pg.mjs` with its strict LXD/allow flag; it creates then removes a disposable DB. SQL043 not in current schema manifest.

Acceptance reference: [unified ledger](../gold/GOLD_P2_UNIFIED_ACCEPTANCE_LEDGER_20261030.md). A01 and A03 are PARTIAL_SOURCE_PASS, not deployed; A04 pending index is PARTIAL_SOURCE_PASS, not a working Wall. A05 legacy V1 code remains. Nxx nickname, Sxx Pro Share not shipped.

## 7. Mandatory documentation and code-governance routine

Do not create fresh dated handoff documents every session. **Update THIS rolling file and the single checkpoint in place**. Append milestones to [Worklog](LIGHT_REMOTE_WORKLOG.md) and edit [Code Map](LIGHT_REMOTE_CODE_MAP.md) when authority paths change. The SHA/Git gate is mandatory for source commits:

```bash
git add <changed-source> docs/project-book/LIGHT_REMOTE_WORKLOG.md docs/project-book/LIGHT_REMOTE_CODE_MAP.md .light-remote/CURRENT_CHECKPOINT.json
node deploy/scripts/generate-doc-catalog.mjs --write
node deploy/scripts/generate-doc-catalog.mjs --check
node deploy/scripts/check-doc-links.mjs
node deploy/scripts/check-project-truth-sync.mjs --stamp
node deploy/scripts/check-project-truth-sync.mjs --staged
git diff --cached --check
git commit -m '...'
git push origin feat/gold-connection-gc-reconciler-20261029
```

Note: regenerate catalog **before staging all docs** and stage the generated `docs/project-book/SOURCE_CATALOG.md` and `source_catalog.json` too. Source guard requires a NEW dated Worklog heading, checkpoint with staged Git blob SHA and Code Map when Gold security/Operator files change. Local precommit hook is worktree-scoped and CI separately enforces it; docs-only commits may update checkpoint without restamping source SHA. Verify CI at each exact pushed SHA, not prior jobs.

External historical handoffs (retained): `/home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_P2_MASTER_HANDOFF_20261030.md`, `/home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_P2_INTEGRATED_IMPLEMENTATION_HANDOFF_20261030.md`. They are provenance, not a reason to ignore this Project Book or current Git/runtime state.

## 8. Rollback and reporting boundary

This milestone changes **Git source only**; no deployment rollback is required unless somebody later deploys it (forbidden here). If a source regression is found, inspect exact SHA/CI and revert only affected source commit, preserving audit/documentation history. Do not rewrite production rc47, Gold UAT 039/39, Redis, PG history or 27 UNKNOWN rows. Do not claim the new pending index by itself provides server-authorized A/B grants, Wall refresh or helper ready.

Before next-session finish: revalidate Git HEAD and origin, compare to accepted source milestone `8b1863b` and docs commit `28766f4` and its verified 4/4 source + 2 documentation workflows, check clone remains STOPPED and live runtime unchanged, and state one next action. New source commits require their own exact-SHA CI evidence. Update the current checkpoint accordingly. User wants the next Agent to read source/Git and continue rather than repeat planning.
