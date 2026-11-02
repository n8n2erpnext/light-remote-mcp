# GoldABV2 Wall R3 — PTY live renderer and full-width feature pages

Target: isolated GoldABV2 Lab only; branch feat/gold-single-owner-transfer-20261101, prior live R2 source 2856faf9. Maintain protected existing GPT-6/other Agent grants, production/main Gold UAT untouched.

## PTY root causes
Old PTY Viewer had to wait for manually selected terminal; list fetched after opening, output only fetched after selection. It stripped ANSI escape sequences and CR and accumulated output as preformatted plain stdout; refresh interval 1500ms. This was not a proper terminal screen.

## Implementation
- Local vendor @xterm/xterm 6.0.0 UMD JavaScript + CSS and @xterm/addon-fit 0.11.0, original MIT licenses. Files in assets/vendor/xterm, no runtime CDN, no Google host.
- Local Wall serves only allowlisted static assets under /assets/vendor/xterm; tight content-types and nosniff, no source-map or arbitrary paths.
- Homepage loads xterm + FitAddon from same origin; terminal viewer is still owner-only/read-only: PTY session/output API auth checks intact; disableStdin true; no new POST, input, device, capability or grant operations.
- Auto-select newest available running PTY on opening, then fetch current bounded terminal output immediately. Reader poll 500ms vs 1500ms; list reconciliation 3500ms; per-terminal output cursors, revision gates, no overlapping PTY output calls.
- Interpret ANSI/VT, CR, colored prompts, command echo and screen controls through xterm.write (not ptyPlain); bounded 3000-line scrollback and existing backend 32768B read cap preserved.
- Drag/minimize/restore preserved, use fit addon on opening and resizing. Content remains client-side and never embedded in server-side Wall HTML.
- CLI agent can still read/write/resize PTY independently; Wall remains observation-only.

## UI layout
- Keep Wall as first link in persistent left sidebar. Remove redundant Back to Wall from Long Memory/Codex Home template routes; remove Wall and Back to Wall inner links from other feature pages (but preserve other action buttons).
- Settings, Permissions, Approve B and Processes expand to available width to the right of sidebar as Codex/Long Memory; no centered fixed 640/950px container. Responsive width follows sidebar collapse; no external font or icon services.

## Acceptance tests and limitations
- New selftest-gold-wall-pty-terminal-r3.mjs checks vendor assets and licenses, HTTP static routes, self-host CSP-compatible script, 500ms polling, signed owner read-only PTY, 6 Wall route HTML/JS rendering, sidebar-only return navigation and wide CSS.
- Existing G2 PTY auth/bounded-output regression, Wall navigation, A/B V1 denial, B approval, Owner Close and source/doc guard remain mandatory.
- Browser-specific actual xterm visual alignment and PTY playback may require Owner screenshot; no Chromium/Playwright installed on VPS-ARM; do not claim pixel-perfect browser acceptance before checked.

## Rollback
Create separate LXD snapshot and exact Wall drop-in backup before Lab-only cutover. Revert to old source-2856faf9-wall-r2-STAGED and restart only Wall. Do not revert database state or expire grants for visual testing.

## Same-origin CSP correction after live smoke
Live static asset URLs returned HTTP 200 after fixing stage folder xterm permission (0755 traverse, files 0644). Browser CSP originally allowed only inline script/style and blocked same-origin vendor libraries. Add 'self' alongside existing 'unsafe-inline' to script-src and style-src, preserving anti-framing, connect-src, form-action and no arbitrary remote hosts. Add desktop-wide xterm screen overflow/layout override, not only mobile media rule. R3 test now checks CSP response headers on all six routes.
