# Light Remote Desktop V4 — shared React frontend (pilot)

**Status:** Source build and unit/UI tests pass on VPS-ARM. The UI is not released, is not the installed Windows tray client, and is not an authenticated Owner grant frontend. Do not deploy by replacing the existing Local Wall or WinForms binary.

## Why this package exists

Owner's 2026-11-01 design direction is a **shared React + TypeScript + Tailwind/shadcn-style UI** for Desktop and browser Wall, with Tauri 2 as a **separate technical spike** for native shell. The current WinForms Agent, Local Wall and Gold backend remain authoritative and unchanged.

This package is an independently buildable implementation proof against the Figma V4 AI Access design and its two tested responsive layouts. It reuses the official `assets/branding/light-remote-mark.svg` from this repository, Google Sans Flex if legitimately installed on the host (otherwise system fallbacks), and Lucide icons. It does not copy unverified third-party Figma kit assets or font binaries.

### Figma mapping

| V4 key | Light | Dark | CSS |
|---|---|---|---|
| AI Access wide | `55:5880` (1280×800) | `55:6030` (1280×800) | `>1199px`: two columns |
| AI Access compact | `55:5955` (1024×1024) | `55:6127` (1024×1024) | `<=1199px`: stacked |
| Original full Figma screen | `44:1735` | `44:1736` | source only, not modified by code |

Canonical design manifest (VPS-ARM only): `/home/ubuntu/handoffs/LIGHT_REMOTE_WINDOWS_V4_DESIGN_MANIFEST.md`.
Approved theme structure: Light Clean Minimal and Dark Carbon Gold, no third Hybrid mode. This UI is a pilot; its CSS breakpoint and 840px small-screen nav are implementation hypotheses, **not owner Design Freeze evidence**.

## Implementation scope

- Nine accessible sidebar routes: Overview, AI Access, Sessions, Live Monitor, Devices, Long Memory, Codex Bridge, Account, Settings.
- AI Access: real layout/components, responsive two-column/stacked, reviewed labels, owner approval disabled, no synthetic A/B request or lease.
- Overview: conservative summary with only genuinely verified local device data; unknown session/approval values stay “—”.
- Settings: working local Light/Dark/System selection; does not grant OS/Agent permissions.
- All other routes: explicit, safely unavailable feature/permission contracts; do not imply code has implemented Owner flows.
- Read-only Local Wall API adapter in `src/lib/status.ts`: GET same-origin `/api/status`, no proxy, no mutation, `credentials:'same-origin'`, `redirect:'manual'`. It validates JSON and `ok:true` with `local`, retains **only** `deviceName`, `cloudState`, `cloudDesiredConnected`; secret, session and plan fields are not serialized into the view. Requires both fields for connected/disconnected classification.
- Polls device status every 15 seconds while visible, refreshes on visibility and offers an explicit refresh action; failures show unverified rather than retaining old connection state indefinitely.
- No browser Owner approval call, native privileged IPC or account identity is invented. Review Owner requests button **always disabled** until authorized signed contracts and feature gates exist.
- Uses hash routing to avoid requiring Wall-server rewrite routes.

## Build / tests

```sh
cd client/desktop-v4
npm ci
npm run build       # TypeScript typecheck and Vite production bundle
npm test            # Vitest: route, fail-closed status, rendered UI/interaction
npm run dev         # 127.0.0.1:5174 only. No Local Wall proxy.
```

The development server is intentionally unauthenticated and does **not** proxy to private Local Wall endpoints. The view will display “Device state not verified” until legitimately hosted in the **same origin** as an authorized Wall or connected via a reviewed native bridge. Never set up a cross-origin shortcut with Owner cookies.

## Security and outstanding gates

| Feature | Backend evidence | V4 status |
|---|---|---|
| Local device read-only status | existing Local Wall `GET /api/status` | **UI source-wired**, only when same-origin Wall actually hosts bundle; no live E2E yet |
| Owner A/B V2 pending/approve | Owner login+CSRF; SQL043 gated in current Gold checkpoint | **DENIED/disabled**, no frontend mutation |
| Agent session list/close | authenticated Local Wall session contracts | **MISSING typed adapter**, no close command |
| Link/Relink device | Local Wall enrollment begin/poll, Owner verification | **MISSING scoped UX/IPC**, no mutation |
| Plan/quota/usage | server verified totals required | **MISSING**, no invented values |
| Real-time monitor and job cancel | signed evidence and permission gates required | **MISSING**, no fake status |
| Memory/Codex modules | local module lifecycle and owner scope | **MISSING scoped adapter** |
| Native host and update/recovery | installed WinForms/installer remain | **Tauri 2 POC pending** |

**Do not ship or replace** Windows rc.49/Gold UAT from this package. It does not listen on privileged ports, spawn/stop Agent, migrate SQL, or mutate owner grants. A Tauri v2 adapter will need audited allowlisted IPC and cross-OS lifecycle tests before attaching this UI to any native host. No new Owner API should be enabled from this UI package alone.

## Required acceptance before promotion

1. Live authenticated Wall read-only status contract fixture + repeated offline/reconnect behavior.
2. Security review for native IPC / Owner cookies / CSRF; signed grant E2E before AI Access becomes actionable.
3. Visual screenshot comparisons at 1280 and 1024, both themes; intermediate and narrow widths.
4. Physical Windows 10/11 100/125/150/200% DPI, macOS WebKit, Linux WebKitGTK and Linux headless Wall browser.
5. Complete Figma mapping and owner review of all 16 primary screens + safety state flows, then release-gated cutover from WinForms.

## Native shell / CI-only build policy — 2026-11-01

Owner requires **GitHub Actions runners for all native and browser builds**, not VPS-ARM SSD. Workflow: `.github/workflows/desktop-v4-native-ci.yml`, triggered on V4 branch pushes or manual dispatch. VPS-ARM is only the authenticated SSH Git source control endpoint, for small source/docs/handoff and QA evidence; do not run `cargo build`, Tauri release, `npm ci`, Chromium downloads or install software on the VPS in follow-up coding sessions.

CI workflow uses Node 22 and a scoped npm lockfile, Vitest (15 checks), headless Chromium visual tests at 8 theme/breakpoint combinations and isolated Tauri 2 **no-bundle UI-only native executable** builds on Windows/macOS/Linux GitHub-hosted runners. UI screenshots and short-lived unsigned test binaries are GitHub Actions artifacts. No rollout to existing Agent/Wall or Gold UAT is authorized.

The first ARM `cargo check` passed on 2026-11-01, but the subsequent local release build was explicitly stopped on owner's instruction; ARM-specific target cache and temporary V4 dependencies were removed. This is **not** physical native GUI acceptance. Native Tauri capabilities default to empty and Rust has no privileged commands/plugins; Owner/API mutations remain disabled.

Never copy GitHub CI binary onto owner's real device without separately confirming security, signed API boundary, physical DPI and release gates.

## Windows screenshot review: correct fonts and distinct feature layouts

The first native screenshots exposed two gaps now corrected in the source: slider-styled Settings icons instead of the Figma toothed gear, and six generic access placeholder pages. `src/FeatureScreens.tsx` now provides distinct Sessions, Live Monitor, Devices, Long Memory, Codex Bridge and Account structure while leaving all unauthenticated/privileged controls disabled. `src/styles.css` imports the Git-tracked `assets/fonts/web/GoogleSans-Variable.ttf` directly into the Vite output. This is the internal **Google Sans** variable font, not a verified exact separately named **Google Sans Flex** binary. See `licenses/README.md` and SIL OFL. Chromium CI verifies the font resource was actually loaded (not the Windows fallback) and captures screenshots for 8 responsive AI Access sizes/theme variants plus 12 route-theme specimens. Do not compile/install on VPS-ARM; use GitHub Actions.

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
