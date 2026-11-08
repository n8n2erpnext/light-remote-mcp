# Light Remote Gold — P0 M4 conservative unknown-workspace guard / UAT cutover

## Source and runtime
- Branch `fix/gold-windows-relink-rm-stability-20261028`. Commit `a2f4cd9c20d4d13bbfcbe2549184c832d2871d4c` fixes unsafe overlap inference: `project:unknown` now conflicts with any known project or file-dir scope on the same device. This corrects a fail-open overlap and is deliberately more restrictive.
- Isolated LXD `light-remote-gold-uat`: all four services on exact SHA a2f4cd9 and active/nonzero MainPID after controlled cutover: Operator 1338798; Plugin 1338854; Wall 1338885; Supervisor 1339042.
- PostgreSQL schema 38, all original 3 claims preserved: 2 running, 1 terminal_unknown. No personal queued/running jobs before cutover. No production or installed Windows Agent changes.
- Snapshot `p0-before-uniform-a2f4cd9-20261028`; rollback manifest `/home/ubuntu/handoffs/GOLD_P0_UNIFORM_A2F4CD9_CUTOVER_20261028.txt`. Previous live baseline: all four SHA `4789c8a93f063cc38b9a0433bbee7d5bafb47589`. Result `P0_M4_A2F4CD9_CUTOVER_PASS retained_claims=3`.

## Evidence
- Unit mocks PASS: `selftest-gold-m4-unknown-workspace-conflict.mjs`, `selftest-gold-m4-resource-policy.mjs`, `selftest-gold-m3-shared-tool-admission.mjs`, Durable ACK, Wall render.
- Isolated candidate full-source LXD tests PASS. Live PostgreSQL38 randomized M4 admission + download resource fixture suites PASS, including worker cap, same-project locks, unrelated known scopes in parallel and lease cleanup.
- Actual Win11 historical claim `dev_466415d4e6396a81c1296a4c` is `project:unknown` running. New code returns overlap=true against both `file-dir:c:/windows/temp` and `project:c:/windows/temp`. Separate known `file-dir:c:/windows/temp` vs `project:c:/users/example/build` returns false.
- UAT Local Wall on configured NetBird binding `10.192.135.61:5491` returned HTTP 303 unauthenticated, not a localhost socket. Systemd 4/4 active after cutover.

## Windows release staging, policy boundary
- GitHub Actions `40720721607` for `d5e1ec8` Windows candidate SUCCESS, including Windows native installer and compact installer install/uninstall roundtrip, updater staged helper promotion, invalid update rollback, and graceful Stop with no orphan. Artifact ID `12830567868`, `light-remote-windows-x64-d5e1ec82aa75eeb654033670d7f72fac460a0bc4`; this artifact is an official CI build, **not yet installed on owner Win11/Win10**.
- Read-only Win11 `baolong123` preflight: agent Scheduled Task Running, Updater task Ready/LastTaskResult=0, bundled Node and agent entry present, C: approximately 91.3 GB free. It remains an installed older client.
- Attempted staging a ZIP via one Gold `Invoke-WebRequest` foreground job `1b3ff8bc-8caa-4de8-8b20-2bc371e853d4`. Operator queued it `RESOURCE_LOCKED` as `filesystem:unknown`; it was **cancelled_before_dispatch**, verified=true. No installer was run, no file staged on Windows. The claim persists because owner expressly put historical claim cleanup on HOLD. Do NOT bypass via another tool/desktop/browser or invent terminal evidence to get around the lock.
- To test a future installed Windows build, use owner-approved upgrade workflow only when all relevant claims are legitimately resolved, then verify a real Win11/W10 `force:false` stop and Wall `stopping` visual sequence. CI and isolated source tests are already PASS and do not substitute for installed-agent physical acceptance.

## Owner HOLD directives
- Real Pro Team physical independent OAuth/A-B/multi-device = `HOLD_OWNER_RESOURCES` (not enough devices).
- Historical claim release = `HOLD_EVIDENCE_AND_OWNER_AUTH`: **do not release** 2 running + 1 terminal_unknown without genuine signed terminal or explicit authenticated owner-attested post-claim evidence.
- A/B V2 redesign deferred. Do not ask for another Team device or silently relink Win10. Production unchanged.

## Next P0 independent work
- Additional source/CI regression hardening on Gold UAT independent of Win11 locked filesystem; inspect job/stop/ledger correctness without bypassing resource locks.
- Do not confuse **Git HEAD** after documentation-only commits with deployed runtime SHA a2f4cd9. Treat mismatch deliberately and document it.
