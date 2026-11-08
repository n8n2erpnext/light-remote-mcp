# GoldABV2 Wall R2 LIVE deploy handoff — 2026-11-02

## Source and CI
Branch: feat/gold-single-owner-transfer-20261101.
Feature/source commit 2856faf94ac9f782673b38942ff844bd4c50a6da.
Test-only grant-clock correction commit 64798a81c71e202d95770bda6e029ce7db74c08e.
GitHub Source Gate run 41434883827: 4/4 jobs PASS.
GitHub Docs Integrity run 41434883765: PASS.
No Operator schema/permission/grant implementation change; only Wall UI and regression fixtures.

## Live deployment target
Isolated Lab container: light-remote-abv2-lab-20261101 on VPS-ARM.
Public Wall: http://100.94.184.141:15591/
HTTPS health: https://goldabv2.light-remote.thaiduy.digital/healthz
Previous source: /opt/light-remote-abv2-lab/source-21154b91-wall-ui-STAGED
Active source: /opt/light-remote-abv2-lab/source-2856faf9-wall-r2-STAGED
LXD pre-cutover snapshot: pre-goldabv2-wall-r2-20261102, created 2026-11-02 18:10 +07.
Wall drop-in backup: /var/backups/light-remote-goldabv2-wall-before-r2-20261102.conf
Restarted ONLY light-remote-gold-wall.service, active MainPID 799958.

## Verified after cutover
Operator, Plugin, Wall, Process Supervisor all active (4/4).
HTTP local /login 200; public /login 200; HTTPS healthz 200.
PostgreSQL active grants on Lab device before 2, after 2, no grant revoked.
6 authenticated routes Home, Long Memory, Codex, Approve, Permissions, Settings render 200 with sidebar and inline scripts syntactically valid.
Web confirm replaced window.confirm and retains explicit human approve B action.
Short ID and A code drawn only from signed Operator pending API, not fabricated or refreshed by client.
Typography and Local Wall visual style source tests PASS under gold-uat user.
Recent Wall journal: no error entries.
No production/main Gold UAT/Owner-grant interference.

## Visual changes
Sidebar persists on feature pages with locally bundled Google Material dashboard icon and Wall link instead of Back to Wall.
Header Live + Short ID (Device ID) and signed A code under device subtitle. Status strings English.
5min pending A code countdown: green >30%, amber 20-30%, red <=20%.
Agent access grant rows horizontal fit-content 2-column grid. Independent 24h clocks same 30/20 percentages.
Cloud Free/Pro/VIP lifetime percentages when plan is known; no new backend timer scheduling.
Web HTML dialog for A/B Owner approval (confirm/cancel/escape) with no browser-native JS dialog.
Profile permissions link clickable without underline.
No CDN dependence for Material icons.

## Rollback
Restore current final *abv2lab.conf in /etc/systemd/system/light-remote-gold-wall.service.d/ from /var/backups/light-remote-goldabv2-wall-before-r2-20261102.conf using short temporary filename and atomic rename, systemctl daemon-reload, restart only light-remote-gold-wall.service. Verify WorkingDirectory points at previous source and all 4 services healthy.
LXD snapshot only last resort because rollback would rewind PG/Redis state. Do not close Agent A/B grants to test cosmetic UI.

## Next
Owner Chrome hard refresh Ctrl+Shift+R; validate actual pixel layout, sidebar collapse persistence, A code pending display, non-native confirm, notification overlay and 2-Agent same-line layout. Browser-based visual acceptance not claimed until Owner inspects screenshots.
