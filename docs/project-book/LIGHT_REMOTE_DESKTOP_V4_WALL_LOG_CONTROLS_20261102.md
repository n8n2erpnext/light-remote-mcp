# Desktop V4 — Open Wall + Activity Logs source handoff (2026-11-02)

## Owner decision / UI
Owner accepted screenshots of V4's 9 existing Light-theme routes on actual Windows and requested only **Activity Logs and Open Wall**, without new Figma frames. Keep existing 9 routes, typography, spacing, Light/Dark/System variants, sidebar. Two incremental controls:
- Header Open Wall button. In Tauri native, invokes one fixed OS-browser launcher, always the **same device** \`http://127.0.0.1:5491/\`; supports Windows/macOS/Linux default browser. Not a new Agent, account login, or remote Wall selection.
- Settings > Activity Logs card. Shows exact retention presets and bounded limits. If a same-origin authenticated Owner Wall session returns \`GET /api/activity/logs/state\`, display only safe log preset/disk/RAM counters; otherwise show **unverified** with no fake values. CTA opens \`http://127.0.0.1:5491/settings#activityLogSettings\` in default browser for history/clean/rotation. The desktop app does NOT modify logs or transfer Owner cookies/CSRF; only the authenticated Local Wall handles Owner mutation.

## Security implementation
- \`client/desktop-v4/src/lib/open-wall.ts\`: exact IPC \`open_local_wall\`, view \`home|logs\`, fail-closed in browser preview; native command does not accept user URL/path or credentials.
- \`client/desktop-v4/src-tauri/src/main.rs\`: only native command \`open_local_wall\`, switch on exact \`home/logs\`, literal localhost:5491 URLs; default-browser launcher per OS. No shell interpreter, arbitrary command, privileged plugin, Owner approval, session, Agent or filesystem operation.
- \`client/desktop-v4/src-tauri/build.rs\`, \`permissions/open-local-wall.toml\`, \`tauri.conf.json\`: explicit custom app-command permission for main window only; no core default, FS/shell plugins or broad grants.
- \`client/desktop-v4/src/lib/local-logs.ts\`: fail-closed read-only Owner Wall log status. Same-origin credentials, no auto redirects or cross-site proxy, strict response projection, ignores returned local filesystem path/secret/event content.
- In native Tauri the WebView is NOT the Owner Wall origin; direct log status should remain unverified (normal) and Open Wall CTA is the working action. When V4 shared frontend is hosted on authenticated Wall origin in future, same-origin summary can be populated. Do NOT claim desktop app now has an authenticated cross-origin log bridge.
- Target \`127.0.0.1:5491\` is official Agent default Wall port. Custom ports are not discovered yet and require a separately reviewed native Agent status bridge, not a user-controlled URL field.
- Local Log store and Clean remain owned by GoldABV2 Local Wall code, deployed earlier only to the isolated Lab; Windows/macOS/Linux client release with log module is an independent future task. Native pilot does not itself persist a second log.

## Validation and remaining gates
- Code branch: \`feat/desktop-v4-wall-activity-20261102\` from \`3a408718\`. Build/test ONLY GitHub Actions hosted runners, no npm/cargo/Playwright build on VPS-ARM.
- Unit tests cover Owner log read failure, safe data projection, native fixed view and no arbitrary bridge, Settings and header buttons; native-shell security test updated to allow only one explicit IPC, not general FS/shell/Agent.
- GitHub CI \`.github/workflows/desktop-v4-native-ci.yml\` extended to feature branch.
- Until exact new commit's GitHub CI and physical Windows native execution are independently verified: CODED SOURCE only, **NOT** native accepted/released.
- No design freeze of V4's other Figma frames, no Gold UAT or installed WinForms replacement.

## 2026-11-02 FINAL OWNER UI FREEZE + CI ACCEPTANCE
- **Owner decision:** "ok UI mới build chốt rồi" — approve and FREEZE current Desktop V4 UI baseline with nine original screens plus header Open Wall and Settings Activity Logs. This is OWNER UI DESIGN approval; do not require additional Figma design work for these additions and do not automatically redesign navigation/themes/typography.
- **Frozen implementation source:** \`73d448e969e8c653b390ba6a27d65d31e57aa11e\` on \`feat/desktop-v4-wall-activity-20261102\` (future docs-only commits do not change baseline).
- **GitHub CI verified:** https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41472068915 — completed SUCCESS, four jobs: Web build/tests/Chromium screenshots, Windows Tauri 2, macOS Tauri 2, Linux Tauri 2 all SUCCESS.
- **Acceptance boundary:** UI visual/build baseline approved. Native installed/Owner-click physical Open Wall E2E, local Agent log module deployment to Windows/macOS/Linux, and authenticated Owner backend/session/module bridges are still distinct OPEN integration gates. Never state these are production-ready based solely on CI.
- **No production cutover:** Windows WinForms existing client and Gold UAT/production untouched. Only new native test binaries/artifacts emitted by CI.
- **Next:** connect V4 to authenticated device/Owner contracts incrementally, preserving frozen layouts; use approved small design changes only if functional integration requires them.
