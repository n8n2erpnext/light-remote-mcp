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
