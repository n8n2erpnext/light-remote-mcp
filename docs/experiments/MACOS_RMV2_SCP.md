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
