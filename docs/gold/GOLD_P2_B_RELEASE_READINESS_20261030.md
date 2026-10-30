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
