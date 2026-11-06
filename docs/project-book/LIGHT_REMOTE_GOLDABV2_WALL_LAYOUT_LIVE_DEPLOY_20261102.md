# GoldABV2 Wall sidebar / operator UI LIVE handoff — 2026-11-02

## Source, CI and deployment
- Branch: feat/gold-single-owner-transfer-20261101.
- UI source commit: 21154b9199b3f8b8e1c77761f23182713ef057b3.
- Test-only follow-up: 3576a863e7914798d8a50cd89e9ab33abbf4bfee (obsolete V1 locked text expectation removed, actual V1 API blocks retained).
- GitHub CI source gate latest: 41419356583, four jobs PASS (source, Windows epoch, PostgreSQL x1000, x10000).
- Documentation CI latest: 41419356365 SUCCESS.
- GoldABV2 Lab LXD: light-remote-abv2-lab-20261101 (VPS-ARM).
- Public Wall: http://100.94.184.141:15591/ . Local loopback Wall: 127.0.0.1:5491.
- Source path BEFORE: /opt/light-remote-abv2-lab/source-e6a95c86-wall-typography-STAGED
- Source path NOW: /opt/light-remote-abv2-lab/source-21154b91-wall-ui-STAGED
- Changed the exact final *abv2lab.conf systemd drop-in atomically; only restarted light-remote-gold-wall.service, NOT the Operator/Plugin/Process Supervisor services.
- Original drop-in backup inside LXD: /var/backups/light-remote-goldabv2-wall-before-sidebar-20261102.conf
- Pre-cutover LXD snapshot: pre-goldabv2-wall-sidebar-20261102 (2026-11-02, 16:15 +07).
- Source sha256 local-wall.mjs cad470655ba33997d8bb0e1306e7b19e14cbba84b0ce80835d6afb2fb563963a; module wall-ui-refinement.mjs 5c6a77a18b9a720171c4f8bcda03a8fd97a40c8455898db4a2dd7852dbb69252.
- Stage validated and SHA-identical to Git worktree; automated UI tests PASS under service user gold-uat.

## Owner visual scope
- Navigation: fixed left sidebar with collapse, icon-only when collapsed, persisted preference. Existing exact Connect/Disconnect/Permissions/Approve B/Long Memory/Codex/Settings/Logout actions preserved. No tool semantics changed.
- A/B: Short ID is from signed Operator account/device metadata (R01KAP), yellow; display Short ID - A Code: standby until a pending approval; pending code withheld, countdown from signed expiresAt, phase green >120s, yellow <=120s, orange <=60s, red <=30s, expiry refresh. Approve B remains a link to /approve.
- Bell: in top-right header; existing viewport-clamped fixed notification panel and authenticated feeds preserved.
- Live: SSE connection status has green ping circle, reduced-motion safe.
- LIVE OPERATOR STREAM: Google Sans Code throughout; badges COMMAND/DANGER 10px; command 12.5px; meta 11.5px; button 11px; outputs 12.5px.
- Removed duplicate abV2WallStatus element and redundant per-agent '(24-hour limit)' repeated text, without altering the backend clock.

## Measured post-cutover acceptance
- Active service light-remote-gold-wall.service, MainPID 650199.
- All four GoldABV2 services active (Operator, Plugin, Wall, Process Supervisor).
- Public + local /login HTTP 200; HTTPS goldabv2 /healthz 200.
- PostgreSQL lr_ab_grants for protected lab device: exactly one active unclosed unexpired grant after restart.
- Official GoldABV2 MCP list_devices: Linux device online; signed read-only account Discovery reports 1 device online, Short ID R01KAP.
- No new Wall journal error entries after restart.
- Generated Home HTML, pending countdown behavior, font HTTP endpoints and all UI source/CI assertions PASS.
- Real authenticated browser visual screenshot acceptance still pending from Owner; do not claim manual visual/per-pixel alignment PASS.

## Next and rollback
Owner hard refreshes Chrome (Ctrl+Shift+R), checks sidebar expanded/collapsed, Approve B, R01KAP, Live ping, notifications popup at browser edges, Stream command/risk sizes and responsive layout. Apply next spacing tweaks only to isolated Lab.

To rollback UI without rolling back Postgres: restore the exact final *abv2lab.conf from /var/backups/light-remote-goldabv2-wall-before-sidebar-20261102.conf using a SHORT temporary name inside the same .d directory + atomic rename; systemctl daemon-reload and restart ONLY light-remote-gold-wall.service; verify effective WorkingDirectory old path and 4/4 services. LXD snapshot is last resort because it can rewind Lab DB/Redis state.
Do NOT revoke or close protected GPT-6 grant just for visual acceptance; no prod/main Gold UAT changes.
