# Gold G3 — Strict admission preflight audit hardening (2026-10-21)

Branch: `feature/light-remote-gold-rebuild-20261018`. Starting HEAD `2b05f88d561c88a4879b2e2fa24be9fca929bef1`.

## Context

Owner Windows `DESKTOP-VA16D27` already installed CI build #453. Actual physical file/import and daemon verified in [#453 acceptance](./RDC_GOLD_G3_WINDOWS_453_PHYSICAL_ACCEPTANCE_20261021.md); no reinstallation in this checkpoint. Gold UAT immutable installed candidate remains `15eed24fa400feccfb6156df7959c78a8aa437af` (source parity FleetRouter unchanged). Production not touched.

At recheck, Gold PostgreSQL, Redis, Operator, Plugin, Wall = **5/5 active**, Fleet outbound **2 fresh / 2 explicit ExecutorReady=true**, unknown=0, queued=0, inFlight=0, strict admission OFF. Active Gold remote session was 1. Branch/worktree correct; four inherited untracked test paths untouched.

## Bug fixed: read-only audit could declare readiness with false executor

Prior `deploy/scripts/uat-gold-g3-readiness-audit.mjs::evaluateGoldG3Readiness` checked *explicit boolean signal*, not **true on all required leaves**, and had no no-active-work gate. Previous selftest actually asserted SUCCESS for two leaves when one was `executorReady=false` with `dispatchReady=false`. This could have falsely encouraged strict cutover. The audit was **not** itself an enforcement guard; this patch changes preflight evidence and tests, not FleetRouter policy.

Updated evaluation now requires all of the following before returning `SOURCE_AND_FLEET_EVIDENCE_PRESENT`:

1. Exact expected number of outbound leaves (default Gold UAT 2), all with fresh channels.
2. Every outbound executor has explicit `executorReady===true`. Any unknown, unavailable, or stale node blocks.
3. Each true-ready leaf is actually `dispatchReady===true` and not draining.
4. Across all Fleet nodes, **zero** activeSessions / queuedCommands / inFlightCommands.
5. Real installed Operator source SHA parity true; existing unsafe false/stale route admission stays FAIL.

New explicit diagnostic gates `BLOCKED_EXECUTOR_UNAVAILABLE`, `BLOCKED_ROUTE_NOT_ADMISSIBLE`, `BLOCKED_ACTIVE_WORK`; safe source mismatch and routing safety precede readiness outcome. Metrics contain only counters, not account IDs, agent IDs, identities, or keys.

## Tests and actual running UAT evidence

- VPS-ARM source: `node deploy/scripts/selftest-g3-live-readiness-evidence.mjs` 10/10 PASS, including required 2 leaves, stale leaf, false-but-not-dispatchable, draining, active local session, in-flight work, and positive 2/2 zero-work.
- `node deploy/scripts/selftest-g3-strict-executor-admission.mjs`: all 6 markers PASS (source), no extra historical stress suite repeated. `node --check` and `git diff --check` PASS.
- Copied **only the read-only audit script** into `/tmp/uat-gold-g3-readiness-audit.mjs` **inside isolated Gold LXD**, without replacing live Operator, Plugin, or Wall. Compared the real running Operator FleetRouter SHA with the branch SHA, equality TRUE.
- First LXD audit with owner-authorized Gold tool session still open: Fleet 2/2 fresh and proven true; activeSessions=1; **`BLOCKED_ACTIVE_WORK`** as intended.
- Closed only our own Gold Windows session via `Light_Remote_Gold.light_remote_close_session` (not a device disconnect), then reran LXD audit: same source parity and 2/2 readiness, activeSessions=queued=inFlight=0; **`SOURCE_AND_FLEET_EVIDENCE_PRESENT`** PASS. Reconnected Gold Windows through approved helper, ordinary new session, device remained online.
- This is strict-admission **preflight correctness/read-only live evaluation**, NOT enabling strict, NOT a physical Agent TCP reconnect, NOT signed nonce fault proof, and NOT G3 DONE.

## Remaining next ordered steps

1. Signed enrolled Agent ↔ Operator physical transport interruption/reconnect with fresh identity proof, late receipts and no duplicate effect. Session hold/resume already PASS from earlier checkpoint but is not this test. An earlier guarded Operator restart-script authoring attempt was refused before tool dispatch: do not bypass the refusal via PTY/wrapper.
2. Bounded enrolled-Agent soak: latency p50/p95 with N and RSS sampled, source evidence for no replay/no false completion. Prior 5-sample live benchmark request was refused before dispatch; do not invent metrics.
3. After (1),(2) PASS and zero-work preflight, Gold-only independent backup + versioned strict admission opt-in and rollback health gate; verify unknown/false 409 and true dispatch. Keep `OPERATOR_REQUIRE_EXECUTOR_READY=0` until then.
4. Then G3 DONE, only then G4. No production deploy/update, no client reinstall or unauthorized account enrollment.

Files changed: `deploy/scripts/uat-gold-g3-readiness-audit.mjs`, `deploy/scripts/selftest-g3-live-readiness-evidence.mjs`, Current/Gold handoff.
