# rc50 P0-C — Durable local freeze marker / restart-denied gate

**Date:** 2026-10-13 Asia/Ho_Chi_Minh. **Branch:** `feature/rc50-mjs-scale-20261011`. **Base:** `f283878fa6df38e68827db4f9ba64f3b3b77ff09`.
**Environment:** VPS-ARM feature worktree, disposable OS tempdirs and fresh fake Node child processes. **No production Operator or Plugin service restarted, signaled, or configured.**

## Why

The prior local Operator/Plugin `SIGUSR2` ingress freeze was **in-memory only**. A supervising process that restarted its service would silently re-open mutation ingress, although the previous process had been frozen. The freeze could therefore not be used in a restart/restore cutover. This checkpoint makes a **specific local opt-in freeze intent** durable on the same host, so automatic restart of a locally frozen process **refuses to start** while its freeze marker is present. This is an improvement to P0-C, **not** a global, multi-host writer lease/epoch or Agent-side authority fence.

## Production-path code on isolated rc50 branch

- `lib/local-ingress-freeze.mjs`: optional `markerPath`, `service` ('operator' or 'plugin') and `persistMarker`. Only dev opt-in code paths supply these. It first validates an absolute marker pathname and restricted parent directory. On startup, securely opens a pre-existing marker with `O_NOFOLLOW`, requires a regular single-linked 0600 file with exactly `{schemaVersion:1,service,phase:'freeze_requested'}`, and **throws a fatal startup refusal**. Invalid, unreadable, unexpected or symlinked markers also refuse startup; only an absent marker may start open.
- A first `freeze()` immediately enters `freezing` and atomically writes the marker through the **existing, fsync-tested** `durableAtomicWriteSync` module (random O_EXCL temporary file → complete write → file fsync → rename → directory fsync), BEFORE `frozen` can be acknowledged. If that write throws (e.g. simulated ENOSPC), the in-memory gate remains **freezing**, rejects new HTTP/background work and never reports drained; no successful on-disk marker is claimed.
- The marker encodes local service and `freeze_requested` intent, **not** a durable global transaction sequence, lease holder, approval, Agent completion receipt or snapshot watermark. `snapshot().markerDurable` distinguishes a persisted marker from memory-only test gates.
- `operator-host/executor.mjs`: in explicit `LR_RC50_DEV_LOCAL_FREEZE=1` mode, requires `LR_RC50_OPERATOR_FREEZE_MARKER_PATH`, passes service 'operator'; signal handler logs marker errors and retains local freeze admission denial rather than crashing with an unhandled rejection.
- `plugin-server/server.mjs`: parallel explicit `LR_RC50_PLUGIN_FREEZE_MARKER_PATH`, service 'plugin'; separate per-service marker is required.
- This leaves the original local HTTP, Operator unfinished-jobs and Plugin support pump counting intact. NO direct SQL/Agent/owner authority is created.

## Test evidence — true separate Node process restart

```sh
node --test platform-v2/test/local-freeze-restart.test.mjs
# 7/7 PASS
# 01 frozen marker is durable 0600 and a FRESH Node process refuses startup
# 02 malformed/wrong-service marker refuses startup
# 03 symlink marker refused, target unchanged
# 04 missing/insecure marker directory refused
# 05 simulated disk failure stays freezing without false ACK
# 06 Operator and Plugin markers are independent, NOT a global fence
# 07 exact real dev source env wiring and error guard

node --test platform-v2/test/*.test.mjs
# 50/50 PASS including previous 9 local HTTP/job drain tests
node --check lib/local-ingress-freeze.mjs
node --check operator-host/executor.mjs
node --check plugin-server/server.mjs
git diff --check
# PASS
```

No deployed process or real credentials. All temp marker files and child processes are created only in disposable test directories.

## Important fail-closed limits and explicit caveats

1. **If writing the freeze marker itself fails and the process subsequently crashes before a durable marker exists, restart could reopen ingress.** This is explicitly exercised in test 05. Only a separately authenticated durable global writer authority and startup check can solve this fully. Do NOT treat this marker as an assured host-cutover freeze.
2. The marker is local to a process/host. The other service and other hosts are unaffected unless separately signaled. Remote Agent OS effects may continue after Operator job completion. A malicious same-UID actor or an administrator can delete/rollback local state; this local marker does not cryptographically prevent that.
3. A marker is **not cleared automatically**: deletion is an external owner-reconciliation action ONLY after a global epoch/cutover audit. Never remove marker in an automated retry or updater; reopening without writer ownership is unsafe.
4. When the marker exists the service refuses bootstrap rather than exposing /healthz. Monitor the supervising service/process startup failure. This is deliberate to avoid startup-time registry mutations occurring before HTTP middleware runs.
5. Pre-existing runtime default still has the feature **disabled**; production is unchanged. If enabled on a future dev process, require separate protected marker directories and paths, and test on that isolated environment first.
6. The remaining source inventory is still 16/18 fsync-proven; `account-registry.mjs` and `device-connection-registry.mjs` were tool-blocked and were not touched. Multi-file durable checkpoint, complete fleet/Agent drain, real owner identity, ARM→AMD cross-host restore and global writer epoch remain **NOT_READY**.

## GitHub CI evidence (prior source SHA)

The prior commit `f283878fa6df38e68827db4f9ba64f3b3b77ff09` had real GitHub Actions run [#31](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/38397103944) with `isolated-data-contract` completed **SUCCESS**, including Node/source tests, PostgreSQL schema+rollback, cleanup. This does **not** attest to this marker checkpoint until its own workflow succeeds. VPS-AMD is **not** in the list of currently paired Light Remote devices (only VPS-ARM and Windows x64), so real ARM→AMD restore was not attempted/claimed.

**Status:** P0-C PARTIAL; P0-A/B/D/E all remain NOT_READY. Follow [RC50_P0_CLOSEOUT_GATES_20261013.md](./RC50_P0_CLOSEOUT_GATES_20261013.md); no synthetic shortcut to READY.
