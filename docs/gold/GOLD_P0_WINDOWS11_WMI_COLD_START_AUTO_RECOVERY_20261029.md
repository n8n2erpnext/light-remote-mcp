# Gold P0 Windows 10/11 — native WMI cold-start recovery (2026-10-29)

Scope: **source-only isolated Gold branch**. VPS-ARM production, production database/services, live Gold UAT four services and physical Windows #558 installs are not touched by this commit. This follows the 2026-10-28 Gold P0 plan for Windows stability, durable Job Controller, Cancel/Kill and truthful UNKNOWN states. Long Memory V2, RC50 and A/B V2 are outside scope.

## Physical fault and RCA

On Windows 11 #558, after user-authorized real OS Restart, signed Agent heartbeat returned a fresh uptime-derived OS boot estimate but initially `nativeBootAtMs=null`. Native host had attempted WMI **once** before the new Node daemon started, during Windows boot when WMI was unavailable. Manually using the official tray "Restart Light Remote" after OS startup produced valid native WMI (`2026-10-29T04:12:57.500Z`, nativeConsistency consistent) without OS reboot. This proves the recovery opportunity, NOT that a new native build is physically verified.

## Candidate correction

- Both scheduled `AgentHost` and tray `AgentSupervisor` still call bounded direct `System.Management` WMI before spawning the Node daemon, no PowerShell/WMIC/shell.
- If initial WMI failed, native host supplies one **unique per-child** cache path in child environment. After process start, a background task retries fixed WMI query with 12 attempts/15s delay and 3s bounded capture. It writes a small JSON result using a temporary file and atomic rename; health collection never starts, cancels or replays M4 jobs.
- Node boot collector can read **only** a bounded file under the known native-host AppData path pattern, validates exact source, numeric timestamps and consistency against fresh OS uptime before including it on the already-signed Agent channel. Initial heartbeat remains available with uptime-only estimate.
- On process exit/daemon restart, cancel retries and delete that unique cache; no stale cached boot should be used on a later OS restart.
- The diagnostic `releaseEligible` remains false; this is not boot attestation or proof of old process exit. No resource claims, signed terminal receipts or owner-disposition state are modified.

## Regression and release gates

- `node deploy/scripts/selftest-gold-p0-win11-boot-telemetry.mjs` validates initial lack of WMI, late cache creation **without restarting Node**, invalid source/time/oversized file/invalid path, cache removal and no M4 mutations.
- Nine targeted P0 tests PASS on ARM isolated source (Job Controller durable ACK, M6 signed terminal replay, M3 admission and entitlement, A/B read-only boot inspector). See run logs/commit proof.
- **Windows-native GitHub CI must still publish/compile and verify Windows runtime/installer with exact commit SHA**. Source regression is not physical Win11 acceptance.
- **Owner-approved physical installation and cold-boot/reconnect test** needed on Win10 and Win11 after CI; no install without approval.
- Two Win11 historical M4 claims remain HOLD, original unrelated third claim untouched. No owner bypass or direct SQL release. Separate Pro Team physical multi-agent and Wall LIVE OPERATOR STREAM UI gates still pending.

Rollback: revert this commit on isolated branch; no DB migration, service restart or production change is needed for source-only candidate.
