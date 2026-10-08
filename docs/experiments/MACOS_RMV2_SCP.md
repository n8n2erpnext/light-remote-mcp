# Experimental macOS Real Remote V2 + SCP

**Branch:** `feature/macos-rm-v2-scp`. Starts at signed rc.47 GitHub `main` commit `d5e8c31`.

## Guardrails
- This is an isolated feature branch: do not modify `main`, published tags, R2 manifests, signed updater channels, or live client enrollment.
- Windows Real Remote V2 implementation is unchanged.
- macOS native helper is **disabled by default**; it does not enable desktop observation or input on existing installations.
- macOS 11 Big Sur x64 and macOS arm64 are build targets.
- `LIGHT_REMOTE_REAL_REMOTE=1` and `LIGHT_REMOTE_CLIENT_EXE=<absolute installed helper path>` are required together for capability discovery; local device policy still governs `desktop` and `desktop-input`.
- Screen Recording and Accessibility permissions must be explicitly granted by the owner to the relevant executable/bundle, and *checked on each operation*. Never auto-run `CGRequestScreenCaptureAccess()` during unattended tests.
- Native RPC uses randomly named /tmp AF_UNIX socket with 0600 permissions; no additional TCP listener.

## SCP finding and fix
The original public tool `light_remote_scp_upload_chunk` declares and forwards `transferId,index,data`, but agent `LightScpFileRegistry.putUploadChunk()` requires `sha256` per chunk. This yields `scp_invalid_sha256`. New optional `sha256` field is forwarded from updated clients; missing field from old clients is derived from decoded bytes. Supplied hashes are compared, and mandatory final upload SHA-256 still validates against complete committed file. Binary 3-chunk resume/overwrite/race tests preserve existing behavior.

## macOS Real Remote V2 milestones
- M0: RPC parity through owner-only Unix socket; status, window list, screen frames, visual lease lifecycle, key/mouse/text primitives; fail-closed TCC permissions.
- M1: Native Swift compilation on GitHub macOS runners (x86_64 + arm64), executable --self-test and Big Sur minimum.
- M2: macOS 11 Intel test host: user-approved Screen Recording & Accessibility, observation, input with test application, expected denied-state checks.
- M3: macOS accessibility semantic tree, element actions, journal deltas and browser-CDP parity; app/window navigation E2E.
- M4: Test signed/notarized artifacts and updater rollback in separate canary; merge only after explicit owner review.

**Current stage:** M0 and M1 native transport/compilation and TCC-denial E2E PASS on Mac Intel, initial M3 AX semantic snapshot/actions in code pending native CI. Browser-CDP semantic and continuous event journal are still pending; do not claim Full Support yet.

## Relevant files
- `client/macos/real-remote/main.swift` native companion
- `lib/native-desktop.mjs` gated macOS helper detection/Unix socket broker
- `.github/workflows/macos-client-build.yml` separate macOS helper build
- `plugin-server/tools.mjs` chunk-hash schema/forwarding
- `lib/light-scp-file.mjs` backwards-compatible hash validation
- `deploy/scripts/selftest-v12-macos-rmv2-bridge.mjs` mock Unix socket duplex test
- `deploy/scripts/selftest-v10-light-scp-file.mjs` upload integrity regressions

## No deployment
Do not deploy this branch to direct ARM or VPS-AMD. Do not edit /Library/Application Support/Light Remote/current on the owner's Mac during development.

## Manual macOS 11 TCC setup (owner only)
After downloading the canary x64 helper to `~/Library/Caches/LightRemote-RMV2-Experimental/LightRemoteRealRemoteAX`, the owner can **locally** run:
```sh
"$HOME/Library/Caches/LightRemote-RMV2-Experimental/LightRemoteRealRemoteAX" --request-screen-recording
```
Then open System Preferences → Security & Privacy → Privacy → Screen Recording / Accessibility and grant the helper if listed. Reopen the helper after macOS requests a restart. Screen Recording and Accessibility MUST both show true in `--self-test` before the test can proceed to screenshot and input. Do not request permissions or perform input automatically; owner explicitly approves all OS dialogs. Real Remote remains disabled in the regular launch agent.

## macOS Big Sur TCC attribution diagnostic — 2026-10-08

On the owner's Mac Intel 11.7.10 the same *unsigned*, isolated `LightRemoteRealRemoteAX` binary returned:

- Locally under graphical Terminal: `screenRecording=true`, `accessibility=false`.
- Spawned by the existing headless Light Remote Node LaunchAgent: `screenRecording=false`, `accessibility=false`.

The owner had manually enabled permissions, but the AX trust check remained false. This confirms permissions are not transferable between the launching contexts. For a command-line test, the owner should check the **Terminal.app** entry in Accessibility as the responsible GUI application. Production launchd and the separate native helper need their own stable signed identity / responsible-process onboarding; **do not automatically grant, reset TCC, or use this unsigned canary for production**.

The native canary source now accepts `--request-accessibility` exclusively as an explicit owner-initiated CLI request. It calls Apple's `AXIsProcessTrustedWithOptions` with `kAXTrustedCheckOptionPrompt=true` (asynchronous OS prompt) and returns the current trust value. It never requests permission in `--self-test`, background `status`, RPC/desktop action paths, or CI. This flag is **not in the old installed canary** until rebuilt and verified. Never call this flag from an unattended remote session.

## Robot visible-cursor experiment (macOS first, 2026-10-08)
Owner requests a **visible moving cursor** for Agent actions, including AX/DOM-like actions where UI changes previously appeared without obvious mouse travel. Implement and evaluate on isolated macOS branch before designing a Windows port.

- `RobotCursorMotion.swift`: smooth bounded global CGEvent mouse movement (smoothstep interpolation, capped 40 steps / 550 ms). Broker's existing click-with-coordinates emits move then click, so it is visible; drag already has its own event path. Semantic AX actions now visually glide to the target's on-screen center BEFORE the native AX value/press/focus action, without injecting a mouse click. The AX action still determines actual behavior; pointer movement is purely visual. Foreground process must match session PID or operation fails closed. AX target must have nonzero bounded on-screen geometry; otherwise semantic action runs without moving the pointer and reports cursorMoved=false.
- `RobotCursorOverlay.swift`: dedicated same-binary child launched on visual.attach or semantic.attach. Small click-through nonactivating AI ring follows the real cursor, across Spaces and fullscreen windows; indicator never steals focus, never hides the system cursor. On detach after final lease or helper exit it terminates, and the child also monitors the parent PID plus bounded deadline. This **is an additive Robot indicator**, not yet OS cursor replacement. Hiding system cursor is intentionally withheld until owner approves a crash-safe restoration test.
- Existing Windows implementation remains 100% untouched. Do not merge or copy experimental code into Windows before measured macOS UAT. Mac's official installed agent also remains untouched; new behavior exists only in a signed feature canary downloaded from GitHub Actions.
- Acceptance: both Intel x64 and arm64 CI native Swift compile PASS; real Mac canary `desktop.visual.attach` shows a clear ring, `desktop.visual.detach` clears it; AX synthetic dialog input still matches expected text, and the pointer travels smoothly to its field and OK button. A separate physical CGEvent input/drag canary and latency benchmark must run before public release.

## macOS Big Sur dedicated GUI-process TCC attribution probe (feature canary)
- Installed macOS rc.45 operator agent LaunchAgent runs Node directly from /Library/Application Support/Light Remote/current/runtime/node; lib/native-desktop.mjs currently child_process.spawn() of the native helper. This process chain was verified to get TCC Screen Recording=false, Accessibility=false. Only the owner's already-authorized graphical Terminal path gave true/true.
- Apple ServiceManagement SMAppService for bundled agents is macOS 13+ and CANNOT serve macOS 11.7.10 baseline; retain legacy LaunchAgent for the existing client. Do not alter current launchd service, TCC DB, or owner permissions silently.
- New source test flag in native macOS Real Remote helper: --gui-tcc-probe (self-contained no socket): queries only CGPreflightScreenCaptureAccess/AXIsProcessTrusted and reports bundleIdentifier, PID, PPID and timestamp into owner-only ~/Library/Caches/LightRemote-RMV2-Experimental/gui-tcc-probe.latest.json (0600). It never calls request/prompt APIs, injects input, or captures pixels. Intended to run from LaunchServices via /usr/bin/open -na <isolated signed canary .app> --args --gui-tcc-probe, then read results via official Light Remote. This distinguishes GUI bundle TCC from Node spawn / Terminal.
- Do not claim GUI TCC solved until real Mac experiment. Stable signing identity/permission and owner approval still required. Feature branch only.
