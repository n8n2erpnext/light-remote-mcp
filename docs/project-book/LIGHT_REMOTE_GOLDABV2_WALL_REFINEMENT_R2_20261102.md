# GoldABV2 Wall refinement R2 — 2026-11-02

Branch: feat/gold-single-owner-transfer-20261101, baseline 21154b91 + previous deployment note bdd561b5.
Owner screenshot requirements, UI scope ONLY. No Operator migration, grant revocation, security policy or production/main Gold UAT change.

## Owner changes implemented in source
1. Place Live and Short ID (Device ID) R01KAP - A Code under the brand subtitle on Home.
2. Show validated signed Operator A code from authenticated /api/abv2/pending when pending. Standby has no code. Status in English, Approve B link and server-derived countdown. Never client-mint codes or expose B.
3. Replace browser-native window.confirm in A/B Owner approval with HTML dialog. Confirm, Cancel and Escape independent; no approval until user confirms; unsupported dialog fails closed.
4. 2 Agent grant status rows side by side on responsive fit-content grid, independent grant expiries. Keep manual Close and all old capabilities.
5. Persistent sidebar on Home/Long Memory/Codex/Approve/Permissions/Settings/Processes. Wall first under Navigation, icon from bundled Google Material dashboard SVG, no Google CDN. Old Back to Wall hidden; CSRF logout kept.
6. Countdown thresholds: >30% green, 20-30% amber/orange, <=20% red. 5min approval thresholds 90/60 seconds; Agent 24h thresholds 7h12m/4h48m. Cloud plan Free 12h, Pro 48h, VIP 72h where known.
7. Profile: full · Manage permissions clickable without underline.

## Tests, rollouts, rollback
- New deploy/scripts/selftest-gold-wall-shared-navigation-dialog-v2.mjs verifies 6 routes, sidebar, signed A, web dialog, JS syntax, no system confirm.
- Existing R1 UI, Owner Close, V1=423 lock, B approval, notifications, navigation, typography, plugin gates PASS locally; Gold CI required.
- No new Owner grant required; keep sole GPT-6 grant.
- Stage isolated GoldABV2 Lab only after CI, new snapshot, backup final systemd Wall dropin, restart Wall only.
- Previous runtime: /opt/light-remote-abv2-lab/source-21154b91-wall-ui-STAGED.
- Rollback: atomically restore prior exact drop-in and restart only Wall; full LXD restore last resort (DB state rewind).
- Owner visual browser screenshot acceptance remains pending.

## CI correction — independent Agent grid test
The first Gold Source Gate run for 2856faf9 detected a stale DOM stub in selftest-gold-ab-reauthorization-clock.mjs. The fix upgrades the test to verify HTML-style dataset/appendChild, one header plus the Agent grid, 3 independently timed grants, expected color phases and expiration removal. It is test-only. No API or grant contract changes.
