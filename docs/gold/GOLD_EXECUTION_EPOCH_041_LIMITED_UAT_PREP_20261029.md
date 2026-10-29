# Gold signed execution epochs / inventory — scoped UAT preparation
2026-10-29. SOURCE and CI gates only. **No authorized live UAT migration, service restart, or feature activation.**

## Owner decisions carried unchanged
P0 PASS. Five-person Pro Team FROZEN. $25 Pro Share design only, not sale or cross-account permission. Free 12h / Pro 48h / VIP 72h connection caps in source; A/B absolute maximum 24h. GC retires stale server jobs after 60m continuously offline, retaining UNKNOWN/no-PID safety fences without signed terminal/zero-dispatch proof. Other-device claim `db964413-f80f-4869-96aa-fa9b56dded09` on `dev_4e2561bf2b05e2c565ef7d5e` MUST NOT be cleaned or moved. Production untouched.

## Current feature implementation scope
- `040_gold_connection_job_gc_fences.sql` immutable, existing SHA `88a970188aeb6e66667d648b85b78a5aadadbab62c90d75902ce0d1583741878`.
- New additive `041_gold_device_execution_epoch.sql`: PG monotonic per-device epoch, signed issuance, one-time effect start, 64x128-page bounded signed inventory metadata; no stdout or filesystem content storage.
- Operator default-OFF `OPERATOR_EXECUTION_EPOCH_ENABLED=1`, exactly selected `OPERATOR_EXECUTION_EPOCH_ONLY_DEVICE_IDS=<synthetic-test-device>`; GC default OFF `OPERATOR_CONNECTION_JOB_GC_ENABLED=1` and mandatory `OPERATOR_CONNECTION_JOB_GC_ONLY_DEVICE_IDS=<same-synthetic-test-device>`.
- Agent matching default-OFF `OPERATOR_AGENT_EXECUTION_EPOCH_REQUIRED=1`. It must receive and fsync a fresh enrolled-server-signed grant, upload enrolled-Agent-signed process inventory; a signed current PG command ticket is required on Poll AND Duplex. Independent signed pre-spawn `execution-start` is checked against PostgreSQL current epoch and only permitted once, and the local Agent persists its own reservation before the OS effect. Replays and stale epochs fail closed. A PG start token issued just before a local crash can leave an UNKNOWN work gap; never infer no-effect from a missing local journal record.
- Inventory is paginated, exact identity-bound, and conservatively `complete:false` for legacy processes. Signed missing/empty inventory is NOT absence attestation. It does NOT auto-open the no-PID fence. Receipt or independently authenticated durable zero-dispatch proof required.

## Already achieved evidence, not equivalent to physical UAT
1. GitHub Actions source gate, Linux PG17 two-Pool race/epoch integration, Windows runner Agent journal test (check newest three-job run before claiming all PASS).
2. Real PostgreSQL reconnect wins -> claim preserved; GC wins -> server job interrupted/UNKNOWN and durable fence retained, reconnect later allowed; no fake terminal receipts.
3. Agent journal fsynced across restart, signed 2-page inventory 151 records and old epoch command rejection; test-only, not an actual running customer Agent with 60m outage.

## Blockers to full physical acceptance
1. A physically deployed matched Operator + native Agent handshake on an isolated **new synthetic** Gold device must demonstrate signed epoch grant, inventory, Poll and Duplex jobs, live OS process identity, restart, late signed terminal receipt, reconnect and GC. CI source/wiring tests alone DO NOT establish physical E2E.
2. Validate scope-specific flags against an old Win10/11 Agent; no global epoch feature on existing devices. Use preflight to prove exact test Device ID. The real Win11 legacy recovery is already complete; do not redo.
3. Fresh pre-change LXD snapshot plus independent `pg_dump -Fc` of `light_remote_gold_dev`, backup SHA, restore rehearsal on *separate database*, and exact four-unit systemd overrides rollback. LXD disk measured ~8 GB available (80% used); check sufficient space and backup destination before proceeding. Do not rely solely on old snapshots.
4. Preflight all existing M3/ledger jobs idle, four service SHA `7f46dea`, schema039, unrelated claim unchanged, no unknown worker already active. Deploy an immutable source candidate that is compatible with schema040/041. The old 7f46dea service rejects schema>039 on restart; rollback must restore matching DB schema and services together.
5. Owner approval required BEFORE any mutation of real Gold UAT. Then apply migration040 and 041 sequentially to Gold UAT with worker **OFF**, verify relation/grant/checksum/service health and existing claims. Only after scope & signed-Agent acceptance enable epoch for selected synthetic device; next run GC 60m scenario scoped to same device, with controlled synthetic claims and audits. No account-wide GC. Stop if any unrelated claim or health differs.
6. No production deployment, release P2, payment or Pro Team feature activation without separate owner approval.

## Suggested scoped acceptance tests
- Poll and Duplex command issued under current epoch runs at most once across simultaneous delivery; stale command and duplicate effect-start denied with durable PG evidence. Agent offline/restart must not resurrect old epoch.
- Reconnect before GC commit blocks deletion; GC before reconnect commits UNKNOWN with fence; multi-Operator/Redis stale state cannot bypass PG fence.
- Exact process terminal receipt clears only corresponding known-PID fence; no-PID device-wide fence remains if no reliable non-dispatch proof; no fake receipt.
- Win10/Win11 old Agent (not in allowlist) continues normal traffic, no unexpected 409; unrelated claim count remains exactly one.
- Snapshot/PG backup and rollback test confirm old 7f46dea+039 can be restored without losing owner data.

**Do not enable the worker merely because source CI is green.**

## New CI gate and rollback warning (2026-10-29)
Commit ae8b1a12dcacf158eb34d3cd00b66f81b085f793; run 40868911042 PASS 3/3. Actual Linux Agent daemon against signed HTTP Poll and isolated PostgreSQL17 passed epoch 1->2 restart, stale replay denial, OS effect marker 12 and durable UNKNOWN; desktop Duplex test still uses a synthetic client. Gold UAT remains schema039, four services healthy, unrelated claim intact, 8GB container disk free. No live migration approval. Before migration040/041, require an independent pg_dump -Fc and restore rehearsal, verified LXD snapshot capacity and matching old runtime 7f46dea + schema039 rollback. Both feature flags OFF until verified new synthetic Agent and exact nonempty device allowlists; never enable account-wide GC. Physical Windows client and 60-minute live GC remain OPEN.

## Latest PostgreSQL boundary evidence (2026-10-29)
Candidate source SHA `6690be367f15dd7a8df65eeeeb52a0a0e0e1a712`. GitHub Actions run `40871754165` succeeded 3/3 (Linux source, PG17, Windows contract). `deploy/scripts/selftest-gold-gc-boundary-pg.mjs` (disposable DB only) uses the actual PG reaper and verifies exactly 3,600,000 ms offline threshold; no GC before it, eligible at it, dryRun leaves data untouched, fresh channel blocks, both known-PID and no-PID UNKNOWN fences survive, queued/not-dispatched work gets no invented process, repeated cleanup adds no duplicate fences/audit, and the unrelated device remains untouched with strict allowlist. Logs confirm `offlineBoundaryMs:3600000` and `unrelatedDeviceUnchanged:true`. All earlier real Linux Agent daemon signed-Poll/reconnect, synthetic DeviceDuplexClient NDJSON and dual-Operator PG races passed in same run. This is time-injected PostgreSQL integration, NOT a literal 60-minute device outage on installed UAT.
Read-only connectivity on existing enrolled Windows Gold machines (no installation or changes): `DESKTOP-VA16D27` Windows 10 Home build 19045; `baolong123` Windows 11 Pro build 26200. Both already used, so NOT dedicated new synthetic test devices; their installed binaries were not upgraded or epoch-enabled. Short-lived read-only sessions closed. Only an explicitly new synthetic device may enter epoch/GC allowlists.
