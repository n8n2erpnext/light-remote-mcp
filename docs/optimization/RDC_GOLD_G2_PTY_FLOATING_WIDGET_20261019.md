# Gold G2 — Floating PTY Viewer + offline Material icons (2026-10-19)

## Scope, owner request and boundaries
- Owner requested Messenger/chatbot-style draggable PTY viewer on Wall, corner launcher, minimize/close, resizing, and visible Back Wall/PTY SVG icons. Use Google Material icons **bundled offline**. Requested after screenshot of functional but oversized modal on Gold NetBird Wall.
- Scope: branch `feature/light-remote-gold-rebuild-20261018`, starting HEAD `0fe3404`; **Gold LXD only**. No changes to production Wall/Plugin/API, PostgreSQL, Redis, enrollment, PTY permissions, shell execution, or transport.
- G1 unknown upstream pre-dispatch denials remain `UNRESOLVED` per `RDC_G1_UNRESOLVED_REFUSALS_20261019.md`; do not use PTY as a bypass. G2 remains IN PROGRESS (process/PTY lifecycle and cross-OS still outstanding).

## Source changes
- `device-agent/local-wall.mjs`: PTY UI switched from center modal blocking entire page to independent non-modal floating panel anchored near bottom-right. A floating terminal-icon launcher toggles it. Header has terminal icon, drag indicator, refresh, minimize/expand and close icon controls. Native CSS `resize:both` handles sizing. Pointer events drag panel on header, skip control buttons, clamp to viewport, and maintain keyboard Escape support. Mobile viewport clamps coordinates. No additional JS dependencies.
- `localStorage` stores **only** safe layout values: `left/top/width/height/minimized`, not PTY output, commands, IDs, tokens or grants. Restore geometry after reload. When minimized, stop polling and clear output; when closed, clear output and hide the panel. Panel output remains bounded and requires a manual terminal selection after expansion.
- Same Wall JS retains existing authenticated, read-only PTY API and Agent-local PTY limitation. Operator-local PTYs are explicitly out of scope; no invented results.
- `permissionsPage`: Back to Wall now has a visible, properly sized local `arrow_back` icon via scoped `.btn .mi` CSS and flex alignment. No external icon runtime fetch.
- `lib/material-icon.mjs`: adds aliases for bundled `remove`, `drag_indicator`, and `open_in_full` SVG files; existing `terminal` and `arrow_back` reused. See `assets/icons/material/README.md` for source paths/licensing.

## Test evidence — source and browser
- Existing `deploy/scripts/selftest-g2-wall-pty-viewer.mjs`: PASS, authenticated endpoint, no output in initial HTML, bounded PTY cursor.
- Existing `selftest-v09-local-wall.mjs` and `selftest-v09-local-wall-auth.mjs`: PASS.
- New `deploy/scripts/selftest-g2-wall-pty-floating-widget.mjs`: **Chromium headless PASS** on a test-only authenticated local Wall: local Back SVG bounding box, PTY launcher icon, nonmodal widget, live pointer drag, native resize CSS, background Wall filter remains interactive, fixture PTY view, minimize stops polling, reopen, layout persists across browser reload without transcript, viewport reduced to 375x700 while widget remains within bounds. Chromium supplied from machine's preinstalled Playwright; script explicitly SKIPS (not PASS) if Playwright/binary absent.
- `node --check` on changed runtime files and `git diff --check` PASS. Material aliases all render inline SVG from local files; code contains no Google CSS/CDN references.

## Live Gold-only deployment
- Copied only `device-agent/local-wall.mjs`, `lib/material-icon.mjs`, and 3 new SVGs to existing `light-remote-gold-uat` LXD path `/opt/light-remote-gold-uat/`, preserved `gold-uat:gold-uat` file ownership. Restarted **only** `light-remote-gold-wall`.
- In-container icon import smoke: `G2_GOLD_INLINE_ICONS=PASS` for `arrowBack, terminal, minimize, dragIndicator, maximize`.
- Gold LXD PostgreSQL, Redis, Operator, Plugin, Wall: **5/5 active** after restart.
- `http://100.94.184.141:5591/` -> HTTP **303** (NetBird Gold Wall auth redirect), unauthenticated `/api/pty/sessions` -> **401**, Gold Preview `/account` HTTPS **200**, production HTTPS **200**.
- Browser checks were on authenticated **fixture Wall**, not an authenticated real Gold Wall user session. Owner manual browser check on Gold remains acceptance follow-up; production Wall `wall.dashboard.thaiduy.store` was **not** changed.

## Rollback and next checkpoint
- Revert this patch on Gold branch and restore the previous three affected Gold runtime files plus 3 new SVGs; restart only Gold Wall. No DB migrations or authority changes.
- Continue G2: spawn/exit/cancel/timeout and PTY lifecycle across supported OS, then G3 readiness, G4 idempotency, G5 SCP progress visible on authenticated Wall, G6 soak. Do not treat a floating viewer as complete G2 acceptance.
- Existing untracked `deploy/gold-uat/` and UAT scripts were left untouched.
