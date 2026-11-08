# GoldABV2 Wall typography — source candidate (2026-11-02)

Branch: feat/gold-single-owner-transfer-20261101. Baseline f09ff330.
Scope: typography ONLY, no changes to A/B V2 grants, Owner Close, sessions, PostgreSQL, Redis, account scopes, device permissions or layouts.

## Design contract
- Use local bundled Google Sans variable as main UI font on Local Wall pages: Home, Settings, Permissions, Approve, Long Memory, Codex, Notifications and Process. Existing Web Distribution Google Sans asset reused, not duplicated.
- Use locally bundled Google Sans Code variable for Live Operator Stream command/line output, metadata and PTY/technical code. Google Sans Code copied from /home/ubuntu/n8n2erpnext/Google_Sans,Google_Sans_Code and its SIL OFL included; Google Sans SIL OFL included.
- Shared typography tokens in lib/web-typography.mjs: page 22px, section 18px, heading 16px, body/control 14px, secondary 13px, metadata 12px, code 13px; command highlight 13.5px remains.
- Resize hardcoded 10–12px descriptions in Local Wall, Long Memory, Codex, notification and permissions contexts. Keep critical A/B codes readable, retain prior icon and layout positions for follow-up layout iteration.
- Local Wall and Fleet Wall GET whitelist explicitly serves both new fonts at /assets/fonts/*.ttf. Keep legacy Cascadia endpoint compatibility and font assets. No network font fetch and no external CDN.
- Device Agent daemon also hosts Local Wall. Restarting this runtime while the sole GPT-6 grant exists risks disconnect/grant invalidation. Source can be committed, CI-tested and staged without restarting it. Physical browser acceptance/release activation is a separate gate; DO NOT auto-cutover the live Wall while protected GPT-6 grant exists.

## Evidence and safe activation
- Node syntax PASS for changed modules. New local loopback HTTP test verifies Home/Memory/Codex/Settings/Permissions/Approve font-face + size tokens, 200 TTF assets, process/fleet jobs rendered HTML and font binary signatures.
- Existing A/B Wall preview, Short ID, owner navigation, grant revocation, notification and process/permission regression tests PASS. Browser tests requiring Playwright/Chromium were skipped when unavailable; do not call them PASS.
- No production / main Gold UAT cutover, no LXD restart, no SQL mutation, no B issue, no session close.
- Next: (1) GitHub CI accepted (2) Stage immutable Lab-only source directory (3) wait for owner-approved maintenance/alternate Agent where protected GPT-6 grant won't be lost (4) restart only Lab Wall, verify current Owner A/B remains valid and font HTTP 200, inspect UI screenshots before touching layout.

## Modified code
lib/web-typography.mjs; device-agent/local-wall.mjs; device-agent/update-settings-page.mjs; device-agent/wall-ab-v2-preview.mjs; device-agent/wall-account-notifications.mjs; device-agent/local-process-page.mjs; device-agent/fleet-wall-runtime.mjs; device-agent/fleet-job-page.mjs; deploy/scripts/selftest-gold-wall-google-typography.mjs; source gate YAML; bundled Google Sans Code asset and OFL.
