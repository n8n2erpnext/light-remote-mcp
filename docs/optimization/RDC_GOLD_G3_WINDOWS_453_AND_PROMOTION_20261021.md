# Light Remote Gold G3 — Windows CI #453 staging + versioned Gold UAT promotion
Date: 2026-10-21 (Asia/Ho_Chi_Minh)
Branch: `feature/light-remote-gold-rebuild-20261018`
Scope: Gold-only, NO production mutation.
Previous master handoff: [RDC_GOLD_MASTER_HANDOFF_20261021.md](./RDC_GOLD_MASTER_HANDOFF_20261021.md)

## Summary / precise acceptance labels

**PASS (CI package):** Windows Tray Client run [#453](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39450315433) at `eca1f98e8be492c34da407dc938fd084f6fb2873`, build-install-smoke job success; actual *post-install* log markers `windows-installed-g3-executor-probe=PASS`, `windows-native-installed-selftest=PASS`, independent updater rollback smoke PASS.

**PASS (Windows artifact integrity, not installation):** fetched GitHub Actions artifact `12277742496`, ZIP exactly 328181397 bytes, SHA256 `655bc0e891e5a9b7b435f64bb9f04dc85c47b41719fc81890bf8a9c18a03add0`. Downloaded to owner-authorized test Windows at `%USERPROFILE%\Downloads\LRGold453\light-remote-gold-windows-453.zip`; extracted under `...\LRGold453\unpacked`. SHA256 full Inno Setup `Light-Remote-MCP-Setup-x64.exe` exactly `00f35be3b3463215e10f9783223888f47b73b0536b31577a659d72b0ce687b97` (175137001 bytes), compact Setup SHA256 `ac21b7bdbad968658dbe7c5069e61a52a5a310ff8583ba66a468217cd7ba7ee7` (154195039 bytes), both equal CI log/embedded SHA256SUMS. **Authenticode Status = NotSigned** for both CI installers and existing independent updater. This is an integrity-verified CI UAT build, NOT a publisher-signed production release or signed update manifest. Signature-fixture PASS in CI does not change this fact.

**PASS (local recovery staged):** pre-existing rollback installer copied to `%USERPROFILE%\Downloads\LRGold453\pre-upgrade-recovery` before update; old installed `operator-agent.mjs` also copied there, SHA256 `D0B81354D7ED9FD6F826EA547851BFBBC2804C1A1F9F603F80B3A45998722C5A`. Old rollback installer is ~175133930 bytes and remains separate; no identity key exported or removed. `LightRemoteDeviceAgent` task was Running, `LightRemoteUpdater` Ready at preflight.

**BLOCKED (Windows physical install):** Attempted to register/start an independent Task Scheduler job for the CI #453 full verified installer through *Light_Remote_Gold* on the owner A/B-authorized `DESKTOP-VA16D27`. Remote call was refused **before remote job creation**: `target_node_capability_missing`. No scheduler job was admitted; do not claim installation, successful signed update, or Executor proof. Do not switch to PowerShell/PTY/schtasks/alternate route to evade this denial. Windows still reports legacy `rc.49`, same old SHA, `executor-readiness-probe.mjs` absent (confirmed again after Gold UAT promotion via read-only stat 404). Any later installer action must use legitimately authorized capability / owner-approved local installation, not a workaround.

**PASS (Gold live):** active LXD Gold Operator/Plugin/Wall versioned source promotion from `a74ec1b2203da16ed2469f137684246e35a76ff5` to `15eed24fa400feccfb6156df7959c78a8aa437af`; source parity audit TRUE, 5/5 systemd services active, Unix Fleet IPC HTTP 200, two fresh outbound channels, one true ExecutorReady and one unknown. `OPERATOR_REQUIRE_EXECUTOR_READY=0` compatibility remains OFF for strict; audit gate **BLOCKED_EXECUTOR_EVIDENCE**, **G3 NOT DONE**.

## Code checkpoint and deployment

- Gold branch change: commit **`15eed24fa400feccfb6156df7959c78a8aa437af`** — `deploy/scripts/gold-g3-uat-cutover.sh` now recognizes consistent existing candidate overrides, rejects partial/split/unverified preimages, snapshots them into the protected target backup, and on transaction health failure restores the PREVIOUS candidate (instead of deleting all override files and falling back to the original /opt install). Initial no-override cutovers remain supported. No production script was run.
- Targeted source verification `bash -n`, `git diff --check`, strict/readiness source selftests: PASS, all ten printed G3 markers PASS. These do **not** establish physical Windows parity or live signed E2E.
- Immutable candidate archive from commit `15eed24`, SHA256 `097d3e60fa26ed6d56ea6127f6f04dd5b824c109274c581583fbd2c252783f25`, exact same hash on VPS-ARM and in Gold LXD. Candidate `/opt/light-remote-gold-uat-candidates/15eed24fa400feccfb6156df7959c78a8aa437af` passed source lock/dependency staging without restarting services.
- Verified Gold-only backup `/var/backups/light-remote-gold-uat/pre-g3-15eed24fa400feccfb6156df7959c78a8aa437af`: code, systemd, local state, PostgreSQL custom dump, SHA256SUMS validated. Sensitive backup stays inside isolated LXD, not in Git / public report.
- First cutover returned exit **4** with `G3_GOLD_CUTOVER_PREFLIGHT_DENIED:active_jobs_or_sessions`: existing Gold Windows tool session counted as active even after hold; no mutation. After **closing only this session** by the official Gold session-control tool, all Fleet nodes showed 0 activeSessions / queued / inFlight. No owner work was interrupted.
- Retried guarded `G3_GOLD_CUTOVER=1` with zero-work gate. Exit **0**, markers `G3_GOLD_PREVIOUS_OVERRIDE_SNAPSHOT=PASS`, `G3_GOLD_CANDIDATE_CUTOVER=PASS`, `G3_GOLD_STABLE_HEALTH_10_SAMPLES=PASS`, strict admission OFF.
- Post-cutover process-aware audit: FleetRouter installed/running SHA256 matches source `18511899d209c4adf02acbdc15c4122ac214ff4d9a201a0061806da340714a4a`; `sourceParity=true`, leaves=2, fresh=2, explicitSignals=1, unknownFresh=1, strict=false, no unsafe false-executor admission, no stale routing. Current gate: `BLOCKED_EXECUTOR_EVIDENCE`.
- Gold Windows pairing persisted and recovered through ordinary `Light_Remote_Gold.light_remote_connection_helper({})`, device online, new durable session created after UAT cutover. No new A/B was forged.
- Four inherited untracked paths were NOT added/touched: `deploy/gold-uat/`, `deploy/scripts/check-gold-db.mjs`, `deploy/scripts/uat-gold-account-device.mjs`, `deploy/scripts/uat-gold-http-api.mjs`.

## Next execution order / gates

1. On Windows **only with legitimate owner-approved install authority**, resolve exact missing capability / use authorized local GUI installer; do not bypass remote denial. Ensure no pending work, verify installer SHA again, run complete installer (not module hot-copy), retain recovery copy. Recheck true running Agent and `agent\lib\executor-readiness-probe.mjs` and native Local Wall `executorProbe` fields, actual Agent CLI and daemon, updater state/rollback result. Beware installed version `rc.49` is not a parity check.
2. From official VPS-ARM independent session audit live Gold Fleet **two authenticated fresh outbound leaves with explicit `executorReady=true`** and zero queued/inFlight. Gold Operator presently runs `15eed24`, not old `a74ec1b`. If the Windows probe remains unknown, keep strict OFF.
3. Run real bounded owner-authorized **signed dispatch/reconnect/lost-ACK/late receipt**, no forged account approvals; record command receipt, replay suppression and sample N/p50/p95/RSS; exercise honest unknown outcome for uncertain external effects. Historical in-memory Ed25519 fixtures and 10s daemon tests are not this gate.
4. Only after 2/2 and live fault E2E plus sustained soak, schedule Gold-only `OPERATOR_REQUIRE_EXECUTOR_READY=1` with backup, no active work, operator-only config, stable health/automatic rollback. Verify HTTP 409 for unknown/false, no fabricated completion and return to previous config if unhealthy. Never set flag on production.
5. Record G3 DONE only when all the above are PASS, then G4. G5 SCP percentage request remains future work; do not jump.

## Important rule

CI installer HASHES matching cannot make an unsigned Windows executable Authenticode-signed. Avoid words 'signed installer' unless verified separately. Also distinguish blocked Windows installer execution (capability admission) from failed Inno Setup (installer never launched). For operator-to-operator promotion, only the protected Gold LXD candidate was changed; no `light-remote-direct`, Paddle, billing, production deployment or public download updates.
