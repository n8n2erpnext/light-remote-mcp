# LIGHT REMOTE — T11-F16/P04B: Windows native A/B V2 installed acceptance

**Date:** 2026-11-08 (ICT, UTC+07).  **Device:** `S9X0R0` / `DESKTOP-VA16D27` (Windows x64).  **Source commit:** `4dddf5114248a014c0695e853109358039afa7ad`.

## Physical acceptance — PASS

Owner confirmed reinstall of the exact Windows CI `light-remote-desktop-v4-COMPLETE-windows-x64-4dddf5114248a014c0695e853109358039afa7ad` package. The existing authorized Light Remote AB V2 session was resumed for the same selected Windows device; no new B was issued and no device relink occurred.

| Evidence | Observed result |
|---|---|
| Installed `GptOperator.Client.exe` SHA-256 | `58B903AE8F244F6164FB7B479A38FA11CDD0688981E1BD770F39583577D0A9FE` |
| Installed host binary size | 74,264,584 bytes |
| Installed host `--self-test-output` | Exit code 0; `ok=true`, `targetProfile=pass`, `nativeAbv2Launch=pass` |
| Client version | `0.9.0-rc.49` |
| Windows native pipe `\\.\pipe\light-remote-desktop-v4-abv2` | `WaitNamedPipe` returned **true**, listener available |
| Local Wall `/approve` | HTTP 200 on `http://127.0.0.1:5491/approve` |
| Agent and Desktop processes at physical check | `GptOperator.Client.exe` PID 1728; bundled `node.exe` PID 14252; `LightRemote.Desktop.exe` PID 1124 |
| Signed Native ABV2 preview shown in real Desktop UI | `Signed Owner/Agent approval is available` |
| Pending list after real UI Refresh | `No pending A/B V2 requests` |
| UI target | Short ID `S9X0R0` |
| Desktop Owner session | `OWNER VERIFIED` |
| Local Wall SSO | `OWNER VERIFIED · WALL UNVERIFIED`; local Wall separately requires Owner login |

The previous on-device host binary SHA-256 was `42990F05D50CF1D4AEF2D9075918289D8A525552CDB79EA8009D6D387D43FB87`, and its self-test lacked `nativeAbv2Launch`. The previous Windows pipe check returned `false` / Win32 error 2. The native launch and pipe issue is **resolved** by the new installed binary.

## CI/source provenance

- Windows Tray Client GitHub Actions run [42451833393](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42451833393): `completed/success` on commit `4dddf511`.
- Official complete artifact ID `13605914159`, ZIP SHA-256: `20BCF543CDE5515C2490009F7F704C7A310404F8BB3A3FD1BC289192E0EDC53A`.
- Inner `Light-Remote-MCP-Setup-x64.exe` SHA-256: `0604108D306E241CCFA964A6A461ADA570196FF249A83023E6560D0CACF7DED6`. Both match the manifest and the downloaded package tested on Windows.
- GitHub CI logs independently show `nativeAbv2Launch=pass` and successful hosted installed-client self-tests. The actual physical Windows self-test separately confirms the same capability.

## Scope boundaries / next work

**PASS:** Installed binary and profile, native Agent bridge, real Windows named pipe, Owner-verified Desktop native signed pending preview, UI Refresh pending, local Wall HTTP 200 and preservation of existing A/B V2 authorization.

**NOT YET PROVEN:** Entering/approving a *new* B inside Desktop V4 native UI (no pending request exists), owner-scoped active grant listing (`No verified grants` is shown and its API is unavailable), Local Wall SSO, negative revoked/replayed/foreign account tests on this installed build, Authenticode publisher verification, production updater activation, whole-Windows reboot Owner restoration, physical rollback.

Earlier `OWNER VERIFIED` state after manual browser login must not be misrepresented as automatic restoration. An earlier, separate test confirmed Owner restored after restarting only the Desktop process; reboot of Windows itself remains untested. Grant is not inferred merely from the native UI; the independent Light Remote AB V2 plugin session remained functional.

**No new B, relink, installer action by Agent, grant replacement or production change** occurred during this acceptance verification.

## Repository synchronization

This checkpoint was initially held as a standalone artifact after GitHub connector writes were refused (HTTP 403). The canonical repository workflow uses Git-over-SSH on VPS-ARM; do not treat a GitHub connector's HTTP permissions as the repository's effective write permissions. This file is now staged for synchronization into the Desktop and GoldABV2 branches through the existing VPS-ARM SSH Git origin.
