# GOLD G3 + Close Session — Windows UAT build receipt
Date: 2026-10-25, Asia/Ho_Chi_Minh
Environment: DESKTOP-VA16D27, Light Remote Gold authorized MCP session

## Source
Repository: n8n2erpnext/light-remote-mcp
Local Windows branch: fix/gold-wall-close-session-20261025
Exact commit: 1bae08112ea52ec47dc22af790c48fded6688193
Contains feature baseline: 20b584c45376aee84e829d433eab51735af50406
Local checkout: %LOCALAPPDATA%\Light Remote\G3-Account-UAT-387498d\source

## Artifact
UAT installer: %USERPROFILE%\Downloads\Light-Remote-MCP-Gold-G3-1bae081-UAT-UNSIGNED.exe
Builder output: %LOCALAPPDATA%\Light Remote\Gold-UAT-1bae081\native\installer\Light-Remote-MCP-Gold-G3-1bae081-UAT-x64.exe
Size: 195078739 bytes
SHA-256: c774dd050e991f470fed2e539c75167a7fe806590ac42d2b598eb9e6cf9e54e4
Authenticode: NotSigned
NOT INSTALLED. WARNING: Installer uses the existing Light Remote MCP AppId and would replace the connected Windows client.

## Toolchains
.NET SDK 8.0.426 isolated under %LOCALAPPDATA%\Light Remote\Gold-UAT-1bae081\tools\dotnet
Inno Setup 6.7.3 per-user
Bundled Node.js v22.23.2 sourced from the previously installed Light Remote runtime (matches official GitHub Windows build)
npm ci --ignore-scripts completed
Native component publishes PASS:
- GptOperator.Client.exe
- LightRemote.Updater.exe
- LightRemote.RM.exe
- LightRemote.InstallWatchdog.exe (UAT fallback only)

IMPORTANT DIFFERENCE FROM OFFICIAL CI:
- Watchdog NativeAOT failed to publish because the Windows device lacks MSVC C++ linker/Desktop Development workload.
- Used temporary Windows GUI self-contained single-file .NET publish with PublishAot=false. PE subsystem verified 2.
- This UAT installer is not equivalent to the full official CI/release artifact. Before release, build with NativeAOT and proper code signing; do not promote this unsigned variant to production.

## Content, staging, smoke
- Full stage: 417 files, approx. 289.5 MB.
- Canonical client-core 103/103 PASS.
- Client-core digest: 0dc2033f8b88334efb12ed86fe02decdcafd0e81af96a06159a4ef5a8cea34cf.
- Windows node-pty@1.1.0 prebuilt win32-x64 PTY PASS.
- 39 local Material icon SVG files, 18 required icon refs PASS.
- Packaged Local Wall routes /, /permissions, /approve, /settings, status API PASS.
- Real Remote V2 self-test exit=0; output ok=true runtime=real-remote-v2-companion.
- G3 Wall status rate limiting/cache existing self-test PASS.
- v09 Local Wall manually closed session regression PASS.
- G2 Wall headers-sent recovery regression PASS.
- New Close session concurrent stale-response fence PASS on Node v22.23.2.
- New Close session HTTP fixture: unconfirmed close returns 409, confirmed close invalidates status cache immediately; PASS.
- Inno Setup build PASS and installer copied to Downloads with matching SHA-256.
- No Windows installer run/upgrade performed, no GitHub push/CI run for 1bae081.

## Live ARM Gold UAT
At read-only verification after Windows build:
- light-remote-gold-operator/plugin/process-supervisor/wall: all active.
- Operator ExecStart still /opt/light-remote-gold-uat-candidates/99b1d2fd3dbdd54c7f34b88033ba159e4560e8b2/operator-host/executor.mjs
- Scope d5e57c01-8864-4995-a186-01de2514ba79 Home epoch=1 revision=6.
- Home and Replica ACK hash both 456b287151e86121f33a934f0a101cc4aa7e9f62318b0cefc0daa811ea4a2aa0.
- No Manual Replica live Sync now performed. Revision 7/7 → 8/8 gate OPEN.
- Existing LXD rollback snapshot gold-before-manual-replica-20b584c-20261025 remains previous safety baseline.

## Next
1. Rebuild via GitHub official Windows Tray Client workflow or provision full MSVC C++ toolchain and validate NativeAOT watchdog; sign release-grade installer.
2. Resolve authorized ARM Gold UAT cutover/deployment gate. No route around tool safety/platform denial.
3. After ARM Gold UAT has new candidate, install verified Windows client in controlled window, smoke native PTY/Real Remote/Wall.
4. Execute real Owner Account Manual Sync now on synthetic UAT workspace; verify signed release, event ACK, Home checkpoint 7/7 then 8/8, OFF/mode-switch fencing and CAS restore. Do not mark G3 E2E PASS before receipts.

No production services or real Long Memory content were modified during this build.
