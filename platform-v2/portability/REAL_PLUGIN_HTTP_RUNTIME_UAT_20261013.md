# rc50 — Real Plugin Express/MCP HTTP runtime + isolated freeze/restart acceptance

**Date:** 2026-10-13, Asia/Ho_Chi_Minh.
**Worktree:** `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform`
**Branch:** `feature/rc50-mjs-scale-20261011`
**Base SHA:** `a25245d87038dcdacb48b07850a584bc8dc00019`
**Environment:** authorized VPS-ARM dev source and disposable local fake state; GitHub Actions native ARM64/x64 jobs will verify this SHA after push. **No production Operator/Plugin processes, real owner identity, device sessions, Paddle/ERPNext transactions or remote Agent operations.**

## Why

The rc50 code already had a source-only Plugin local freeze middleware integrated before Express routes, plus unit tests. The previous checkpoint added an actual Operator child-process Unix-domain HTTP startup/freeze/restart smoke, but **Plugin Express runtime startup had never been exercised similarly**, leaving risk of unresolved SDK dependencies, host-header validation differences, background support jobs, real HTTP routing and accidental state writes during a freeze.

## New real runtime integration test

`platform-v2/test/plugin-runtime-smoke.test.mjs` **spawns the actual** `plugin-server/server.mjs` executable as a child Node process, not a fake Express server.

- Reserves an unused **loopback-only `127.0.0.1` port** and runs with `LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK=1` ONLY in the disposable test child. It never contacts the production hostname.
- Child `env` is an explicit **allowlist** with a newly generated random fake OAuth secret, `NODE_ENV=test`, isolated `HOME`, unused fake Operator socket, and all relevant OAuth/Google/Paddle/support/outbox/announcement/account-recovery/mail/distribution state paths redirected into a newly created disposable private directory. Paddle checkout disabled, NO real Paddle keys or tokens inherited from the parent. No outbound API action is performed.
- `LR_RC50_DEV_LOCAL_FREEZE=1` is explicitly set with an absolute, protected per-service marker path.
- Check actual `GET /healthz` returns status 200, `localFreeze.phase='open'`, and actual `GET /support` is 200 BEFORE freeze.
- Send SIGUSR2 **only to the disposable child PID**. The real Plugin writes its fsynced marker and health shows `localFreeze.phase='frozen'`, `markerDurable=true`, `inflight=0`.
- A fresh `POST /billing/paddle/webhook` and `GET /support` during freeze both get HTTP 503. The webhook is rejected **before** Paddle route execution and carries no real payment data; `GET /healthz` stays 200.
- SIGTERM gracefully shuts down the disposable child (exit 0). A **new Plugin child** with the same marker fails startup with `LOCAL_FREEZE_MARKER_PRESENT_STARTUP_REFUSED`; another child with opt-in toggled OFF but same marker path also fails startup.
- Marker retains file mode `0600`; all child processes and test-owned files are cleaned in a `finally` block.

This proves real local Plugin Express ingress behavior, **not** an authenticated OAuth or Paddle live E2E, global durable writer epoch, Agent-side command fence or cross-host cutover.

## CI: critical separate Plugin dependencies

The root `package.json` does not include `express`, `@modelcontextprotocol/sdk`, `jose` and `zod` runtime dependencies of the independently managed Plugin facade. `plugin-server/package.json` and `plugin-server/package-lock.json` form a separate locked dependency tree; root-only `npm ci` in CI cannot reliably start the actual Plugin.

In `.github/workflows/rc50-mjs-scale.yml`, added a separate
`npm ci --prefix plugin-server --ignore-scripts --no-audit --no-fund`
step **before the existing full Node regression suite** in BOTH `isolated-data-contract` and `native-runtime-parity` jobs. The latter executes on native `ubuntu-24.04` x64 and `ubuntu-24.04-arm` ARM64; the new `*.test.mjs` is automatically included. Existing private PostgreSQL17/Redis8 migrations, rollback and cleanup remain as before.

`platform-v2/test/test_p0_release_gate.py` has a negative guard requiring both CI install steps and the true Plugin smoke test's main freeze assertions, so removal of plugin runtime coverage is detected.

## Test evidence from VPS-ARM (prepush)

```sh
npm ci --prefix plugin-server --ignore-scripts --no-audit --no-fund  # PASS
node --test platform-v2/test/plugin-runtime-smoke.test.mjs             # 1/1 PASS
node --test platform-v2/test/*.test.mjs                                # 53/53 PASS
python3 -B platform-v2/test/test_p0_release_gate.py                   # 8/8 PASS
python3 -B platform-v2/portability/audit_writer_freeze_readiness.py  # NOT_READY, 16/18 fsync, no global writer
python3 -c 'import yaml; ...'                                         # CI workflow YAML native matrix, Plugin locked npm install PASS
git diff --check                                                     # PASS
```

## Prior HOMELAB UAT remains valid, but separate

The source-only Git snapshot `ccc8059` was independently transferred and SHA256 verified on HOMELAB AMD64, where the private fresh PostgreSQL17/Redis8 schema/rollback test completed `RC50_V2_PLATFORM_UAT_PASS` and 51/51 Node tests passed. HOMELAB source snapshot is still `ccc8059` unless a separate transfer is performed; this new Plugin integration test is on the feature Git branch, not yet applied to that stale snapshot. CI ARM64+x64 now covers it natively.

## Remaining five release P0 blockers

- **A:** no shared source-authoritative monotonic writer epoch/fence across real Operator/Plugin/Fleet/PTY/Agent; previously attempted PG runtime adapter creation was tool-blocked and never bypassed.
- **B:** real owner-approved A/B Local Wall to independently authenticated verifier and Agent grant not confirmed end-to-end.
- **C:** 16/18 JSON file writers with fsync; two specific registry source writes previously tool-blocked; no consistent multi-file global snapshot/audit watermark or full Agent effect drain.
- **D:** source transfer + independent fresh DB tests and native CI parity do NOT constitute actual full PostgreSQL/Redis/JSON/identity state restore with exactly-one-writer and rollback.
- **E:** this adds necessary true Plugin startup runtime coverage, but full production-equivalent E2E, signed releases and cutover/rollback acceptance remain unproven. **Release gate must continue returning NOT_READY.**

Keep Node22 ESM `.mjs`, Express 5, strict feature branch isolation, no main merge or production rollout until all five gates independently pass.
