# T11-F16/P01 — Windows Owner/B physical acceptance readiness

Date: 2026-11-08. Target: **GoldABV2 Desktop V4 on a deliberately selected Owner Windows test host**. This document is a source-and-CI handoff, **not authorization to install, relink, renew B, transfer Owner, publish signed updates or deploy to Gold Lab/production**.

## 1. Exact candidate and artifact boundary

- Use only an exact Desktop source commit SHA with successful Gold GC, Desktop Web/macOS/Ubuntu and Windows full native installer CI, plus both Docs/Truth checks.
- The native Windows workflow builds **one complete** Desktop V4 + Windows Agent + Local Wall + Real Remote installer artifact; it includes `Light-Remote-MCP-Setup-x64.exe`, `SHA256SUMS.txt` and from F16 onward `F16_OWNER_UAT_INTAKE.json`.
- A GitHub Actions ZIP artifact SHA256 identifies the downloaded ZIP, **NOT** the inner Setup.exe. Read the inner `SHA256SUMS.txt` and rehash the EXE **before installation**, never derive the EXE hash from the ZIP hash.
- The F16 helper `deploy/scripts/f16-owner-uat-artifact-preflight.mjs` takes three explicit read-only arguments: `--installer ABSOLUTE_PATH_TO_EXE --checksums ABSOLUTE_PATH_TO_SHA256SUMS.txt --source-sha EXACT_40_LOWERCASE_SHA`. It checks a single exact checksum entry, same-directory regular files without symlink redirection, MZ/PE header, exact streamed SHA256, and exposes a sanitized intake JSON with `physicalWindowsAccepted=false`, `ownerBApproved=false`, `authenticodeSignatureVerified=false`. No install, network, credential read or filesystem mutation.
- The GitHub Actions source-SHA field in the receipt is **declared**, not independently signed. Before real UAT, the Owner checks the GitHub run/commit and verifies Windows Authenticode/publisher **separately** using a trusted release policy. No claims of code signing, signed update feed, or release provenance based only on F16 hash.
- CI run 42366909565 on prior H3 source 322be591 produced ZIP sha256 dc5c1eac00b1224dcdf8538f763e5fa0b69a228dfb652e50aa2b30ad9806e7f3. **It predates F16**, so it has NO new F16 inner-exe receipt and must not be represented as F16-pass. Await exact F16 SHA native Windows artifact.

## 2. Explicit physical authorization and rollback readiness (NOT RUN)

Before any installer is invoked, the Owner chooses the exact Windows test device (not any other online Fleet device), the permitted time, the expected GoldABV2 account, acceptable downtime and rollback target. Record prior installed native version, known-good installer and independently checked inner EXE hash, existing Tray/Agent/Wall/updater task statuses, local Wall URL/port ownership, account login state and protected user settings. Save any backup in an Owner-controlled safe location, **without collecting browser secrets, B codes, refresh tokens or private console output into the handoff**.

Do not touch existing Gold production endpoints, real active Owner grants, SSO flags, enrollment records or Long Memory data while collecting readiness. Verify installer package profile binds only GoldABV2, not legacy Gold production. Treat any wrong server marker/profile as STOP. The Owner, not an agent, performs any B approval at that same device's Local Wall /approve. Do not reuse one-time A/B codes.

## 3. Proposed Owner-observed acceptance scenarios

| Gate | Observed physical evidence required | STOP / rollback rule |
| --- | --- | --- |
| F16-A artifact/provenance | Exact GitHub source and run, successful F16 inner PE+SHA check, independently verified publisher/signature policy, known-good prior installer | Wrong EXE/profile, nonmatching SHA, missing provenance or backup |
| F16-B install/runtime | Single unified package installed on selected Windows only; Tray starts; background Agent/Wall/RM health, correct Local Wall instance on device, no WrongListener | Setup fails, wrong instance, missing Tray/Agent, conflict with existing Wall |
| F16-C native Owner login | Real system browser OAuth -> loopback callback -> native Rust status `verified`; Owner identity and account binding match; no Owner bearer or refresh in WebView/Wall/log | Unknown account, plaintext credentials or browser-only proof |
| F16-D persistent login | Close and restart Desktop and then machine/session; OS Credential Manager (native vault) restores without additional browser login when session remains valid; revoked/expired Owner must return signed-out or denied, not stale verified | Restore invents Owner rights, token leak, inaccessible vault silently ignored |
| F16-E local ABV2 approval | Device-local Wall shows the active pending A/B for correct device; real Owner manually approves B at the **same Wall**; signed grant is scope/device/account bound; no B value in handoff logs | Foreign B, wrong Wall, account/device mismatch, expired/replayed A/B accepted |
| F16-F negative authorization | Denied/revoked/expired pending, ownership transfer, device relink and mismatched account fail closed; device policy cannot be bypassed by desktop login | Unauthorized tool/API or Owner stale session allowed |
| F16-G Owner read-only pages | Owner inventory, sessions, live jobs, monthly usage and retention provenance reflect signed Gold data, current short IDs and negative foreign-device isolation; pagination/partial coverage honest | Empty/foreign data shown as verified, >200 silently truncated, permanent audit falsely asserted |
| F16-H independent updater/rollback | Test only within Owner-approved isolated Windows setup; staged updater and known-good rollback verify Agent/Wall/Tray recovery and preservation of Owner protected state, then explicit uninstall if requested | Missing rollback anchor, incomplete restart or unknown update state |

These rows are **PENDING**, not passed by simulated GitHub hosted-runner tests. Actual timestamps, device Short ID, build SHA, tested UI version, pass/fail, event logs with secrets redacted, and rollback recovery results must be documented before physical closure.

## 4. Script/CI mechanism in this phase

- Script: `deploy/scripts/f16-owner-uat-artifact-preflight.mjs` (read-only, no installer execution or network).
- Negative regression: `deploy/scripts/f16-owner-uat-artifact-preflight.test.mjs` (synthetic PE/sidecar, corruption, duplicate entries, wrong source, symlink rejection, forbidden CLI switch).
- The Windows full-installer job runs this preflight only AFTER the existing installer install/update/rollback/uninstall runner tests and uploads the sanitized `F16_OWNER_UAT_INTAKE.json` alongside the installer. The Gold GC source gate runs the same Node regression. This provides a useful independent *artifact intake* receipt without manufacturing physical Owner/B evidence.
- Source and docs are committed on `feat/desktop-v4-api-integration-20261103`, mirrored as matching Living Master / Worklog / checkpoint on `feat/goldabv2-desktop-owner-lab-20261103`. No remote Gold runtime or signed updater endpoint is changed.

## 5. Decision and next step

F16/P01 is complete only when the new exact SHA CI runs prove the artifact intake check and the documentation is mirrored. F16/P02 **physical Owner/B acceptance remains blocked until a separate, explicit Owner authorization for the selected Windows device**. Do not auto-install anything, generate new B, enable a release feed or infer physical acceptance from GitHub CI. If any acceptance row fails, stop and preserve prior known-good state for Owner-directed rollback; do not claim success from a partial log.

## 2026-11-08 — Windows F16 path alias CI correction

Original Windows run 42442668328 FAILED during F16 synthetic tests (6/7 failed f16_intake_redirected_path), so no real-EXE F16 receipt was generated. Windows realpath may normalize a regular file path differently from path.resolve. Corrected source still denies symlinked EXE/sidecar files via lstat and compares their resolved directories, but checks raw realpath spelling only on POSIX. PE signature and SHA256 comparison are unchanged. New exact Windows CI must pass before calling F16 accepted. No physical B or Authenticode proof is created.
