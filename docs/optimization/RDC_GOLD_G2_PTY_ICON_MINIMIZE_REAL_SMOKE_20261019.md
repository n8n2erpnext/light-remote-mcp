# Gold G2 — Icon / minimize regression and real PTY output (2026-10-19)

## Source and cause
- Branch: `feature/light-remote-gold-rebuild-20261018`; starting HEAD `eb692cb`. Device: owner-approved Gold LXD Agent; production untouched.
- Owner screenshot on Gold Wall showed gray solid squares after the `read only` label (drag icon) and in the minimize button. Previous UI test only checked CSS `minimized` class, not the actual panel dimensions.
- **Root cause verified in source:** `lib/material-icon.mjs` globally replaced the *first* `fill="..."` found in each SVG with `fill="currentColor"`. Google's `remove.svg` and `drag_indicator.svg` both start with a decorative backdrop path `fill="none"`; this was incorrectly repainted solid, obscuring actual glyphs.
- **Narrow fix:** set `fill="currentColor"` only on the outer `<svg>` tag while preserving all descendant paths and explicit `fill="none"`. This is a shared MaterialIcon helper fix; no CDN, extra font or SVG rewriting required.

## Regression and Gold live deployment
- Updated `deploy/scripts/selftest-g2-wall-pty-floating-widget.mjs` Chromium test: assert SVG background child retains `fill=none`; minimize must physically reduce the panel height below 100 px and less than half the expanded height, then expand returns to original full height. Existing drag, restore, mobile viewport and privacy checks still PASS.
- Also PASS: `selftest-g2-wall-pty-viewer.mjs`, `selftest-v09-local-wall-auth.mjs`; syntax and `git diff --check` PASS. An intentional invalid-login event from auth fixture can appear in stderr and is expected.
- Deployed **only** new `lib/material-icon.mjs` to `light-remote-gold-uat`, retained `gold-uat:gold-uat`, restarted only `light-remote-gold-wall`. In-container icon smoke confirmed the foreground and untouched transparent backdrop for minimize/drag/expand.
- Gold Wall NetBird returned HTTP 303 (login redirect); Gold Preview account HTTP 200; production HTTP 200; Gold Wall systemd ACTIVE. This is live service/API evidence, not a browser screenshot captured from owner's authenticated Wall.

## Real PTY smoke through official Gold MCP
- Reused the already owner-authorized Gold MCP session and created a new **real Bash PTY** in `/opt/light-remote-gold-uat`; PTY remained RUNNING to let owner inspect the Viewer.
- Sent three benign sequences through normal governed `light_remote_terminal_input`: (1) `printf` banner, (2) `uname -srm` and `pwd`, (3) 4 progress outputs with one-second intervals.
- `light_remote_terminal_output` returned all echoed commands and expected text (`Linux 7.0.0-1012-oracle aarch64`, `/opt/light-remote-gold-uat`, progress 1/4..4/4), 704 bytes. `light_remote_list_terminals` returned the new Bash PTY `running`, `outputBytes=704`. No destructive commands or secret payloads.
- **Owner action:** on NetBird `http://100.94.184.141:5591/` hard-refresh (Ctrl+F5), click floating PTY launcher → Refresh terminals → select running Bash. Terminal may disappear after Agent restart/expiry and will not be silently recreated; if absent start new authorized test terminal.
- A new `light_remote_session_control` pre-dispatch refusal occurred and the exact same ordinary call succeeded on the next attempt, without PTY, device switching or local policy changes. Remains an unresolved G1 provider-side observation, **not** a regression in PTY engine.

## Next milestone
G2 remains IN PROGRESS: process/PTy lifecycle cross-platform, timeout/cancel and buffering. G3–G6 not started. Gold only. Don't claim production deployment or fully complete G2.