# Tauri 2 shell proof — NO Agent/Owner privileges

Tauri 2 native window hosts the *existing built React UI*, no duplicate Agent or background service. Initial pilot deliberately refuses:
- `invoke_handler`, custom Rust commands, any Tauri plugin, filesystem/process/shell execution.
- Broad `core:default` capabilities. `app.security.capabilities` is empty and global Tauri injection disabled.
- Launching Local Wall or obtaining Owner authentication / CSRF from the native process.
- Any SQL migration, Operator/Gold deployment, update to installed Windows rc49.

The native webview has its **own origin** and same-origin `/api/status` will fail closed (local device unverified); it does **not** silently fetch from the real Owner Wall. The only current native functionality is opening/closing/resizing the V4 UI window.

To validate: `npm run build && npm run tauri:check` (Rust + WebKitGTK libraries required); `npm run tauri:build` when UI preview is acceptable and native toolchain is available. `bundle.active=false` means the test does not ship an installer. Avoid placing a production app id next to this isolated pilot.

Required next: a constrained, authenticated native bridge with explicit status-only IPC, OS-specific tray icon/window lifecycle and recovery without Agent duplication; separately review the signed Owner permission boundary before exposing any mutation. Need physical Windows10 150%/Win11/macOS/Linux GUI E2E.

## No more build on VPS-ARM

Owner requested GitHub Actions builds only. Use `.github/workflows/desktop-v4-native-ci.yml` for Rust release compilation on GitHub Windows/macOS/Linux runners and for browser visual screenshots. VPS-ARM is for SSH Git push, source and evidence only. Do **not** run `cargo build`, `tauri build`, `npm ci` or install packages locally on ARM just to check this pilot. The source and Rust lockfile are preserved; local build artifacts have been removed.

## 2026-11-02 Native Open Wall and Activity Logs
This post-pilot addendum supersedes the older claim that Tauri has zero native commands.
Owner approved the nine-screen Windows visual layout. Exactly one new native command
(open_local_wall) may open two literal Local Wall localhost:5491 addresses (home or
Settings activity-log section) in the system default browser. This fixed allowlist does
not start an Agent, access credentials or enable arbitrary shell, file or URL actions.
The main window receives only the custom allow-open-local-wall permission.
Settings now shows bounded Activity Logs retention and optionally safe, verified
same-origin log statistics. Standalone Tauri is NOT a Local Wall Owner session; statistics
remain unverified there, and the functional CTA opens the real authenticated browser Wall
to view history, configure rotation and Clean Log. The local Wall remains authoritative.
No Gold UAT/production or installed WinForms client was changed. Native CI and physical
acceptance still required. Read project-book V4 WALL LOG CONTROLS 20261102.

## 2026-11-06 — Single unified Desktop V4 packaging (overrides pilot notes above)

The original UI-only/no-bundle notes above describe a historical prototype. There must be no separate user-facing UI-only executable and Owner-function executable. The authoritative Desktop branch now uses a single Tauri/React/Rust build, with native Owner Login (OS vault), same-host A/B Agent IPC, Local Wall opener and the validated read-only Owner snapshot in the SAME executable. The Desktop NSIS Setup.exe is generated once per source commit on Windows from the `unified-desktop` workflow job; web/Chromium tests are testing, not another app. `bundle.active=true`, Rust default includes `desktop-owner-login`, Windows uses one `--bundles nsis` artifact and other OS builds use the same feature set. No separate UI-only binary is published.

Integration caveat: the NSIS bundle currently packages the Tauri desktop executable, not a new or replaced Windows Node Agent/Tray service. That same-device enrolled Agent is required for native A/B operations; backend Owner snapshot feature gates remain OFF until independently installed and verified in GoldABV2 LAB. SSO T04 and other module/mutation APIs remain incomplete. An unsigned integration LAB installer is NOT a product-complete release or an instruction to replace the installed Windows Gold Agent. Do not ask the Owner to test multiple application variants; perform one physical acceptance pass after completing the runtime/API integration and packaging the full installed product.
