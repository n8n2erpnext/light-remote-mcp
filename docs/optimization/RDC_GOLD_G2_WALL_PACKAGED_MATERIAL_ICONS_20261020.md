# Gold G2 — Windows Local Wall missing packaged Material SVG RCA
Date: 2026-10-20 | Gold branch feature/light-remote-gold-rebuild-20261018

## Actual owner screenshot and installed Windows log
New Windows screenshot at http://127.0.0.1:5491/ shows HTTP JSON:
`{"ok":false,"error":"unknown_material_icon:dragIndicator"}`.
Owner-supplied installed AgentHost log at 2026-10-20 04:02 UTC includes:
`{"event":"local_wall_request_error","method":"GET","route":"/","error":"unknown_material_icon:dragIndicator","headersSent":false}`.
This is **not** a connection refusal now: Local Wall HTTP server is responding, but the HTML render fails due to missing icon asset. Previous G2 ERR_HTTP_HEADERS_SENT crash guard did work: the renderer error is now visible and Agent remains alive to return JSON. Device enrollment 404 is a separate prior incident.

## Precise packaging root cause
- `device-agent/local-wall.mjs` renders `materialIcon('dragIndicator')` in the PTY Viewer, also `minimize` and `maximize`.
- `lib/material-icon.mjs` maps to `drag_indicator.svg`, `remove.svg` and `open_in_full.svg`. All exist in repo source.
- `client/core-files.json` explicitly lists staged files, but omitted **seven** existing Material SVG assets: `drag_indicator.svg`, `expand_more.svg`, `groups.svg`, `mark_email_unread.svg`, `notifications.svg`, `open_in_full.svg`, `remove.svg`. Thus bundled Windows `agent/assets/icons/material` lacks the file needed to render the root page; source-root tests erroneously PASS.
- `deploy/scripts/stage-client-core.mjs --verify` only verifies *listed* files, so missing *unlisted* assets were invisible. The previous Windows CI ran `selftest-g2-wall-headers-sent-crash.mjs` from source, so it could not detect this installed-package error.

## Reproduction (RED) and fix (GREEN)
RED: stage old 72-file package; run `node deploy/scripts/selftest-packaged-local-wall.mjs /tmp/hosted-wall-bundle-red`. It exits 1 with **exact** `unknown_material_icon:dragIndicator` in staged `lib/material-icon.mjs`. No owner device changes.
Fix:
1. `client/core-files.json`: explicitly add the seven missing SVG assets.
2. `deploy/scripts/selftest-packaged-local-wall.mjs`: compare all 39 repo Material SVGs with actual staged/installed package; resolve 18 Wall icon aliases using **package's own** material icon module; launch **package's own** local-wall module with ephemeral localhost port, GET /, /permissions, /approve, /settings (HTTP 200), and GET /api/status (HTTP 200, ok:true).
3. Wire smoke into Windows native runtime stage, full installer **post-install**, compact installer **post-install**. macOS/Linux package contract steps also execute same smoke on their packaged core.

GREEN observed on VPS-ARM: core files 79, digest `5220aeb5ab13a936f403e2730602ebcae759bd0336a5a5ac4add9eaa34483be0`, `--verify` PASS, asset parity 39/39 PASS, aliases 18/18 PASS, all four Wall pages + API 200 PASS. Prior G2 response guard and Local Wall auth tests PASS.

## Boundaries and acceptance
- Changes only manifest, packaged-runtime selftest, CI workflows and documents. **No changes** to Windows Gold endpoint, Wall port 5491, Agent service, auth, enrolled device state, updater channel or production.
- Source and staged simulation already PASS. Windows/macOS/Linux hosted CI results must be checked after push before calling downloadable artifacts PASS.
- Owner must install *new* Gold UAT Windows artifact and verify UI of `http://127.0.0.1:5491/`. The prior #433 installer remains broken and cannot be fixed by refresh, because missing SVG must be installed.
- If login/enrollment issues persist, handle `device_binding_not_found` independently. G2 IN PROGRESS; G1 upstream admission refusals separately unresolved. Preserve unrelated untracked Gold UAT fixtures.
