# Windows tray, setup and branding follow-up — 2026-11-10

Owner reports dev5 installed, remote server stilldev4, noncanonical consent logo and an empty desktop-v4 installation directory. Owner explicitly requests a fresh Windows install/uninstall design, not reuse of Moryqa Windows V2. Keep one LightRemote.exe and internal-only delivery.

## Required outcome

1. Restore five actual Agent tray states through the unified Tauri tray: Connected, Disconnected, Dormant, Unlinked, Stopped. Existing native TrayIconFactory already uses exact Moryqa exports; unified_tray.rs currently uses only the default static app icon. Reuse state semantics and canonical assets, with bounded subtle transitions, no invented activity or extra status dot.
2. Use exact original STOCK logo34:4 from the open Moryqa file Light Remote AI UI/UX. Existing tray palette is frame40:895, assets40:896/899/902/905/908. Preserve original assets/frames. New setup starts at frame73:76; all Windows V2 screens are excluded as layout foundations.
3. New editable install/uninstall flow uses Google Sans Flex in Figma. Export through Moryqa and adapt into native Inno Setup controls with real progress, keyboard/accessibility, silent operation, per-user AppId, tasks, migration and rollback intact. Code reuses packaged Google Sans; actual TTF name table confirms family Google Sans, Regular. Do not introduce Inter/Segoe as the product font.
4. Preserve identity/vault/settings/local memory. Remove desktop-v4 from the primary build stage only when empty; installer upgrades remove the legacy executable and then only an empty legacy directory. Preserve unrelated files/sentinels.
5. Server dev5 is now deployed from exact GitHub8e0d932/CI64/artifact. New tray/setup source will be a separate internal dev6 build from permanent work, native compilation in Actions only. Owner self-installs/tests; no public Release/feed.

## Verified checkpoints and actual runtime

Pre-change source0c1a153; annotated tag checkpoint/20261110-before-tray-installer-0c1a153. Full Git bundle restore/fsck PASS. Exact hashes are in Master Checkpoint. Only approved ARM root is used.

Dev5 Lab deployment: [receipt](../../evidence/distribution-redesign/DEV5_LAB_DEPLOYMENT.json). Fresh Git archive and same dependency locks/ABI127; private config/override/database backups with pg_dump index verification; no SQL migration. Operator/Plugin only restarted with the approved maintenance job mode. Independent Agent/Wall/supervisor/mTLS PIDs and dependency graph/home ACL unchanged. Public/private health/API PASS, unauthenticated snapshot401, account/device/grant/Owner counts unchanged. Prior947a117 runtime is retained for exact rollback. Owner Windows installation is unchanged by Codex.

RM inspection is explicitly authorized on DESKTOP-VA16D27 through Light Remote AB; existing A/B grant/session reused. It is for visual QA, not installing new binaries on the Owner PC. Moryqa file is editable; STOCK and old designs remain untouched.

## Validation and next step

Check native state projection and transition bounds, empty-directory cleanup with an unrelated-file canary, exported design geometry and fonts, actual Windows wizard/uninstaller views, and unchanged full installed lifecycle/ConPTY/bridge/watchdog recovery. Update the one Master Checkpoint, rolling Handoff and Worklog atomically at each milestone. Keep source implementation, CI_PASS, deployed backend and Owner physical acceptance distinct.
