# Gold M3 Scoped Sessions — physical UAT cutover acceptance

**Date:** 2026-10-21. **Target:** LXD `light-remote-gold-uat` **only**. **Code SHA:** `bc37e7b71a7856a1763c23b586950046667a8785`. **CI:** Gold Operator [39592149185](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39592149185) all jobs SUCCESS; Windows [39592149251](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39592149251) SUCCESS; macOS x64+ARM64 [39592149248](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39592149248) SUCCESS. Client binaries were NOT installed on user machines.

## Verified guarded UAT transition
1. Immutable source candidate staged `G3_GOLD_CANDIDATE_STAGED=PASS`, `G3_GOLD_PACKAGE_LOCK_PARITY=PASS`, no live service changed at stage.
2. Source+systemd+local-state+PostgreSQL backup under `/var/backups/light-remote-gold-uat/pre-g3-bc37e7b71a7856a1763c23b586950046667a8785/`: archive integrity and pg_restore index **PASS**.
3. Verified 0 queued, 0 in-flight, strict ExecutorReadiness ON, 2/2 fresh+ready leaves. Existing one own Windows session placed in CLOSED state via Gold connector before cutover.
4. Guarded `G3_GOLD_CUTOVER=1` and `G3_GOLD_EXPECT_STRICT=1` passed `G3_GOLD_CUTOVER_NO_ACTIVE_JOBS`, previous override snapshot, `G3_GOLD_CANDIDATE_CUTOVER=PASS`, **10 consecutive samples** `G3_GOLD_STABLE_HEALTH_10_SAMPLES=PASS`. Gold Operator/Plugin/Wall source SHA verified.
5. After cutover, set an isolated **Gold UAT Operator only** systemd drop-in `/etc/systemd/system/light-remote-gold-operator.service.d/96-m3-scoped-sessions.conf` with `OPERATOR_SCOPED_SESSION_LIMITS=1`. Daemon reload/restart, services active, actual unit Environment reports the flag; `M3_GOLD_UAT_SCOPED_SESSION_OPT_IN=PASS`. Source feature flag is OFF in all environments without this drop-in.
6. Executed `selftest-gold-multi-agent-entitlement.mjs` under actual installed immutable source and non-root Gold UAT runtime: Free 2 sessions, Pro 12, legacy node cap 2, Team owner billing identity and 5-Agent target distinct from old 3-worker preview: **5/5 markers PASS**.
7. Real connected `light-remote-gold` MCP Linux session: `light_remote_exec` benign stdout `M3_GOLD_SCOPED_UAT_EXEC_PASS`, `uname -s=Linux`, runtime UID 999, job exit 0. Exact test session closed after test.
8. Final fleet query: strict ON, two leaves fresh/ready, no draining, queued=0, in-flight=0. One owner Windows session may be re-opened by normal helper connection recovery; **this is not an in-flight command**. All five UAT services Operator/Plugin/Wall/PostgreSQL/Redis active.

## Precisely what this proves and does not prove
- **PROVEN:** Gold source+flag scoped Free/Pro account session caps are installed; regressions, CI, real plugin execution, UAT continuity and rollback backup accepted.
- **NOT PROVEN/NOT DONE:** free-person two independently paired session live test, Pro twelve simultaneous retained chat contexts on *one device*, actual Pro 3-Agent executor admission, Team 20-sessions/5-Agent inter-account execution, Team owner tool-call metering, resource locks, unified background `exec(auto)`, job cancel and independent restart-resilient Supervisor. Source still intentionally reuses one session lane per Agent-device; old Windows leaf still advertises `sessionCeiling=2`. There is **no implicit bypass** of that leaf ceiling from higher account quota.
- **Team preview unchanged:** `crossAccountExecutionEnabled=false`; 5 is explicit `agentConcurrencyTarget` only, live `maxWorkers=3` preview remains separate.
- **Do not claim Gold M0–M6 finished**: M1 signed pulse deployed Linux and Agent Windows latest install deferred; M2–M6 are outstanding.

## Rollback boundary

This is Gold LXD only; immutable previous Gold candidate override snapshots and verified source/systemd/PG backups exist at the above path. To disable scoped-session capacity without changing code, remove **only** `96-m3-scoped-sessions.conf`, reload systemd and restart Gold Operator with services restored as needed, preserving unrelated drop-ins and existing strict readiness policy. To roll back code, restore the `90-g3-candidate.conf` overrides from `previous-candidate-overrides` in the cutover backup (NOT the generic original-source rollback script), then guarded service restart and health verification. PostgreSQL dump is kept for emergency schema/data recovery; no DB migration performed in this phase. Never touch production.

See [code implementation checkpoint](./RDC_GOLD_M_PLAN_INITIAL_IMPLEMENTATION_CHECKPOINT_20261021.md) and [full Master Plan](./RDC_GOLD_MULTI_AGENT_JOB_SCHEDULER_MASTER_PLAN_20261021.md).
