# Light Remote Gold P0 — owner HOLD decisions and independent gates (2026-10-28)

## Owner decision — do not re-open without new resources/evidence

| Gate | Recorded status | Reason and restart trigger |
| --- | --- | --- |
| Real Pro Team independent OAuth accounts, A/B-authorized Agents, multi-device execution | **HOLD_OWNER_RESOURCES** | Owner lacks enough devices for an authentic real Team acceptance. Resume only when the owner explicitly has required authorized devices/accounts and approves it. Existing PostgreSQL synthetic Team 3+1 fixture PASS is separate and must not be promoted to real Pro Team PASS. |
| Historical Gold resource claims / M6 owner orphan recovery | **HOLD_EVIDENCE_AND_OWNER_AUTH** | Three durable claims must remain locked until valid signed terminal/process evidence or explicit authenticated owner approval and genuine post-claim reboot/reinstall proof. Do not delete/update SQL or fabricate ACK. |
| A/B V2 redesign | **DEFERRED** | Owner chose to finish existing Gold P0 before redesign. |

Continue other P0 work without requesting more devices or repeatedly asking for A/B pairings.

## M5 isolated Linux Gold UAT process supervisor regression PASS

Executed within isolated `light-remote-gold-uat` LXD against source-only candidate `2e183c97aee6be45d46cc11371cc5b6e51d915da`, no live service restart:

- `selftest-gold-m5-process-supervisor-agent-restart.mjs`: independent Agent reconnect survives, private socket/token and owner boundary, real OS stop/terminal.
- `selftest-gold-m5-supervisor-restart-journal.mjs`: after supervisor crash, original process reported `unknown` rather than false running; idempotent operation has no duplicate side effect; journal retains terminal receipts; journal does not store script.
- `selftest-gold-m5-owner-process-wall.mjs`: Wall auth + CSRF and exact process ownership; local stop produces terminal state.
- `selftest-gold-m6-process-stop.mjs`: original Agent-bound process Stop; no fake terminal/release, scoped PG claim and repeat denial.
- `selftest-g2-process-stop-escalation.mjs`: SIGTERM ignored, bounded SIGKILL escalation and terminal record.

All 5 suites PASS; all four Gold UAT services remained active.

## M2 Windows 10/11 physical controlled background jobs PASS

- Windows 10 `DESKTOP-VA16D27`, official A/B session `s_mvron2af_08f280612b467d25`: background exec `a4089676-a115-464e-82f9-cdfef745366f` launched owned process `lp_T12LxxJ87v3j30SAo9RDHqTQ`, stdout STARTED only. While process running, short foreground job `95c6590b-806a-4221-90db-10394ddb1149` returned `P0_M2_CONTROL_LANE_PARALLEL_OK`. Owner-scoped Stop `force:false` reached terminal `stopped`, no FINISHED marker.
- Windows 11 `baolong123`, official A/B session `s_mvrqy8fc_04db7baddf313727`: background exec `326206d0-75ec-4bf0-86e7-fb0cf7c53995`, owned process `lp_QNm5drW4aUjkv-AtSKByRnQJ`, stdout STARTED only. Short foreground `853cf3a3-161e-4b29-a24d-238f27470bf0` returned `P0_M2_WIN11_PARALLEL_READ_OK` while the background process was running. Scoped Stop reached terminal `stopped`, no FINISHED marker.
- Both managed processes were cleaned up. No extra PG claim was created; Gold UAT resource claims remained `running:2`, `terminal_unknown:1`, no active personal queued/running job.

## M5 Windows graceful semantics — open correctness gap

- On both Windows, `light_remote_stop_process(force:false)` returned `stopForce:true`, `treeStopMethod:taskkill-tree` because `NativeProcessRegistry._signal` uses `taskkill.exe /PID <owned> /T /F` even when signal request is SIGTERM.
- This is an actual forced OS tree termination, **not** proof of graceful Stop. The returned metadata is truthful about force. Do not label Windows graceful behavior PASS.
- Investigate safe Windows graceful mechanism with bounded fallback **without orphaning child processes**, independently of passed M2 termination and source/fixture M5 tests; do not silently change installed Windows client or production.

## Release boundaries

- Live Gold UAT four service SHA remains `c0c6977eb9c940c7af67f1d9887bf3f02de7d78b`, PostgreSQL 38; source branch HEAD at the time of this checkpoint `2e183c97aee6be45d46cc11371cc5b6e51d915da` before this documentation commit.
- No production changes, no Windows reinstall, no owner orphan intervention. M2 Win10/11 PASS is a bounded physical check and does not prove macOS/Linux multi-agent/team physical gates.
