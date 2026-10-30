# Gold P2-A — Backup, migration and rollback gate (2026-10-30)

Status: **SOURCE + ISOLATED PostgreSQL REHEARSAL ACCEPTED**. This document is a
runbook, **not** an authorization to change live Gold UAT or production rc.47.

## Boundaries

- Gold branch: `feat/gold-connection-gc-reconciler-20261029`.
- Live Gold UAT: LXD `light-remote-gold-uat` on VPS-ARM. Database `light_remote_gold_dev`,
  PostgreSQL 17.11; schema **039** at handoff. Do not apply 040/041/042 to live
  until a *separate owner approval*. Production rc.47 remains unchanged.
- Live four systemd units: `light-remote-gold-operator`, `light-remote-gold-plugin`,
  `light-remote-gold-wall`, `light-remote-gold-process-supervisor`.
- Immutable current UAT runtime: `/opt/light-remote-gold-uat-candidates/7f46dea1380cfd6a57dcfacf377bdad67cdf2736`.
- Historical foreign M4 claim MUST be preserved, never auto-released or
  replaced with fabricated terminal ACK. `UNKNOWN`/no-PID holds remain fenced.
- Btrfs LXD filesystem ~81% full at rehearsal, VPS host ~85%. Verify *fresh*
  available space before every snapshot, export, stage or restoration.
- No secrets, database dump, env vars, signing keys or owner credentials in CI
  artifacts, Git, logs, or conversational output.

## Verified recovery anchors

- Private PostgreSQL 039 custom dump:
  `/home/ubuntu/backups/light-remote-gold-p2-20261030/uat-schema039.dump`
  - bytes: 970369; mode: 0600
  - SHA256: `8a8a4f2df4366c6211e9e9e0afa3ea14da2bab53a43bdd47645c4bbdc07aada8`
  - `pg_restore --list` checked with isolated PostgreSQL 17.
- Fresh LXD btrfs snapshot:
  `light-remote-gold-uat/gold-p2a-before-schema040-20261030`.
  This was a **non-stateful snapshot taken while running**, not a PostgreSQL
  transaction-consistent image on its own. The logical dump is the DB anchor.
- Historical immutable runtime candidate remains on disk and every unit
  WorkingDirectory/ExecStart matched it at preflight.
- Snapshot/dump dates are rehearsal anchors only. Capture *new* crash-consistent
  preimages and a current database dump immediately before any future live
  UAT maintenance; do not assume the historical dump's RPO is zero.

## Isolated P2-A PostgreSQL acceptance

- Docker `gold-p2a-pg17-20261030`, PostgreSQL 17, loopback-only
  `127.0.0.1:15439`; no connection to LXD UAT DB. It uses a disposable
  non-superuser `lr_gold_migrator` and Unix socket inside the clone.
- Restore verified UAT 039 custom dump: 39/39 schema ledger; historical M4
  claim count one. Real `deploy/scripts/apply-gold-db.mjs` with explicit
  approval flags: 040, 041, 042 applied; 42/42 schema ledger.
- Second invocation: 42/42 `already_applied`, no duplicate migrations.
- 040 GC fence, all 041 epoch/issuance/pages/effect-start tables, 042 audience
  constraint including `wall`: present; application role has no schema
  CREATE, no ledger INSERT, no migrator membership.
- Missing migration opt-in, tampered locked SQL SHA, future ledger version 043,
  and existing ledger 042 with a non-wall audience constraint: fail closed.
  All negative mutations were made only to the disposable clone and reversed.
- Database restart/readback at 042: PASS. Disposable clone drop/pg_restore to
  039: PASS, 39/39, preserved historical claim, 041 table absent. Re-run
  hardened migration 039→042: PASS.
- CI source-only test `selftest-gold-p2a-migration-lock.mjs` checks all 42
  locked files, transaction shape, fixed 040/041/042 tail and opt-in denial.
- CI 1k/10k jobs are **synthetic PG/protocol loads**, not ten thousand physical
  Agent processes, sessions or desktop workers.

## Future owner-approved live Gold UAT migration (NOT EXECUTED)

1. Freeze deployment window, confirm exact device allowlist, feature flags OFF,
   schema 039, 4/4 units and immutable runtime SHA. Prove **zero active jobs
   and sessions** and preserve every historical claim, including foreign claims.
   Do not assume zero job-count alone means no active OS effects.
2. Capacity gate: check host + LXD free space, backup destination external to
   the 40GiB container volume where feasible. Record current logical DB size,
   migration ledger, role grants, Git SHA, package signatures and service graph.
3. After write freeze/maintenance is approved, obtain a *fresh* PostgreSQL
   custom dump and check SHA256 + `pg_restore --list` + independent restore.
   Capture consistent filesystem snapshot and preimage of **all four** systemd
   unit files/overrides plus runtime candidate. Protect copies with mode 0600.
   Keep encryption/Agent enrollment state unchanged.
4. Prove source/manifest 42 hashes and previously observed 039 ledger on
   independent clone; rerun migration twice as the migrator; verify schema
   postconditions and application read compatibility before live opt-in.
5. Only with **separate owner approval**, transition the staged Gold UAT from
   039 to 042 and use allowlists to stage isolated test devices. Do not enable
   GC, epoch or stale monitor across all devices. Audit service/endpoint
   health and feature flag state; never automatically promote production.

## Four-service runtime + database rollback contract (NOT EXECUTED LIVE)

- The legacy `deploy/scripts/gold-g3-uat-cutover.sh` is **not compatible**:
  it changes only Operator/Plugin/Wall (3 units), assumes exactly two
  outbound leaves, and does not coordinate database schema changes.
  Never invoke it for P2-B without a full four-unit rewrite and acceptance.
- The supervisor service is independent (no `PartOf` Operator/Plugin/Wall).
  It must be explicitly handled during stage, shutdown, restart and rollback.
- With owner-approved maintenance and verified no executing effects, quiesce
  Wall → Plugin → process-supervisor → Operator, maintaining a documented
  rollback on any failure. Never force-kill a potentially running effect on
  the assumption that a Job has finished; signed ACK is required for release.
- Keep an **additional forensic post-upgrade dump** before replacing a damaged
  candidate DB. Restore the *paired* schema 039 database from a validated
  backup and restore previous four-unit preimage + immutable 7f46dea source;
  roll back application + database together, not one alone.
- Restore roles, privileges and filesystem/Agent enrollment settings
  according to the verified preimage. Treat Redis as transient coordination,
  **not** durable authority; inspect Gold-only keys and their TTL/policy
  before any selective cleanup. Never flush a shared Redis database.
- `systemctl daemon-reload` after restoring *all four* unit overrides.
  Start Operator → process-supervisor → Plugin → Wall, respecting dependencies.
  Require stable repeated checks for each service, socket, Wall and signed
  Agent reconnection, then recheck 039 ledger, grants, historical claims and
  all feature flags OFF. Preserve the external rollback evidence.
- A live rollback loses writes since its selected preimage. Owner must accept
  that RPO explicitly; never pretend an old rehearsal dump is current.
- Full physical runtime/Redis rollback rehearsal is **OPEN**, planned for
  controlled P2-B staging without touching production or live 039 beforehand.

## Gate table

- P2-A migration locked manifest and runner hardening: PASS.
- P2-A *actual* PostgreSQL clone 039→042 + idempotency + fail-closed: PASS.
- P2-A PostgreSQL clone rollback 042→039 + data preservation: PASS.
- P2-A fresh live backup/snapshot evidence: PASS at rehearsal, refresh at cutover.
- P2-A physical four-unit/Redis rollback: **NOT YET TESTED**.
- P2-B deployment, P2-C native E2E, P2-D updater, P2-E production: NOT STARTED.


## P2-A real LXD clone four-service recovery rehearsal (2026-10-30, same day)

This evidence supersedes the earlier statement that the four-unit rollback was
entirely untested, **but does NOT close the Wall steady-state or Redis key
compatibility acceptance gates**.

- Created `gold-p2a-runtime-rollback-20261030` from
  `light-remote-gold-uat/gold-p2a-before-schema040-20261030` with LXD Btrfs
  CoW. Removed inherited NIC and all profiles before first boot; effective
  devices contained only `root`, network interfaces only `lo`, no IPv4
  default route. `boot.autostart=false`, memory limit 2 GiB.
- Snapshot clone had local PostgreSQL 17, Redis and four real systemd units.
  Database started at 039 with one historical foreign M4 claim. Clone was
  independent of the live UAT database and **could not reach remote devices**.
- Preimage backups were made **inside the isolated clone**:
  `/var/lib/light-remote-p2a/preimage039.dump`, SHA256
  `4eb164685c9369f27da45ae6bbdd85276cd1582060096e0695fe570ce6b9a6e1`
  and four-unit `preimage-four-units.tar`, SHA256
  `0e21ebb1ac0a7bd2e995341ca1a13d323e9363d38e71561d57be0cf3212b6b81`.
  Files and secret-bearing systemd overrides remain PRIVATE inside clone.
- Stopped Wall, Plugin, Process Supervisor, Operator. Inserted an isolated
  `ConditionPathExists` negative override for **all four** services.
- On clone only, applied locked 040/041/042 SQL and ledger to schema 042.
  Attempted restart; all 4 units remained inactive. Expected failed-candidate
  detection PASS. This injection did not alter live UAT service files.
- Dropped/restored ONLY cloned PostgreSQL database to 039 using its private
  dump: 39/39 migrations, foreign historical claim count 1, epoch 041 absent.
- Removed four negative overrides; compared complete original four-unit
  archive with `tar -d`, **bit-for-bit original unit config PASS**;
  `systemctl daemon-reload`; started Operator → Supervisor → Plugin → Wall.
  All four initially reported `active` and `ExecStart` pointed back to
  the immutable source 7f46dea.
- 10-sample continuous systemd health check: Operator, Plugin,
  Process Supervisor, PostgreSQL and Redis **PASS**. Wall **HOLD**:
  transitions to `activating/auto-restart`, `ExecMainStatus=1`,
  `NRestarts>=24` in this deliberately networkless clone. No signed
  outbound E2E was attempted. Do NOT claim four-service stable health PASS
  or attribute the failure solely to networking without explicit proof.
- Redis ran locally, bound `127.0.0.1:6379` and `::1:6379`;
  unauthenticated `redis-cli PING` returned `NOAUTH`. No Redis
  flush/delete, no shared Redis access and no private key/secret read.
  **Redis per-key/TTL readback and cross-version protocol compatibility
  remain unverified**, not PASS.
- On clone, executed current Gold-source legacy G3 cutover script with
  explicit opt-in flags and received exact safe denial:
  `G3_GOLD_LEGACY_THREE_UNIT_CUTOVER_UNSAFE_WITH_SUPERVISOR`.
  Four-unit original archive remained identical after the denial.
- Stopped the clone cleanly at the end, leaving its Btrfs CoW volume
  available, network disabled and autostart disabled. Btrfs pool used
  approximately 31.69 / 40 GiB after clone test.
- Verified live UAT **unmodified**: PostgreSQL schema039, claim count1,
  Operator/Plugin/Wall/Supervisor all active. Production rc.47 untouched.

Updated acceptance:
- Four-unit STOP / bad-candidate detection / config restoration /
  safe restart ordering / PG restore **PASS in isolated LXD**.
- Gold UAT live four-unit restart, Wall stable health, authenticated Redis
  key/TTL compatibility, signed Agent reconnect and approval-gated live
  rollback **NOT TESTED / HOLD**. P2-A is **partially accepted**, and
  P2-B must not promote or migrate live UAT automatically.


## P2-A final isolated Wall/Redis root-cause & compatibility acceptance (2026-10-30)

This section resolves the isolated Wall/Redis HOLDs above. Earlier negative observations
were real but **the Wall restart cause was identified and corrected in clone only**.
The original UAT runtime/IP binding was **not** changed.

### Wall restart diagnosis and independent proof

- Reopened the deliberately networkless LXD clone
  `gold-p2a-runtime-rollback-20261030` with only `lo`, no NIC and no route.
- Sanitized journal error: `Error: listen EADDRNOTAVAIL: address not available
  10.192.135.61:5491`. This is the hard-bound **original UAT container IP**
  which is absent inside the isolated snapshot clone.
- Resolved only on clone by a temporary systemd drop-in defining
  `OPERATOR_AGENT_WALL_HOST=127.0.0.1` and
  `OPERATOR_FLEET_WALL_HOST=127.0.0.1`. Did not open external networking.
- Wall immediately became ACTIVE. Repeated 15 samples of all six units:
  Operator, Plugin, Wall, Process Supervisor, PostgreSQL, Redis: **PASS**.
  `systemctl show`: `ActiveState=active`, `ExecMainStatus=0`,
  `NRestarts=0`.
- Loopback HTTP `http://127.0.0.1:5491/` returned **303**, verifying the
  HTTP handler responded. Port 5492 **did not listen on the clone**; no
  acceptance claim is made for Fleet Wall / 5492. Do not infer authenticated
  owner login or signed native Agent E2E from HTTP 303 alone.

### Redis 8 authenticated TTL/schema + restart

- Local Redis 8.10.2, original `requirepass` kept. The clone-only private
  probe read authentication from the local Redis config *in memory*,
  authenticated via `REDISCLI_AUTH`, and did not print passwords, key
  names, key values, tokens, session IDs or private Redis content.
- Gold Redis namespace observed **126 keys; 126 expiring**, zero permanent or
  missing. Session snapshot `runtime:sessions`: one checked, JSON
  `schemaVersion=1`, arrays `sessions`, `openDedupe`,
  `agentDeviceSessions` valid; no session content disclosed.
- Existing key TTL positive, range at measurement approximately
  604775735..2549092298 milliseconds (snapshot in time, not constant).
- Private test key `lr:gold:p2a-isolated:synthetic-ttl` created with PX=9000,
  PTTL decreased after ~1.2 seconds, key deleted and absence confirmed.
  No other Redis keys were modified by the probe.
- Restarted **clone-only Redis**; authenticated probe then read the same
  **126/126 expiring Gold keys** and valid session schema; the synthetic
  TTL/cleanup test passed again. All six units remained active for **15
  consecutive health samples** after restart. Wall HTTP again returned 303,
  NRestarts=0, clone network was still `lo` only.
- Limit: this proves snapshot Redis 8 **authenticated readback, TTL behavior
  and restart persistence**; no cross-version Redis downgrade, load-test,
  live distributed cache or 24-hour A/B lease expiry was exercised.

### Cleanup and gate disposition

- Removed both temporary Wall bind overrides from clone, called systemd
  daemon-reload, compared entire four-unit config against original
  `preimage-four-units.tar` with `tar -df`: **PASS identical**.
- Restored clone PG to 039/039, historical foreign M4 claim count 1 (verified).
- Stopped clone; `gold-p2a-runtime-rollback-20261030` is STOPPED,
  with NIC removed and `boot.autostart=false`. The private preimages remain.
- Live Gold UAT unchanged: four units ACTIVE, schema039/39 migrations,
  foreign historical claim count1. Production rc.47 not touched.

**P2-A isolated database + four-unit rollback + Wall loopback + authenticated
Redis TTL/restart rehearsal: PASS.** This is sufficient to **close P2-A
isolated rehearsal**, not to approve live deployment. **P2-B live Gold UAT
migration/deployment, Fleet Wall 5492, signed Windows 10/11 Agent reconnection,
full browser Owner Wall, and any production promotion remain separate gates
requiring fresh preimages and explicit owner approval.**
