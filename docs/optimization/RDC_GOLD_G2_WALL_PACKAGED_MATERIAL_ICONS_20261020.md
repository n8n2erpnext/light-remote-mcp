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

## Hosted CI acceptance after fix
- Windows Gold source commit `395270b06124b1893c66d19cc02fac12fa6afad3`, [Windows Actions #436](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39372493947) **completed SUCCESS**.
- Confirmed by reading complete Windows job logs: `PACKAGED_WALL_ASSET_PARITY=PASS`, `PACKAGED_WALL_ALL_REQUIRED_ICONS=PASS`, `PACKAGED_WALL_RENDER_AND_API=PASS`, `windows-full-installed-wall-assets=PASS`, `windows-compact-installed-wall-assets=PASS`. The Windows full and compact installers were installed and their own bundled Local Wall modules executed page/API smoke successfully.
- SHA-scoped downloadable artifact, not expired: `light-remote-windows-x64-395270b06124b1893c66d19cc02fac12fa6afad3`, ~328 MB as GitHub artifact envelope. The prior #433 artifact is missing Material assets and must NOT be reused.
- Linux Actions #273 briefly failed because CI tried executing bundled ARM64 Node on hosted AMD64 runner (`Exec format error`), **not** because icons were missing. Follow-up commit `70c92f6` changed Linux/macOS packaged Wall tests to execute their packaged JavaScript modules with the runner's native Node; Linux [#274](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39372661941) x64+arm64 SUCCESS and macOS [#234](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39372661896) x64+arm64 SUCCESS.
- Windows #436 remains tied to its exact source SHA `395270b`; docs/CI-only `70c92f6` does not alter Windows packaged assets. Final Gold branch HEAD after handoff update is newer than this artifact.
- No installed owner Windows machine was modified by these CI steps; real device acceptance at `127.0.0.1:5491` still needed after Owner installs #436. Production was not updated.
