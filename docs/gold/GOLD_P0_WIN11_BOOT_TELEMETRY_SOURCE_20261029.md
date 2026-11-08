# Gold P0 Windows 11 — authenticated boot observation (source-only checkpoint, 2026-10-29)

## Purpose and hard limitations

The P0 deadlock exists because M4 conservatively blocks Win11 shell and FS diagnostics behind historical project:unknown resource claims. Agent heartbeat/duplex/poll/pulse is the existing authenticated non-job control channel. This patch adds a bounded **non-executing** Agent-local OS uptime sample for Windows and a new typed read-only owner diagnostic. It does not schedule a shell/FS job, spawn PowerShell/WMI/PTY, or loosen resource admissions.

**The Node Windows os.uptime result yields only an uptime-derived boot-time estimate, NOT Windows Win32_OperatingSystem.LastBootUpTime, cryptographic OS boot attestation, proof that a prior process exited, owner approval, or a signed terminal receipt.** Windows Fast Startup, hibernate, wall clock change or system clock drift may affect interpretation. The server marks all records `assurance=estimate_only` and `releaseEligible=false`. No existing owner recovery route consumes these estimates. Consequently actual Win11 LastBootUpTime and eligibility to release historical claims remain UNKNOWN/HOLD. Avoid presenting this as a completed deadlock resolution or physical Win11 acceptance.

## Source changes

- `lib/device-boot-telemetry.mjs`: fixed-typed Node native OS uptime sampler, platform Win32 only, bounded timestamps and consistency checks; no subprocess and no external command input.
- `device-agent/operator-agent.mjs`: piggyback bootEvidence on existing three Duplex heartbeat, signed poll and signed pulse payloads; Linux/old clients omit/null with no connection failure.
- `operator-host/executor-routes-device-channel.mjs`: only ingest through verified enrollment context and authorized duplex session (never from a user-supplied account/device ID); record store failures do not create terminal receipt or resource admission.
- `platform-v2/sql/039_gold_device_boot_observations.sql`: typed account/device-scoped latest sample, with app role SELECT/INSERT/UPDATE, nothing touching claims or terminal ACK.
- `operator-host/gold-device-boot-observations.mjs`: validation, idempotent strict newer sample update, durable latest observation, read and stale status.
- `operator-host/executor-routes-account.mjs`: owner-only GET /v1/accounts/devices/:deviceId/boot-evidence, no job, explicitly `recoveryAuthorization:not_authorized_by_boot_telemetry`.
- `client/core-files.json`: package collector with Windows Agent source.
- `platform-v2/sql/migrations.lock.json` and `deploy/scripts/apply-gold-db.mjs`: 39 checked migrations; no automatic migration on boot.
- `deploy/scripts/selftest-gold-p0-win11-boot-telemetry.mjs`: native sampler, clock/malformed payload, replays, account isolation, read-only endpoint source contract, migration hash.
- Existing schema38 contract test now locates historical migration 38 instead of assuming it is the last one.

## Tests performed on source (ARM, not installed Windows)

PASS: syntax checks, new collector/storage/auth integration contract tests, schema38 contract, M6 device telemetry, M4 unknown project conflict, M6 owner recovery with audit/no fake ACK, Duplex server/client, G3 signed transport & replay, M6 terminal replay, durable Cancel/Stop ACK, git diff --check.

PostgreSQL Gold live DB fixture: ran the exact migration **body inside BEGIN/ROLLBACK**, verified INSERT/SELECT/UPDATE as lr_gold_app, removed transient table via rollback and read back `to_regclass(...)=NULL`, historical claims=3. No persistent DB migration was applied. No original claim was updated/deleted. This test was SQL/fixture, not complete device-to-DB E2E.

## Deployment/owner HOLD

At source checkpoint, live Gold UAT remains 4 services on 0cb844f; actual Gold DB remains schema38. Do not start new 39-target runtime until migration 39 has been applied using reviewed independent Gold-only migrator/rollback plan. Do not change production or installed Windows Agents without separate owner gate. New Agent source field is not sent by existing Win11 rc49 installation.

Before any claim abandonment: obtain stronger real OS boot evidence after 2026-10-28 13:03:05 UTC, enforce offline/fencing policy, explicit owner credential/approval for each UNKNOWN claim, no fake terminal ACK. Current telemetry estimate by itself does not meet that gate. Third unrelated historical claim always HOLD. Pro Team physical multi-Agent HOLD_OWNER_RESOURCES; A/B V2 postponed.

## Next exact steps

1. Review source and migration 039 permissions/rollback; stage isolated Gold UAT candidate only after signed readiness, active job zero and snapshots.
2. Add a direct **Windows native OS LastBootUpTime** collector with fixed API read (not an arbitrary shell command); retain clock-shift/Fast Startup uncertainty and provenance. The first source patch is instrumentation but not proof-grade.
3. Build Windows official CI at exact committed SHA; do not automatically install. Independently obtain owner permission for supported Win11 client update.
4. Read authenticated telemetry via owner route without M4 dispatch, compare timestamp to both claims and independently corroborate actual OS boot.
5. Design explicit owner-controlled offline/fenced recovery if original channel is still online; no silent disconnect to release claims. Only after owner authorization perform exact Operator recovery and physical Win11 Stop/Cancel/timeout/UI E2E.
