# Codex, Wall and Desktop follow-up — 2026-11-10

Owner installed internal dev.4 and reports six concrete regression/feature groups. This is functional installed feedback, not a blanket acceptance result. Keep the one-primary LightRemote.exe package and existing native authority, Owner binding, A/B consent, identities and internal-only delivery.

## Required outcome

1. Both Desktop and Wall finish Codex device login automatically, remove stale codes after verified sign-in, and provide selectable code and Copy. Model and reasoning choices come from the installed app-server catalog, flow into actual turns and persist locally. Show runtime-reported token counts and rate-limit windows, including unavailable/stale states without inventing total plan quota or Platform billing.
2. Use distribution Google Sans/Cascadia typography and canonical SVG for all affected consent/login/callback surfaces. Preserve strict OAuth/PKCE/CSRF/CSP and loopback Host validation. No new secret in HTML/JS.
3. Wall Agent access summary uses a friendly label/short suffix, with full IDs available only on demand.
4. Reproduce PTY output path end-to-end, including real Windows ConPTY command/ANSI/resize cases; preserve read-only observer. Do not classify the user's screenshot as fixed from a static source test.
5. Replace silent 200-job deletion and 200-record disk-history cutoff with accessible retained-history pagination. Keep stream live beyond 200, bounded RAM/DOM and explicit disk retention. Verify older records, restart, pagination and live arrival while browsing history.
6. Keep native window responsive to Close while login/vault/network/host work is pending. Closing hides Desktop; background Agent and sessions retain their independent lifetime.

## Inventory evidence

- Exact pre-change work/main8ac6273; full annotated tag checkpoint/20261110-before-codex-wall-8ac6273. Bundle SHA2564b0fe9fd2ae24bcf8a406bf03ddc8c3a5b6feb9a975b8c34f45d2d7b5265e5b3; independent bare restore/fsck PASS.
- NativeModuleScreens stores login code separately from account status and never clears it upon successful account check. Wall needs synchronized completion polling and selectable/copyable code too.
- Local Wall ingest deletes finished jobs above200; disk history method/routes clamp200 and read only tails. Rendering already batches work, which should be retained.
- Native begin/restore/logout commands are synchronous; restore can wait for a background vault write while reacquiring the session mutex, logout performs blocking HTTPS. They must leave the UI thread before any such wait.
- Synthetic actual-browser PTY request delivers65 bytes, parsed terminal text and nonzero renderer dimensions: PASS. It does not reproduce the installed Windows symptom. Continue with actual ConPTY probe and missing/zero-size/fallback/offset cases before a success claim.
- Browser Desktop consent has hand-written LR text mark and Segoe UI; native OAuth callback is plain text. Distribution canonical mark and fonts already exist in assets/branding and assets/fonts/web.

## Validation and delivery

Meaningful unit/protocol and real-browser cases, exact-source GitHub Actions Windows native/installer/lifecycle checks, independent SHA256/manifests and internal installer only. Record every milestone in the existing checkpoint/handoff/cumulative Worklog. Do not auto-install on Owner Windows or activate a public Release/update feed. Preserve ARM current internal947a117 runtime and rollback material until an exact tested backend candidate is ready.

Official app-server protocol reference: https://learn.chatgpt.com/docs/app-server — model/list, account/login/completed, account/read, account/rateLimits/read and thread/tokenUsage/updated. Installed runtime schema wins when optional methods/fields differ; explicit unavailable states remain required.

## Implementation milestone — local verification, native CI next

All six groups and Owner's added label layout are implemented in dev.5 source. Local evidence is linked in Project Truth. The initial synthetic PTY success was not used to claim the physical report resolved: new coverage adds ANSI bottom-right120x32 output, replacement selection, replay, read-only transcript and a real isolated Windows ConPTY/HTTP proof. Windows can omit its native exit callback; retain unknown exit code and bounded PID evidence. A new unit proves final ConPTY bytes/onExit can drain after PID disappearance before the worker is disposed.

Source boundaries: gold-codex-session-view + gold-codex-plus; both NativeModuleScreens/CodexControls and wall-codex-controls; activity-history-reader/local-activity-log/wall-history-controls; wall-pty-reader/native-terminal; native owner_login/callback_page and installed lifecycle. Catalog configRevision3 adds status/preferences/history relative routes without changing profile, issuer or credential authority. Keep existing A/B gates, default-OFF Wall SSO and public feed HOLD. The final installer, exact Actions source, backend consent deployment and Owner physical retest still need separate evidence.
