# rc50 P0-E — Product-source CI coverage and explicit fail-closed release guard

**Date:** 2026-10-13 Asia/Ho_Chi_Minh. **Scope:** isolated feature branch source changes; no production deployment, live device operation, PostgreSQL migration or customer data access.
**Prior branch HEAD:** `358fd87fc75916665391cf42d8b29f695441d6d2`.
**Problem found:** `.github/workflows/rc50-mjs-scale.yml` was triggered only by `platform-v2/**`. Recent P0 runtime fixes in `operator-host/**`, `plugin-server/**` and `lib/**` could therefore be pushed **without this CI workflow running**. The old CI ran a small `storage.test.mjs` smoke before the isolated PG schema suite, not the source-focused Operator/Plugin regression and writer inventory guards.

## Changed real CI gate

`.github/workflows/rc50-mjs-scale.yml` now:
1. Watches `platform-v2/**`, `operator-host/**`, `plugin-server/**`, `lib/**`, `package.json`, `package-lock.json` and the workflow itself on feature-branch push and PR.
2. Uses Node 22, installs exact locked dependencies with `npm ci --ignore-scripts --no-audit --no-fund`, then runs **all** `platform-v2/test/*.test.mjs` Node regressions, which include real Operator/Plugin local ingress freeze and registry durability integration tests.
3. Runs the real writer source audit plus its negative guard tests, and the release gate's negative tests. An underlying source regression fails CI; an honest `NOT_READY` inventory does **not** fail the ordinary feature-branch development job.
4. Generates a machine-readable P0 report from `python3 -B platform-v2/scripts/p0-release-gate.py --report`. It reports **five known P0 gates not ready**, including current 16/18 file/dir fsync inventory, global writer authority missing and unproven cross-host and owner/Agent authority. It does not accept a user-provided READY flag, synthetic signature tests or a mere branch name as release proof.
5. Adds manual `workflow_dispatch` input `require_ready` (true by default). That manual **release request** invokes `--require-ready` which exits 3 and fails closed until a future, independently audited signoff implementation verifies all five gates. This safeguard intentionally rejects premature rc50 release, **not** development CI.
6. Keeps the original private PostgreSQL+Redis Compose fixture migration + rollback tests and always-cleanup step. No new live DB dependencies or secrets are introduced.

## Tests actually executed on VPS-ARM

```sh
python3 -B platform-v2/test/test_p0_release_gate.py
# 6/6 PASS — report parsing, five categories, explicit release denied,
# no false writer authority from 16/18 fsync, workflow source triggers,
# dev vs manual release workflow separation, unknown flag rejected.

python3 -B platform-v2/scripts/p0-release-gate.py --report
# exit 0, NOT_READY, 0/5 P0 exit gates fulfilled, fsync_proven=16/18

python3 -B platform-v2/scripts/p0-release-gate.py --require-ready
# INTENTIONALLY nonzero (exit code 3), NOT_READY

node --test platform-v2/test/*.test.mjs
# 43/43 PASS

python3 -B platform-v2/test/test_writer_freeze_readiness.py
# 11/11 PASS

git diff --check
# PASS
```

**CI execution caveat:** local source validation is **not** a GitHub Actions green run. After push, observe real Actions result separately; CI docker migration step and remote runner behavior cannot be called PASS from local tests. If a CI run fails, report the failed job/step instead of inferring a release.

## Blocker: PG runtime writer fence

A direct source write for a PostgreSQL-backed runtime writer fence adapter was blocked by safety checking in this continuation. No replacement was written by another tool, shell, PTY, split edit or indirect route. A trial `npm install pg@8.23.1` had modified `package.json` and `package-lock.json` before the adapter denial; **both files were restored to Git HEAD**, leaving no unused dependency staged. Thus **no actual PostgreSQL authenticated writer fence was wired** and P0-A remains NOT_READY.

All old safety-blocked `operator-host/account-registry.mjs`, `operator-host/device-connection-registry.mjs` and persistent HTTP verifier Docker integration work remains unchanged and was not rerouted.

## P0-E acceptance still pending

Passing broader source CI is necessary but NOT sufficient. Actual cross-service integration across legitimate OAuth/owner A/B/Agent authorizations, native PTY/RM/SCP and signed update releases, billing/ERPNext idempotency, snapshot/restore rollback, and GitHub Actions on exact target SHA remain unverified. **Do not merge main, release rc50, signal production or migrate customers based on these tests.** Keep Node ESM `.mjs`, Express 5 and feature-branch-only behavior.
