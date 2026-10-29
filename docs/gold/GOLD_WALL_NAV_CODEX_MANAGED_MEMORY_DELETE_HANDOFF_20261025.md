# Gold Wall navigation, managed Codex and Memory deletion — UAT handoff

Branch: `feature/gold-navigation-codex-managed-memory-delete-20261025`
Base: `b91d7fcda693aec79dee6e9696d253fc69410384`.
Production and running Gold UAT are not modified by this source branch.

## UI
- Device Wall / remains a compact operator/activity view.
- Local Material SVG icons already bundled in `assets/icons/material` via `materialIcon`; no Google runtime dependency.
- Toolbar /long-memory and /codex-cli with ON/OFF indicators reflecting module flags.
- Each dedicated route keeps module settings and content on its own page; the other module is hidden.
- Current profile on Device Wall is one link to /permissions; the detailed capability list stays on /permissions.
- /settings includes a Long Memory deletion card with local/account modes and explicit confirmation.

## Optional device-managed Codex Runtime
- Codex Bridge is optional, independent from Long Memory.
- Enabling the Bridge does not automatically download or execute Codex.
- Owner action installs official `@openai/codex@latest` from `https://registry.npmjs.org/` under the Gold device data folder, non-global, npm ignore-scripts.
- Installer runs in an isolated staging directory. Success requires the native runtime binary before commit of the installed tree. A failure retains a diagnostic code.
- Existing Codex CLI is reused rather than installed again. Codex app-server and its ChatGPT-plan sign-in remain local per device. No OpenAI API key or shared cookie.
- Removal requires typed owner confirmation and affects only the Gold-managed runtime, not existing system Codex installations.
- Known precondition for the initial UAT installer: an accessible npm CLI JS entrypoint must exist. If missing, return `codex_runtime_installer_npm_unavailable`. Do not claim a completed installation.
- Native installer tests use mocks, not a real npm download or Windows executable launch. A real Windows UAT gate is still required.

## Long Memory deletion
- Local deletion works through an authenticated Wall endpoint, CSRF, typed `DELETE LOCAL MEMORY`, and an additional browser confirmation.
- Before local deletion, the enrolled account directory and current account-wide Sync policy are checked. If the current device is selected and Sync ON, deletion fails closed until deselected.
- Local SQLite deletion runs transactionally, SQLite secure_delete, truncates WAL and vacuums. Memory scopes/checkpoints/events/evidence/notes and sync queues are cleared; task observer records and enrollment are preserved.
- Local receive fence is persisted where selection rows exist. A user can later re-enable sync explicitly.
- Local deletion does not erase exported copies, snapshots/backups, or memory on other devices.
- Account-wide deletion is explicitly unavailable (HTTP 501) until there is an owner-authorized durable account tombstone, signed epoch/fencing, offline-device queued delivery, per-device ACK and anti-resurrection behavior. The /settings option is displayed but disabled. Do not market it as implemented.
- Never execute deletion tests against real account data; use only temporary fixture databases.

## CI / acceptance
- `selftest-gold-wall-navigation.mjs`: owner auth, independent module routes, Material assets, Settings panel, browser JS syntax.
- `selftest-gold-memory-delete-settings.mjs`: CSRF, typed confirmation, current device sync gate, scoped memory removal without losing Codex tasks, account-wide fail closed.
- `selftest-gold-managed-codex-runtime.mjs`: opt-in install, official npm package arguments, no global install, staged commit, uninstall, Windows native path.
- Additional existing Gold G3/Wall/Memory regressions required.
- Build Windows **only in GitHub Actions**. Do not install or publish until CI passes.
