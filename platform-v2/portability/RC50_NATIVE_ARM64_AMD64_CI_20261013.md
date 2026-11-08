# rc50 P0-D — Native ARM64 + AMD64 compatibility CI, not a data migration

**Date:** 2026-10-13. **Branch:** feature/rc50-mjs-scale-20261011, based on 4f547a8e17300a863f6b64be7e34af2f5ad45c08. **Execution:** isolated VPS-ARM source changes plus GitHub-hosted CI runners. No production deployments or customer-state backup/restore.

## Why this matters
P0-D needs full independently verified migration from Linux ARM64 VPS to Linux AMD64 VPS. The current official Light Remote pairing lists only VPS-ARM and Windows x64, **not VPS-AMD**, so no actual AMD Linux host or data migration has been exercised. Prior `sealed_synthetic_backup.py` and `rehearse_cold_move_uat.py` actions are recorded as blocked. Do not reimplement equivalent backup/export via another tool to circumvent those blocks.

However, product runtime architecture parity is a genuine independent P0-D prerequisite. Public GitHub Actions runners support `ubuntu-24.04` (x64/AMD64) and `ubuntu-24.04-arm` (native ARM64), without QEMU or unpaired customer devices. This checkpoint adds a **native CPU matrix** alongside the already passing x64 isolated private DB workflow.

## Actual changes
1. `.github/workflows/rc50-mjs-scale.yml`: new `native-runtime-parity` job with `fail-fast:false` and two native GitHub runners:
   - `ubuntu-24.04` expected `process.arch=x64`;
   - `ubuntu-24.04-arm` expected `process.arch=arm64`.
   Both check out the **same feature commit**, install reproducible locked Node 22 deps, check actual Operator/Plugin/freeze module syntax, execute ALL `platform-v2/test/*.test.mjs` regression tests, writer gap audits and honest NOT_READY P0 report. Runner architecture assertion fails if the job is on the wrong architecture.
2. On ARM64 specifically, the new job additionally provisions disposable randomly generated private PostgreSQL/Redis secrets, starts the existing private `platform-v2/compose.yml` (PostgreSQL17/Redis8, no published host ports), runs `platform-v2/scripts/check.sh` schema+rollback checks on **native ARM64 containers**, then `docker compose down -v --remove-orphans` with `if:always()`. This is **database schema compatibility**, not live customer data restore.
3. `platform-v2/test/test_p0_release_gate.py` checks that the native matrix and ARM64 rollback & scoped cleanup cannot be silently omitted. The first GitHub native ARM64 run #33 revealed the existing `check.sh` and concurrency fixtures **hardcode Compose project `lightremote-rc50-v2`**, while the new ARM job incorrectly started `lr-rc50-native-arm64`: PostgreSQL was healthy but the checker looked up the wrong container. Corrected ARM job to the canonical `lightremote-rc50-v2` project (safe because each GitHub runner is a separate VM). First run #33 x64 Node PASS, ARM64 Node PASS, ARM64 PostgreSQL failed due to this project-name mismatch; rerun on next commit is required before ARM64 schema compatibility can be declared PASS. The existing release gate remains **NOT_READY / --require-ready exits 3**; architectural parity alone can never graduate full P0-D.
4. Fix a local freeze restart loophole in `lib/local-ingress-freeze.mjs`, `operator-host/executor.mjs` and `plugin-server/server.mjs`: if `LR_RC50_*_FREEZE_MARKER_PATH` remains configured but `LR_RC50_DEV_LOCAL_FREEZE` accidentally resets to 0, **existing marker is still checked and refuses startup**. No feature requires marker path on current production (default no opt-in). Regression test added to `platform-v2/test/local-freeze-restart.test.mjs`.

## Exact scope boundary
- GitHub-hosted Linux AMD64 runner is a genuinely separate x64 VM, but **NOT the customer's VPS-AMD**. It tests Node runtime/dependency/test portability only.
- PostgreSQL/Redis schema and rollback on ARM64 runs against disposable **new** tables, NOT restored real Postgres/Redis/JSON/identity state from VPS-ARM. No source freeze/old writer removal/Agent reconnection or billing ledger cutover.
- Build distribution binaries, signed native client artifacts and real x64/arm64 release packages are separate E gates, not covered.
- Local freeze marker does not survive loss of *both* opt-in marker path and on-disk location configuration, or a write fault before initial marker fsync; global DB writer epoch remains NOT_READY.
- Neither of the two safety-blocked registry writes, the earlier blocked persistent verifier runner, or blocked PG runtime writer adapter was attempted by a workaround.
- No production services restarted, production state inspected/copied, Git main merge, Paddle Live / ERPNext mutations or actual Agent commands. **Five P0 exit gates remain not ready.**

## Commands used on VPS-ARM
```sh
python3 -B platform-v2/test/test_p0_release_gate.py         # 7/7 PASS
node --test platform-v2/test/local-freeze-restart.test.mjs  # 8/8 PASS
node --test platform-v2/test/*.test.mjs                     # 51/51 PASS
node --check operator-host/executor.mjs
node --check plugin-server/server.mjs
git diff --check
```
GitHub Actions native arm64 and x64 results MUST be read from the actual run on the newly pushed SHA after commit; do not assume from local PASS. Prior #32 completed SUCCESS for SHA 4f547a8 (single x64 job).

## Next real P0-D prerequisite
With explicit authorized pairing of VPS-AMD, freeze both independently owned nonproduction services with an authoritative writer epoch and stage a reversible, **authorized** representative fake-state transfer. Compare account/device identity, revocation, usage, billing/outbox, OAuth consumed hash, PG/Redis/JSON planes and old-writer cutoff on the AMD host, followed by guarded rollback. Do not claim ARM→AMD restored until that **different-host** acceptance truly passes.
