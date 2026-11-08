# GoldABV2 Desktop V4 — Windows manual same-host Agent QA

This **unsigned, nonproduction, disposable** package is for testing Desktop V4 native A/B V2 approval using a GoldABV2-enrolled **Agent on the same Windows computer**, while preserving the existing Gold (old endpoint) client.

## Topology

| Component | Backend / Local port |
| --- | --- |
| Installed Gold old Agent/Wall | gold.light-remote.thaiduy.digital; localhost:5491 / 5492 |
| Manual GoldABV2 QA Agent/Wall | goldabv2.light-remote.thaiduy.digital; localhost:5591 / 5592 |
| Owner Login in Desktop V4 | goldabv2.light-remote.thaiduy.digital/account/desktop/v4/... |
| Desktop A/B V2 approval | Same-host Windows named pipe, not a web URL |
| Desktop V4 Open Wall button | STILL localhost:5491 (old Gold) in this coexistence QA |
| Linux GoldABV2 LXD Wall NetBird NAT | 100.94.184.141:15591, unrelated to Windows Desktop |

For a release, the normal single Device Agent still uses its own localhost:5491 Wall. QA sidecar ports are only for isolated testing, NOT a product architecture change. Never use the Desktop Open Wall button to inspect this QA Agent; visit http://127.0.0.1:5591/ manually when needed.

## Manual QA steps

Windows PowerShell 5.1 can have a Restricted script-execution policy. On that host, invoke the known, SHA-verified QA launcher with a **process-only** command such as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qa\Invoke-GoldABV2-V4-QA.ps1 -Action check`; replace `check` with `login`, `poll`, `status`, or `daemon`. This does not change the machine's persisted Execution Policy. Do not change Group Policy or installed Gold permissions.

1. Extract goldabv2-desktop-v4-windows-agent-sidecar-QA.zip into a NEW directory, never the installed Light Remote MCP directory. Verify its SHA-256 manifest.
2. Run PowerShell: .\qa\Invoke-GoldABV2-V4-QA.ps1 -Action check . This checks separate ports/state without modifying Gold old.
3. Run: .\qa\Invoke-GoldABV2-V4-QA.ps1 -Action login . The launcher uses --no-wait, prints the device code and a PUBLIC HTTPS activation URL. The isolated LXD Operator may also print its INTERNAL 127.0.0.1:5583 URL: IGNORE that internal link and use the HTTPS URL from the launcher. Approve the NEW GoldABV2 device enrollment in the Account Portal via the existing Owner flow. Never copy old Gold identity or credentials.
4. Run -Action poll and then -Action status to confirm the new QA device's approved GoldABV2 enrollment.
5. Run -Action daemon in its own terminal under the SAME Windows OS user as Desktop V4. It uses QA ports 5591/5592 and dedicated local named pipe if authorized. Stop with Ctrl+C; it installs NO service or scheduled task.
6. Launch the Owner Login LAB Desktop V4 executable from its own native Desktop CI artifact, log into GoldABV2, open AI Access and verify a real pending A/B V2 request. Enter B and approve. Require authoritative Operator durable grant confirmation, not just a UI indication.

## Signed Cloud connection before A/B V2 discovery

After Owner enrollment is approved and poll/status confirms the new GoldABV2 QA device, run -Action connect under the same QA state. This uses the enrolled Agent Ed25519 identity to request the normal Cloud connection lease (not an Agent A/B grant). Only a connected device can be selected by the ChatGPT A/B V2 helper. Start -Action daemon after connect. Use -Action disconnect for isolated teardown. Never connect or disconnect the installed Gold-old client.

## Boundaries

- QA launcher uses child-scoped environment, separate state/device.json, wall-auth.json, commands, update-runtime and QA ports. It does not edit installed Gold files, Service, Scheduled Task or system-wide environment.
- OS-private Agent IPC flag defaults OFF, enabled only for this manual QA daemon with exact GoldABV2 HTTPS hub/base and active enrolled device. This disposable sidecar sets the exact Lab A/B V2-only instance guards (abv2lab01, legacy V1 disabled, signed Wall B-only), matching the isolated Operator's already-active B-only policy; it does NOT change the Operator or installed Gold policy.
- Existing Gold old client ports 5491/5492 remain in use and unchanged. If 5591/5592 are taken, QA startup refuses.
- Agent B approvals still require current Operator device connection, signed enrollment, live Owner session, B code and existing Operator policy. No bypass of Account verification or local policy.
- Enrollment challenges, passwords, refresh tokens and device private keys are not for sharing.
- GoldABV2 Operator's signed pending/approval feature flags and allowlists may need explicit QA scoping for the newly enrolled device. Never widen production grants just to make a test green.
- Owner Desktop App-to-Wall and Wall-to-App SSO remain separate incomplete T04 acceptance gates. This tests T05A A/B V2 only.

**Source CI and mocked Windows named-pipe tests are not physical B-grant acceptance.**
