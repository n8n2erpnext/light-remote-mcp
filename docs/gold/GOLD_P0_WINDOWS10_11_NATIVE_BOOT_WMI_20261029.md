# Gold P0 Windows 10/11 Native OS Boot Source — 2026-10-29

## Isolation
This is source-only; installed Win10/Win11 clients and UAT runtime are unchanged by this source commit. Existing Gold UAT PostgreSQL38 claims remain owner HOLD. No agent installation, deployment, service restart, orphan abandonment, terminal ACK or M4 override occurs here.

## Trusted data flow
The already-owned Windows .NET AgentHost (scheduled task / tray supervisor) calls a fixed read-only System.Management WMI query:
  SELECT LastBootUpTime FROM Win32_OperatingSystem
This is in-process OS API, not PowerShell, WMIC, a generated command, an AI tool, or M4 job. The host waits at most three seconds, then starts Node even if WMI times out. It clears any inherited environment boot values and, only on successful observation, sets three fixed numeric/source environment fields when launching the Agent. Agent samples os.uptime as before, adds WMI timestamp/source/consistency to signed heartbeat/poll/pulse, Operator validates enrolled device/account context, persists latest telemetry in account-scoped PG39 typed table and exposes owner-only GET status.

WMI reports Windows OS LastBootUpTime, but is *not* cryptographic hardware/OS attestation; Fast Startup/hibernate/clock changes and local agent compromise may affect trust. Value is diagnostic only, always releaseEligible=false. No automatic claim release, terminal ACK synthesis, or channel-offline bypass is permitted. A native sample can differ from duration-derived estimate; preserve both and mark nativeConsistency=divergent for >=5-minute discrepancy rather than pretending precise agreement. Old clients omit native fields and stay connected. Linux has no Windows boot sample.

## Files
- WindowsBootEvidence.cs: WMI direct query, bounded asynchronous wait, validation, no executable spawn, self-test.
- AgentHost.cs and AgentSupervisor.cs: configure fixed boot observation for daemon starts only.
- Program.cs and csproj: Windows native self-test entrypoint and pinned System.Management 8.0.0 dependency.
- lib/device-boot-telemetry.mjs: optional WMI source bridge and signed payload validation.
- operator-host/gold-device-boot-observations.mjs, platform-v2/sql/039_gold_device_boot_observations.sql, migrations.lock.json: optional native columns, source constraints, upsert and owner read.
- Windows CI workflow: native Windows executable WMI query self-test from published full client; fails if WMI source absent, includes existing installed/compact smoke further down.

## Acceptance
ARM source regression suites for Win10/11 signed transports, M4, Stop/Cancel, owner recovery, module packaging PASS. Real Gold PostgreSQL BEGIN/ROLLBACK of exact migration SQL with native WMI record and lr_gold_app role PASS, table removed and three historical claims intact afterward.

Windows .NET native CI compilation + full/compact/installer smoke and real Win10/11 physical installation/E2E are pending at the time this note is authored. Do not infer physical PASS from Windows-hosted CI. Do not release existing Win11 claims without separately verified post-claim OS boot, owner confirmation of UNKNOWN, exact job, offline/fenced authenticated recovery and audits. Pro Team multi-agent physical test remains HOLD_OWNER_RESOURCES, A/B V2 redesign postponed. No production change allowed.
