# Gold P2-B — Four-unit candidate staging and schema042 release gates

**Status: SOURCE-ONLY AUDIT COMPLETE; LIVE DEPLOYMENT NOT AUTHORIZED.**
Prepared 2026-10-30 from Gold branch
`feat/gold-connection-gc-reconciler-20261029`, HEAD pre-audit
`37aa3bfdbdbd8a2e0696db9d0642d0c9af3fa211`.
This is a plan/checklist, NOT a cutover script, deployment instruction or owner approval.

## Evidence handed off from P2-A

- PostgreSQL 17 source script `apply-gold-db.mjs` 039→042, idempotent 42/42,
  fail-closed manifest/ledger/constraint checks: isolated rehearsal PASS.
- Exact 4-unit runtime configuration preimage and 042→039 rollback: actual
  isolated LXD rehearsal PASS; historical foreign M4 claim count1 maintained.
- Gold Wall's clone restart cause was EADDRNOTAVAIL on fixed live UAT
  10.192.135.61:5491; clone-only `OPERATOR_AGENT_WALL_HOST=127.0.0.1`
  restored Wall; 15 successive checks PASS, HTTP 303, NRestarts=0.
- Authenticated Redis 8.10.2: 126 Gold keys, all with TTL; session snapshot
  schemaVersion1; clean test key; Redis restart persisted 126 keys;
  6-service systemd health 15 samples PASS. No secrets printed.
- Networkless CoW clone is now STOPPED and never autostarts. Live Gold UAT
  schema039, four services ACTIVE, historical M4 foreign claim1; rc.47
  production not touched.

## Four real live Gold units

1. light-remote-gold-operator
2. light-remote-gold-process-supervisor
3. light-remote-gold-plugin
4. light-remote-gold-wall

Current effective WorkingDirectory for all four is
`/opt/light-remote-gold-uat-candidates/7f46dea1380cfd6a57dcfacf377bdad67cdf2736`.
Restart order must obey Operator→Supervisor→Plugin→Wall, and quiesce
Wall→Plugin→Supervisor→Operator, but order is only one protection;
unknown running OS effects require signed terminal evidence, not a
fabricated ACK or force-kill.

## Existing cutover script inventory — NOT safe to reuse unchanged

| Source | Limitation |
| --- | --- |
| `gold-g3-uat-cutover.sh` | Legacy 3-unit path; now explicitly fail-closed on supervisor presence. |
| `gold-g3-uat-backup.sh` | Systemd archive omits process-supervisor and snapshots neither Redis key behavior nor coordinated schema042 rollback. |
| `gold-g3-uat-rollback.sh` | 3-unit rollback; explicitly does not restore database; must NOT be used for 042→039. |
| `gold-g3-stage-candidate.sh` | Old G3 manifest/package/runtime assumptions; lacks M6 complete tracked-file SHA gate; not yet validated for current UAT. |
| `gold-m6-uat-four-service-cutover.sh` | Real 4-unit handler exists, but pins schema037 and typed 035–037 objects, exactly 2 outbound leaves and strict admission; existing foreign resource claims block gate. No 039→042 database coordination. |
| `apply-gold-db.mjs` | Correct 42-migration independent migrator, not a runtime switcher; must not run as a side effect of boot. |

**Do not bypass these checks** by patching a version string or forcing
the M6 resource-claim gate to zero. Use a dedicated P2-B audited
four-unit/schema042 transaction with explicit operator approval.

## P2-B release contract (pre-execution requirements)

1. **Approval boundary:** owner separately authorizes live Gold UAT staging
   and any schema migration/restart; production rc.47 is excluded.
   Document exact allowlisted Win10/Win11 devices and feature flags OFF.
2. **Synchronized preimage:** freeze writes and new dispatch, prove idle
   via Gold /v1/fleet, the PG job/work tables, OS process supervisor,
   signed inflight/UNKNOWN evidence, and Redis transient leases.
   Keep M4 foreign claim alive; if unproven, **HOLD cutover**.
3. **Fresh recoverability:** new verified custom PG039 dump (SHA256 +
   `pg_restore --list` + isolated restore), Btrfs container snapshot,
   archived *all four* unit fragments/drop-ins, immutable live runtime,
   Redis key/TTL inventory without credentials. Reserve enough space and
   retain an external disaster-recovery copy, not only the same volume.
4. **Candidate supply chain:** exact Gold Git commit SHA and tracked files
   SHA256, package lock/dependency parity, symlink policy review, trusted
   artifact source and unprivileged gold-uat access. Stage side-by-side,
   not atop live source. Never copy secrets into Git or logs.
5. **Schema:** independent PG migrator with 42 locked SQL hashes; prove
   exact current 039 and 0 active effects before 040/041/042 opt-in,
   then 42/42, expected schema objects, grants and M4 claim preserved.
   Migration must be separately authorized and cannot auto-run at boot.
6. **Four-service deployment:** all four unit overrides captured as one
   transaction; no partial sources or stale systemd drop-ins; do not
   reuse G3 three-unit override assumptions. Supervisor is independent,
   so always restart and validate it explicitly.
7. **Validation:** 15 or more stable repeated observations of all four
   services and PG/Redis; Operator IPC fleet contract; Wall HTTP/auth;
   signed Agent reconnect/reboot and Windows 10/11 native activity, TTL
   and audit evidence; source SHA and schema compatibility. 5492/Fleet
   UI, not just 5491, must be explicitly checked if enabled.
8. **Failure rollback:** quiesce external dispatch, take forensic
   post-failure dump, restore *paired* PG039 preimage and original
   four-unit runtime/config together; inspect Redis transient namespace
   and TTL before selective cleanup; never `FLUSHALL` or delete
   global keys. Verify four-unit startup, preimage schema, existing M4
   claim, flags OFF and owner-visible status. Unproven rollback RPO
   or missing signed evidence is a HOLD.
9. **Production:** entirely separate P2-E approval and canary cutover,
   never implied by P2-B.

## Next source-only deliverable

Implement and test a **new fail-closed four-unit/schema042
candidate orchestrator** with preflight mode as default, injectable
fixture paths/commands for isolated LXD validation, no live mutations
without explicit opt-in, and real paired PG restore rollback.
Rehearse the new script on a disposable no-NIC clone and use a controlled
signed Agent canary later; do NOT deploy to live Gold UAT until owner
approves the risk and fresh backups.

## P2-B source-only four-service orchestrator v1 (2026-10-30, follow-up)

New code:
- `lib/gold-p2b-release-gate.mjs`: pure testable 16-condition release gate.
  It insists on 4 real units sharing one immutable runtime source, explicit
  schema039 ledger, no active jobs, no unclassified UNKNOWN work, no
  unproved resource claims, signed fleet/effect quiescence, independent
  confirmed preimages, Redis TTL, feature flags OFF, and device allowlist.
- `deploy/scripts/gold-p2b-four-service-orchestrator.mjs`: default
  `--preflight` is **READ-ONLY**, reports observed PG/systemd/fleet counts,
  and prints status `HOLD` / exit status 4 until every required gate
  is proved. The `--plan` mode renders immutable ordered advance/rollback
  phases; does NOT execute them. All `--apply`, `--migrate` and
  `--rollback` options deliberately return exit 3 before opening any
  database, systemd or network connection.
- `deploy/scripts/selftest-gold-p2b-four-service-orchestrator.mjs`:
  fixture tests cover schema mismatch, missing supervisor, source split,
  active job, unresolved UNKNOWN, foreign claim, backup, signed proofs,
  and explicit denial of all mutation flags. Even an artificially
  fully-green fixture yields `liveMutationAuthorized=false`. It only
  reaches `READINESS_REVIEW_REQUIRED`, not automatic approval.
- GitHub CI source gate now runs the new test and checks orchestrator syntax.

### Real isolated clone preflight (observations, not simulation)

Executed the new CLI as root inside the existing *networkless* LXD clone
`gold-p2a-runtime-rollback-20261030` after proving it has only a root
disk and `boot.autostart=false`. PG query was read-only. Report:
- `operation=READ_ONLY`, `status=HOLD`, `liveMutationAuthorized=false`.
- PostgreSQL schema039 39/39, active jobs0, unknown work **27**, one
  protected historical foreign M4 resource claim.
- Clone hostname intentionally does not match live Gold target;
  the unit observation was taken while clone systemd was starting
  (four units not yet active), and pending fresh preimage/candidate/
  signed-evidence gates were HOLD. None was forged or overridden.
- No NIC (loopback only). After run the clone was STOPPED again.
- Live UAT independently remained schema039, 4/4 units ACTIVE,
  historical claim count1. Production rc.47 untouched.

### Explicit non-goals and future P2-B engineering gate

This is the **read-only orchestrator/preflight/transaction blueprint**, NOT
a working production or live UAT deploy-and-restore tool. Its advance and
rollback phases all carry `action=NOT_IMPLEMENTED`; this is deliberate
to prevent implicit authorization. A next P2-B patch must implement
separately reviewed four-service staging/switch + audited paired
PostgreSQL/Redis rollback, first in an isolated clone, with **new owner
approval** before any live UAT code or schema changes. Do not infer
permission to deploy merely because P2-A rehearsals passed.

## P2-B real clone-only paired failure/rollback rehearsal (2026-10-30)

**A real paired transaction FAIL-INJECTION rehearsal has now PASSED in the
isolated LXD clone. It is NOT a successful new-code UAT candidate cutover.**

New script `deploy/scripts/gold-p2b-clone-transaction.sh` is deliberately
**hard-bound to hostname `gold-p2a-runtime-rollback-20261030` and no NIC
other than `lo`**, no default route, schema039 39/39, no active jobs,
exactly one preserved historical foreign M4 claim and 27 pre-existing
`unknown` work rows. Invalid target or mode fails before writes. Default
`--preflight` is read-only. The only destructive mode
`--rehearse-failure --isolated-only` is restricted to the isolated
clone. The normal live-UAT orchestrator remains read-only and denies
`--apply`, `--migrate` and `--rollback`.

Observed actual sequence:
1. Check locked migration manifest and all 42 SQL SHA256 digests.
2. Stop all four actual systemd units in isolated clone.
3. Take and verify private PostgreSQL 039 custom dump (including grants),
   authenticated Redis 8 RDB preimage, and tar of all four systemd units
   and their complete existing override directories. All SHA256 checks PASS.
4. Apply SQL 040/041/042 with PostgreSQL role
   `SET ROLE lr_gold_migrator` (non-superuser), ledger becomes 042.
5. Inject a real systemd negative `ConditionPathExists` for all four
   units and attempt to start; all four appropriately fail to activate.
6. Execute exit-trap rollback: stop four units, remove injected overrides,
   `dropdb`/`createdb` ONLY within clone and restore the actual
   PostgreSQL 039 preimage, stop Redis and restore saved RDB, restart
   Redis, verify schema039/39, historical M4 claim1, UNKNOWN27 and absence
   of epoch041 table. Temporarily change Wall bind to 127.0.0.1 on
   clone only (original UAT IP is absent), then verify all four units,
   PostgreSQL and Redis in 12 consecutive checks with HTTP 303. Stop
   units again, remove loopback override and compare all unit files
   byte-for-byte with original tar. No injected override remains.
7. Deliberately exit code **42** means `bad candidate detected and
   complete coordinated rollback SUCCESS`; exit5 means incomplete
   rollback requiring clone forensic inspection.

During engineering, earlier attempts reproduced a strict rollback false
failure due piping dump through `cat | pg_restore` with `pipefail`.
It was corrected to direct `pg_restore < preimage039.dump`, and
readiness is now bounded (up to 25 seconds) before the 12-sample stable
health window. Final isolated trial returned exit42 and all PASS receipts.
The earlier failed trials must not be misrepresented as successful.

Independent postcheck after successful rollback:
- Redis 8.10.2 authenticated readback **126 Gold keys, 126 with TTL**,
  valid `runtime:sessions` snapshot schemaVersion1, clean synthetic key.
- Clone PG schema039 39/39, M4 claim1, 27 UNKNOWN, epoch041 absent.
- All four original unit configs restored, no leftover P2-B drop-ins.
- Clone STOPPED after test, root disk only/no NIC/autostart disabled.
- Live Gold UAT unchanged: schema039, claim1, all 4 services ACTIVE.
  Production rc.47 untouched.

`deploy/scripts/selftest-gold-p2b-clone-transaction.mjs` is source
static safety regression in GitHub CI; it does not recreate LXD
end-to-end physical tests in GitHub Actions. Full runtime logs and private
backup artifacts remain inside clone, not committed or exposed.

**Remaining P2-B gates:** actual immutable candidate staging/rehearsal
success path (not just induced failure/rollback), exact signed OS effect
quiescence for foreign M4 claim and 27 UNKNOWN work rows, Fleet Wall 5492,
signed native Windows 10/11 canary, and separately owner-approved LIVE
Gold UAT migration/cutover after fresh backups. Do not promote to
production or pretend the isolated exercise resolves those gates.

## P2-B physically isolated success-path receipt (2026-10-30)

**New result: TRUE source-content-addressed candidate cutover SUCCESS on a
no-NIC LXD clone**, including immediate coordinated rollback to the
preserved preimage. This augments, but does not supersede, the earlier
induced-failure rollback PASS.

- An independent stopped-clone Btrfs preimage was captured:
  `gold-p2a-runtime-rollback-20261030/gold-p2b-before-success-20261030`.
  The host built `git archive` from Git HEAD
  `48cc61c323d050b20cf2535500b39393ac064f73` (not the
  uncommitted rehearsal harness files). Archive SHA256:
  `d56f5d90cb4425d4ff00ea1ac3ef1b2cfeb76509653e76dcccdc2bd2e4b9e371`.
- Archived 1,170 tracked source files were extracted to a private clone
  staging dir. A SHA256 manifest covering those tracked files was checked.
  Package lock digest `b32e919535512c6bd4585913314ce6f0c49f7e9a46f8904cf14da4e073371c2b`
  matched the clone's existing runtime. Existing installed dependency and
  secret references were symlinked, *only inside the clone*; nothing
  downloaded, published or copied into Git. Candidate moved to
  `/opt/light-remote-gold-uat-candidates/48cc61c323d050b20cf2535500b39393ac064f73`.
  Four Node entrypoints passed syntax check as `gold-uat`.
- The hardened CLONE-ONLY runner now accepts
  `--rehearse-success --isolated-only`, in addition to
  `--rehearse-failure --isolated-only`; both modes require
  clone hostname, loopback-only interfaces, no default route, schema039
  exact preimage, no queued/running jobs, historical foreign M4 claim1,
  27 UNKNOWN work rows, full 42 migration SQL digests. No mode in this
  script can run on the Gold UAT hostname. Normal live orchestrator
  still refuses `--apply`, `--migrate`, `--rollback`.
- To defeat historical deeply z-prefixed systemd overrides, the clone
  runner selected a strictly higher lexicographic drop-in filename and
  verified **effective WorkingDirectory + ExecStart for all four units**
  against the exact candidate SHA before start.
- Actual test applied SQL 040–042 to cloned PostgreSQL, switched all four
  services (Operator, Supervisor, Plugin, Wall) to new SHA, bound Wall to
  127.0.0.1 on clone (no real NIC), established readiness and sustained
  **15 consecutive samples of all 4 units + PostgreSQL + Redis** with
  Wall HTTP 303. Explicit success receipts:
  `P2B_REAL_IMMUTABLE_FOUR_SERVICE_SCHEMA042_CANDIDATE=PASS`,
  `P2B_SUCCESS_CANDIDATE_15_SAMPLES_HTTP303=PASS`.
- Job `45962b8f-fac1-4a8d-bd8e-f1e63971d7fd` exited **43 deliberately**,
  triggering the same paired recovery: four-unit config, PostgreSQL039
  private dump, authenticated Redis RDB; original runtime was restarted
  and healthy for another 12 samples, then services were stopped and
  temporary loopback drop-in removed to leave the networkless clone
  safe. Every rollback diagnostic BROKEN=0.
- Independent postcheck: clone PG039/39, historical claim1, Redis
  **126/126 Gold keys expiring** and valid session snapshot; no leftover
  P2-B overrides, only lo. Live Gold UAT was independently schema039,
  historical claim1; no live service was switched.

The source-code candidate was content-addressed/manifest-verified; it
was **not** a new signed binary installer and does not prove a live
Windows native Agent or Fleet Wall 5492. The Gold branch's new test and
runbook modifications were **not yet committed/pushed at this
checkpoint**; do not infer CI success for them from earlier runs.

Remaining separate live release gates: signed quiescence of unknown jobs
and foreign M4 effect, explicit owner approval, fresh point-in-time
cross-service backup and restoration, controlled native Windows 10/11
canary and operator browser, Fleet Wall 5492, and independent production
approval. No 039→042 live UAT migration is authorized by this rehearsal.
