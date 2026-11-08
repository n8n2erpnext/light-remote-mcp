# T11-F16/P03 — Real Owner B approval, Windows Agent command (2026-11-08)

## Live positive-path evidence
Owner requested creation of NEW B for exact Short ID S9X0R0. AB V2 read-only device discovery found a single online Windows match DESKTOP-VA16D27; Agent initiated A/B V2 helper returned v2_pending_unapproved / approvalState=pending / reused=false. B was shown only in chat, not recorded here. Owner reported Done after entering B and approving on device-local Wall.

Official AB V2 helper with no new A code subsequently returned status=ready, protocol=abv2, pairedDevice matching exactly the discovered Windows device and recovered=true. Existing held durable session was resumed, and an actual PowerShell command on DESKTOP-VA16D27 returned exitCode=0. Output: F16_P03_EXEC_OK=2026-11-08T12:25:34+07:00; COMPUTER=DESKTOP-VA16D27; POWERSHELL=5.1.19041.6456; WALL_APPROVE_HTTP=200 for 127.0.0.1:5491/approve. The supplemental English page text regex did not match; it is not used as authorization proof. No direct PG grant row inspection; grant-facing evidence is official AB V2 helper ready and real Windows command.

## Verified preconditions
Desktop branch cd6974c5 and Gold branch bb157107 matched origin and were clean with identical Living Master. Lab ABV2 Operator and Plugin were active; running candidate t11-f16p02-owner-consent-preview-20261108; signed-preview module SHA256 e161df5f74bd4c06048bf5e2830ab984ae2238f178673b2207179446e74189ce, rollback script present. Scoped signed preview / signed B approval / Wall / F16 source regressions PASS. Chrome on Windows showed No pending requests after Refresh before new B was issued.

## Disposition
**F16/P03 real new Agent request + human Owner Wall B + AB V2 ready + exact-device command = PASS.** This does NOT close full F16 Windows physical acceptance. Native Owner OAuth and vault persistence across reboot, physical revoke/replay/foreign negatives, publisher Authenticode, Owner read-only views and physical install updater/rollback have not been tested here. Do not expose B code, grants, cookies or account credentials. No production, old Gold UAT, signed feed, Windows reinstall/relink, Lab service restart, grant cancellation or owner policy changes were performed. NEXT: preserve valid ABV2 grant and assess remaining F16 physical gates separately.
