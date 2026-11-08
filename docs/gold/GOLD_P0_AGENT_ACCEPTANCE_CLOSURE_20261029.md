# Gold P0 Agent / Job Controller acceptance — 2026-10-29

Scope: isolated Gold UAT, no production merge/cutover. User explicitly put Pro Team multi-agent testing on HOLD. No RM is used in the Linux Agent execution acceptance. This report distinguishes finished gates from remaining owner/security gates.

## Installed code and evidence
- Gold UAT Linux ARM64 LXD `light-remote-gold-uat`: 4/4 active operator, plugin, Agent/Wall and process-supervisor services on SHA `7f46dea1380cfd6a57dcfacf377bdad67cdf2736`; Node v22.23.3, PostgreSQL schema 39. Rollback snapshot `p0-linux-before-7f46dea-20261029`, encrypted/owner-protected secrets unchanged; pre-cutover PG dump and systemd override manifest exist under `/var/backups/light-remote-gold-uat/p0-linux-7f46dea-20261029`.
- Official Gold A/B owner authorization for `dev_e68276c691ba5413f42d5dde` (Linux `light-remote-gold-uat`) accepted via original Local Wall. No direct host command was used as a substitute for an Agent Kill/Cancel.
- True E2E Linux Agent jobs, signed terminal results and durable PG readback:
  - `73843ad6-3343-4c06-9df1-5d947b155477`: RUNNING → owner Cancel, stop_requested (initially unverified) → signed cancelled, exit 130, stopRequestVerified=true, natural-end marker absent.
  - `bdbbc9c7-deb5-4a3f-9fad-f8e43b024979`: QUEUED → cancelled_before_dispatch, signed/verified cancelled, exit 130, stdout 0 bytes, never ran.
  - `6a3e677d-b478-4821-a8ca-a775b20dff41`: RUNNING → OK exit 0, both natural start/end markers.
  - `97fd0247-df36-4c51-b7a8-5be270b62385`: natural timeout, exit 124, natural-end marker absent.
  - Repeated cancellation of two cancelled jobs returned `already_cancelled_verified` without re-execution.
  - PG durable rows were read-only verified; no active M3 or ledger jobs, no Linux resource claim, 3 pre-existing unrelated/historical claims remain. Fleet Linux channelFresh and executorReady both true, queue/inFlight 0.
- Windows10 native build SHA `7f46dea` installed verified, RUNNING Cancel/130 and QUEUED Cancel/130, signed ACK and no claim leaks PASS. Windows11 native cold boot reboot observed (2026-10-29T06:28:31.500Z), native WMI boot telemetry consistent and present shortly after Agent restart; operator recovery mechanism source had passed Windows build/CI. WMI evidence is diagnostic and **not** permission to release old claims.
- Windows native GitHub workflow `40825179381` for source `7f46dea` was successful, including native build, WMI, Full/Compact installer, rollback/uninstall.

## Gold P0 regression / legacy harness
- Corrected `selftest-gold-m6-process-stop.mjs` to VM-evaluate only `fleetStopDispatching` and `dispatchFleetProcessStop`, up to next `deviceResourceSampleCache` declaration. Previous broad slice through `routeDeps` accidentally evaluated a new `GoldDeviceBootObservations` initializer not in its fake context, causing a false harness failure. Owner-scoped process stop, PG claim checks, idempotence, request-only no-release, browser CSRF JS all PASS after fix.
- Related Gold Wall state tests `selftest-gold-wall-stopping-render.mjs` and `selftest-gold-wall-stopping-status.mjs` PASS: RUNNING → visible Stopping → signed terminal, no premature cancellation.
- Current `selftest-gold-fleet-jobs-m6.mjs`, durable Cancel ACK, terminal replay, M3 shared tool admission, M6 owner orphan recovery tests PASS.
- `selftest-v08-fleet-execution.mjs` is **pre-Gold legacy Operator fixture**. It intentionally lacks Gold independent PG/Redis security credentials and cannot boot the current Gold Operator (`gold_independent_mode_required`). Do NOT bypass Gold independent mode or connect it to live UAT DB to force this legacy fixture green. Current Gold M6 fleet, signed owner, durable queue/receipt E2E tests supersede its P0 coverage. This is an acknowledged non-P0 legacy test modernization task.
- Real Linux stop-escalation, child tree, signed native terminal spool/replay, native process start/stop, terminal owner isolation, transport reconnect, output drain and daemon lifecycle regressions PASS in UAT.

## Remaining gates — cannot be claimed complete
1. **Win11 historical UNKNOWN owner recovery**: two retained historical claims, and one unrelated older claim. They are not fake ACK and not eligible for silent SQL deletion. Requires separately approved, owner-authenticated, fenced recovery/unknown disposition if user later wants to restore Win11 job admission. **HOLD**; not part of Linux P0 Agent parity.
2. **Physical click on Kill in Local Wall while RUNNING**: Win10 real browser tab displayed RUNNING with visible Kill beside Copy cmd; official control lane Cancel produced signed cancelled/130. Contract/render tests PASS. A literal owner/browser click on that button during running was not observed. **UI physical click gate HOLD**; do not call it a PASS. Linux E2E specifically excluded RM; no bypass through RM.
3. **Pro Team physical independent A/B**: user explicitly directed HOLD. Do not launch or include in P0 closure.
4. Production release is NOT authorized by UAT success; no Gold merge, no production database/capability/pairing changes.

Conclusion: **Gold P0 Agent / Job Controller functional acceptance passed on Linux UAT and Win10; Win11 native cold-boot/WMI acceptance passed, but Win11 historic resource claims and Wall literal-click UI are separate hold gates.** Source test harness fix is test-only, not a new Agent build. No production cutover implied.
