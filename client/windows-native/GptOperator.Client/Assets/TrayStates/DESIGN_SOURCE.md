# Moryqa → Windows Tray V3 integration (2026-10-31)

Source: connected **Moryqa Studio MCP for Figma**, file **Light Remote - Logo - UI/UX**, page **Light Remote UI/UX**. This is read-only design extraction and Windows client source implementation; no Figma nodes were edited.

## Verified Figma sources

- `assets/shared/tray/icon-state-variants-v2` (`2516:707`): five exact source vectors `2516:708` Connected, `2516:711` Disconnected, `2516:714` Dormant, `2516:717` Unlinked, `2516:720` Stopped. SVG exported via Moryqa into its ARM-hosted runtime, copied from Docker `moryqa-moryqa-1:/app/outputs/assets` into `Assets/TrayStates/*.svg`. Pure native librsvg/Cairo rendered PNG 16/32/128 (no reinterpretation of glyph paths); 32px variants embedded in Windows self-contained EXE. Fallback icons are not substituted.
- `sections/windows/installer-uninstaller-v2` (`2516:768`), children `windows/installer/wizard-v2` (`2516:771`) and `windows/uninstaller/flow-v2` (`2516:830`). Source copy: **Install Light Remote**, **Your desktop, available to your AI**, **Per-user installation**, **Run at Windows sign-in**, **Create desktop shortcut**, **Remove Light Remote?**, **Keep device identity**. Existing AppId, per-user privilege and identity preservation left intact. Desktop shortcut now checked by default. Inno Setup modern wizard detects the same Windows AppsUseLightTheme preference and styles its main surfaces/labels in dark mode; default Windows-native light appearance otherwise.
- `sections/tray-v3/01-core-states` (`2530:2`) exists but returned **no child layers** from the Moryqa page at integration time. The accessible related dark connected reference `screens/tray-v3/windows/01-connected` (`2530:3`) contains a 500×740 popover with header, status, overview, authorized sessions, quick access, short ID/authorization and footer, implemented in `TrayPopoverForm.cs`.
- Requested `screens/windows/tray-v3-light/01-connected-multi-session` was **not found** in the selected Figma page/tree. Do not claim pixel-perfect implementation of that exact frame. Native light variant uses verified tray-v2 light palette from `sections/windows/tray-v2` plus the dark V3 structure. On next owner-visible Figma file/page selection, re-extract the missing frame and compare typography/spacing/layout before final signoff.

## Runtime contract

- Left-click Windows NotifyIcon: native 500×740 popup following the Figma V3 dark reference; right-click: existing native context menu with all advanced actions (safe rollback path); double-click: Open Local Wall.
- Colors are computed from the current **Windows user** `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\AppsUseLightTheme`, default light if unavailable. Dynamic update occurs when the tray popover/menu is reopened; no separate theme config or forced dark UI.
- Logo status colors use original five Figma vectors, not an extra overlay dot. Relink hidden while connected; Link/Relink remains on native actions where eligible.
- The Agent local `status` feed does **not** expose a signed list/count of authorized agent session nicknames. Therefore the sessions section directs to authenticated Local Wall and **never fabricates session count** or short ID. Source can later adopt exact screen's multi-session UI after the backend publishes an authenticated session summary.
- No change to A/B authorization protocol, active device jobs, permissions, or account identity. No runtime installation/restart on the owner's Windows 10 while Figma session is in progress.

## Validation and release

- Source regression `deploy/scripts/selftest-windows-moryqa-tray-v3.mjs`: Figma icon PNG signatures/sizes, embedded resources, Windows auto Light/Dark, native popup and menu fallback, relink visibility, installer defaults and stable AppId.
- Windows GitHub Actions `windows-native-client.yml` runs the new source and RM V2 visual recovery tests; native .NET 8 x64 build and Inno Setup compile must PASS before treating a binary as accepted.
- RM V2 native-lease Frame fix from previous turn included with this client candidate (`lib/rmv2-visual-lease-recovery.mjs`, `device-agent/operator-agent.mjs`, `lib/native-desktop.mjs`); may be tested in the same Windows artifact but physical repeated-Frame on Windows 10 remains a separate acceptance.
