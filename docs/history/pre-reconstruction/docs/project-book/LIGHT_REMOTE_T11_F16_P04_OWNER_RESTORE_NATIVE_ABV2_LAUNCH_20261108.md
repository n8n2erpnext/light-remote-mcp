# T11-F16/P04 — Owner cold restore and Windows native A/B IPC launch contract

Date: 2026-11-08 ICT. Target: Owner physical Windows S9X0R0 / DESKTOP-VA16D27, existing GoldABV2 Desktop V4 build #649.

## Corrected physical Owner evidence
The Owner explicitly clarified that the initial change from SESSION EXPIRED to OWNER VERIFIED was due to **manual Owner browser login**, NOT automatic restoration. Preserve this distinction: manual login PASS; automatic restoration must be tested independently.

After that manual login, remote UAT stopped only LightRemote.Desktop.exe (PID 9492), relaunched its exact installed EXE and observed Desktop PID 15208. The local Wall Node PID 14084 remained unchanged; 127.0.0.1:5491 remained listening and the existing A/B V2 grant was not invalidated. The Desktop V4 UI (Windows UI Automation semantic snapshot) subsequently showed OWNER VERIFIED with no additional user login. This is **Desktop-process cold restore PASS** (native Owner session rehydration after app process restart), NOT a whole-machine reboot, revoked credential negative test, or long-term 24h family renewal proof. Windows Credential Manager listing showed only product/account target names; credential values were not read or exported.

Desktop's same-device A/B screen continued to show 'Local GoldABV2 Agent not available' while the AB plugin still executed commands on exact Windows. The local Wall showed Owner login required, independent of the verified Desktop Owner session; V4 Wall SSO candidate is OFF in the #649 Windows workflow and should not be represented as already enabled.

## Exact missing native Agent bridge
Read-only Windows native WaitNamedPipe for \.\pipe\light-remote-desktop-v4-abv2 returned false, Win32 ERROR_FILE_NOT_FOUND 2. Node Agent is alive and owns loopback Wall 5491; Desktop executable is alive. This is NO same-host named pipe listener, not an A/B V2 grant failure.

The Windows #649 build compiles VITE_LR_V4_ABV2_NATIVE=1 for the frontend, and its bundled Agent contains device-agent/desktop-abv2-native-ipc-v4.mjs. However the process-start paths client/windows-native/GptOperator.Client/{AgentHost.cs,AgentSupervisor.cs,TrayApplicationContext.cs} did not set the Agent's opt-in LR_GOLD_ABV2_DESKTOP_ABV2_NATIVE_V4=1; the Node Agent intentionally keeps that listener OFF without the flag, exact GoldABV2 hub/base, enrolled identity and authenticated local Wall. Older isolated QA launcher set the flag manually, unlike the integrated #649 package.

## Narrow source remediation — NOT deployed to Owner Windows
- New common AgentHost.ConfigureDesktopOwnerAbv2Environment(ProcessStartInfo) first clears any inherited flag and enables it ONLY when compiled with LIGHT_REMOTE_GOLDABV2_V4, canonical verified package profile and exact GoldABV2 bridge/hub match. Non-Gold and altered origins remain OFF. The Node Agent retains all same-device, Owner bearer, policy, signature, and enrollment gates.
- Called from AgentHost daemon, AgentSupervisor start paths and TrayApplicationContext AgentStart; no direct JS token, generic CLI enable, new endpoint, UI unlock, or B grant mutation.
- Added safe offline C# profile selftest to Program --self-test-output, with explicit Windows hosted build+installed self-test checks for nativeAbv2Launch=pass.
- Expanded deploy/scripts/selftest-goldabv2-unified-one-app.mjs source gate; local Node gate PASS, native IPC Node tests 4/4 PASS, F16 source guard PASS, signed-preview and signed B/PG fixtures PASS.
- Windows native C# compilation, integrated installer, actual pipe availability from new build, native pending and approve from Desktop UI, and physical reboot restore all remain **PENDING** until exact-source GitHub CI and separately scoped physical installation. No source-only PASS is promoted to Windows runtime PASS.

## Scope / preservation
Physical #649 was NOT reinstalled or relinked; Node Agent, Wall, Operator, grant, production, Gold UAT, signed updater feed, Owner vault values and old Gold were not changed by this source remediation. Lab Operator preview hotfix remains its prior deployed candidate. Preserve F16/P03 real Wall B positive PASS and current active grant.

NEXT: build exact Windows GoldABV2 integrated installer through CI, inspect C# self-test and source guard, then authorize a bounded installer upgrade/rollback test before claiming native IPC UI PASS. Separately evaluate full-machine reboot Owner restoration and negative grant/Owner cases.
