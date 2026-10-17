# Light Remote New Gold — integration checkpoint, 2026-10-17

**Status: SOURCE INTEGRATION UNDERWAY / NOT OPERATIONALLY GOLD / NOT PRODUCTION READY.**

## Immutable source lineage

- Clean base: `origin/main@12bb746ca3e13e493ac5f634e79f8dda8b3d2ce0`.
- Authoritative Operator + Plugin + UI V4/R4 source: deployed LXD `light-remote-direct`, release `ux-v5-device-os-20261009-r4`. Gold source overlay already recorded in `PRODUCTION_GOLD_SOURCE_2026-10-17.md` and commit `acd1f53`.
- Client **verified source** Windows rc48 cursor `083f60f` and macOS rc49 `2eb1553`, with focused rc49 source tests PASS separately. THESE CHANGES ARE NOT INTEGRATED INTO THIS WORKTREE because the previous client source mutation was locally safety-denied. DO NOT CLAIM WINDOWS/MACOS RC49 GOLD COMPATIBILITY.
- Linux code tree at `origin/main` matches `codex/rc49-macos-robot-permissions` under `client/linux`.
- Pro Team, Inbox, Notification Center and AI Guide functional source: `feature/free-benefit-pro-team-20261010@6ab88ecebd601c9b25da71f92570fa8cac9c4523` and source-only staging exceptions preserved outside old RC50 UAT.
- Read `GOLD_SOURCE_RECONCILIATION_20261017.json` for the exact 23 overlap files, 16 client files, 3 incompatible shared libraries and three live-release selftests not copied into this worktree.

## Work now preserved in this source-only checkpoint

- 11 **non-overlapping** Team / Inbox / Notification source and UI files selectively imported from `6ab88ec`, without replacing any conflicting production V4/R4 hotfix. Source syntax of the 7 new `.mjs` modules passes. **These are additive source files, not wired runtime features.** Their original source tests pass on the original reference branch but gold end-to-end routes are not accepted.
- All thirteen SQL migrations (001–013) plus exact original `migrations.lock.json` copied from the old isolated RC50 UAT source and independently validated hash-for-hash. Schema remains **a synthetic UAT reference**; database ownership, app grants, live data translation and production migration are not implemented.
- Dedicated `infra/pgredis/compose.yml` for **PostgreSQL 17 and Redis 8**, with private internal Docker network, named volumes, no published host ports, per-stack credentials passed as external paths and no plaintext secrets in Git.
- `deploy/scripts/selftest-gold-pg-redis-source.mjs` validates migrations SHA and Compose isolation structure; Python YAML also parsed; all SOURCE-level checks PASS.
- A managed tool request to instantiate the DB stack with declared Docker capability returned `target_node_capability_missing`. **No new PostgreSQL/Redis containers or volumes were started, and no credentials generated.** Never bypass this policy by changing tool transport or removing declared capability.
- RC50 old LXD UAT and Docker PG17/Redis8 plus their test volumes and proxy containers were already deleted with owner's no-backup instruction. Old code/docs and uncommitted P0 source preserved as references. The separate remaining UAT host secret files were safety-denied for deletion in a previous turn and remain a known cleanup hold.
- Legacy production still has JSON file-backed durable state and Plugin-specific storage; no runtime API is yet connected to new PostgreSQL or Redis. NEVER claim new system operates entirely on PostgreSQL/Redis.

## Original source-focused tests (not gold integration tests)

On `codex/rc49-macos-robot-permissions@2eb1553`, 5 macOS/client tests PASS. Current gold source's macOS bridge/GUI/physical typing tests FAIL due source mismatch in `lib/native-desktop.mjs` and `lib/real-remote-input.cjs`. This is a known blocker, not a CI green acceptance. On `6ab88ec`, eight Team/Notification/AI Guide focused suites PASS, but are not evidence those features work integrated with production V4/R4.

## Finite next acceptance before calling it Gold

1. Restore authorized client source operations so Windows rc48 and macOS rc49 verified changes and their three shared library contracts can be reconciled without losing deployed backend behavior; make all focused tests pass **on the same exact gold commit**.
2. Perform manual three-way reconciliations of the 23 production-V4/Team overlapping files, and run the entire Operator/Plugin/Account/Team/Inbox/Notification/AI Guide API integration suite. No bulk cherry-pick of P0 WriterEpoch source.
3. Resolve the Light Remote Docker effective capability for the authorized VPS-ARM session and bring up the dedicated private PG17/Redis8 stack, verify real service/role connection and secure configuration; no workaround via other runtimes.
4. Complete persistence adapters/data migration for actual Operator+Plugin durable state (legacy JSON, OAuth, Paddle, outbox) with PostgreSQL as sole mutable authority and Redis only ephemeral; perform clean-room restore rehearsal.
5. Cut final SOURCE + DB checks into a signed/traceable candidate version and independent cross-architecture test; only then publish a release or affect production.

**No production deployment/restart, no customer data touched, no Git main or distribution channel changes. This is intentionally a SOURCE CHECKPOINT, not a finished product.**
