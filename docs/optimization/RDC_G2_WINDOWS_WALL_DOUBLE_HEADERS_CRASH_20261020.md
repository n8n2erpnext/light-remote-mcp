# Gold G2 — Windows Local Wall 5491 crash / ERR_HTTP_HEADERS_SENT
Date: 2026-10-20. Branch: feature/light-remote-gold-rebuild-20261018. Gold client UAT only, production unchanged.

## User evidence (Windows 10, Admin; native Windows build based on earlier Gold source)
User supplied screenshot of Chrome `http://127.0.0.1:5491/`: `ERR_CONNECTION_REFUSED` and native AgentHost log entries from 2026-10-20 02:43 through 03:41 UTC. Repeatable sequence:

1. `agent host started`, followed by `local_wall_started` on port 5491 and `device_agent_started`.
2. On subsequent request, process throws `Error [ERR_HTTP_HEADERS_SENT]: Cannot write headers after they are sent to the client`, at Node `_http_server:354`, then `json()` in `device-agent/local-wall.mjs:16` and the top-level route catch in `local-wall.mjs:443`. The Agent child exits `code=1`.
3. AgentHost restarts Agent; same fatal error recurs. This explains the browser's connection refusal when the process is down, *not* a missing Wall feature or a proven firewall/Gold endpoint failure.
4. Separately, later log reports `device_removed_remote` reason `device_binding_not_found` (HTTP 404), followed by startup with deviceId null. This is an enrollment/Gold account binding symptom, distinct from the double-header exception, and may need a new enrollment after crash is fixed.

### Causal classification
Proven secondary fatal exception: the route's outer `catch` attempts `json(res,...)`, even if the response already sent headers. Prior code on HTML GET routes executed `res.writeHead(200,...)` **before** evaluating `wallPage(...)`, `loginPage(...)`, `approvePage(...)`, `permissionsPage(...)`, and `updateSettingsHtml(...)`. When rendering throws, the outer catch tries another header => fatal `ERR_HTTP_HEADERS_SENT` and Node exits. **What originally threw inside the render is UNKNOWN**, because the old catch discarded that exception when it attempted the second response. Do not claim endpoint mismatch caused this exception.

## Minimal Gold source patch
- `device-agent/local-wall.mjs`: calculate HTML content completely first, then call `res.writeHead(200/...)` and `res.end(html)` for Wall, login, approve, permissions and settings routes.
- Route-level catch now logs a redacted method + pathname (no URL query/body) and original error code/message under `local_wall_request_error`, with `headersSent`. If headers already went out, close the response safely without attempting a second header; otherwise preserve existing JSON error behavior.
- No changes to Wall port (5491), Hub/Bridge Gold endpoint, user identity, updater, production runtime or unrelated Gold G2 features.
- `deploy/scripts/selftest-g2-wall-headers-sent-crash.mjs`: deterministic mock auth identity failing during page rendering at the specific point where old code sent headers too early; expects JSON failure but no process crash, subsequent Wall HTTP 200 and `/api/status` 200. This RED case would previously crash with `ERR_HTTP_HEADERS_SENT`.
- Windows CI `.github/workflows/windows-native-client.yml` now runs this fixture during native bundled smoke to guard future installers.

## Validation
Gold source Linux ARM64: `selftest-g2-wall-headers-sent-crash.mjs` 3/3 PASS; `selftest-v09-local-wall-auth.mjs` PASS; `selftest-g2-wall-pty-floating-widget.mjs` Chromium PASS; `node --check` and `git diff --check` PASS. **Windows CI and installed Windows Wall acceptance remain pending until source is pushed/build finishes.** This is not proof that the unknown original renderer exception has disappeared, only that it can no longer kill the Agent by double-sending headers and can now be diagnosed from original error logs.

## Handoff
1. Commit/push only the above 3 source/test/workflow files and this checkpoint; preserve untracked UAT files.
2. Confirm Windows CI build source commit SHA, native smoke and downloadable artifact.
3. Install the updated Gold UAT Windows artifact through authorized owner testing; verify Wall 5491 survives opening '/' and login and repeated requests. If it emits `local_wall_request_error`, inspect the original logged error + exact route rather than reclassifying `ERR_HTTP_HEADERS_SENT`.
4. Investigate `device_binding_not_found`/Gold enrollment separately if it persists. G2 remains IN PROGRESS; G1 intermittent upstream refusals remain separately UNRESOLVED.
