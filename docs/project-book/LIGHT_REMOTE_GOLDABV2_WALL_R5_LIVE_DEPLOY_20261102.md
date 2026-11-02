# GoldABV2 Wall R5 LIVE deployment — 2026-11-02

## Corrected Owner requirement
Keep LIVE OPERATOR STREAM heading at 12px. Increase COMMAND/output and metadata BELOW the title by about 1–2px. Add Web Distribution-like hover border, no underline, and cloud-aware Live indicator: green connected, amber/yellow cloud dormant, red disconnected.

## Source / CI / isolated scope
Branch feat/gold-single-owner-transfer-20261101; source commit 61b18b8be38a033e160ec8593a506e227fac6d35.
GitHub Source Gate 41449324814: 4/4 PASS. Documentation Integrity 41449324833: PASS.
Only device-agent/local-wall.mjs, device-agent/wall-ui-refinement.mjs and related source regression/project docs changed; NO Operator, Plugin, DB schema or grant changes.
New test deploy/scripts/selftest-gold-wall-r5-interactions.mjs simulates connected, dormant, disconnected, EventSource error and status failure; verifies fonts, no underline/hover, six HTTP feature routes. Existing R4 B, R3 PTY, Owner Close and navigation tests PASS.

## LIVE GoldABV2 Lab status
VPS-ARM LXD light-remote-abv2-lab-20261101; main Gold UAT and production untouched.
Previous Wall R4 runtime: /opt/light-remote-abv2-lab/source-1a99c489-approve-b-r4-STAGED
CURRENT Wall R5 runtime: /opt/light-remote-abv2-lab/source-61b18b8b-wall-r5-STAGED
Snapshot: pre-goldabv2-wall-r5-20261102, 2026-11-02 20:01 Asia/Ho_Chi_Minh.
Exact Wall drop-in backup: /var/backups/light-remote-goldabv2-wall-before-r5-20261102.conf
Restarted ONLY light-remote-gold-wall.service, MainPID 1171444.
Four services active, local/public login HTTP 200, HTTPS health 200.
ACTIVE unexpired grants before 0; after 0. Previous R4 count 2/2 and following handoff 1 reflect earlier moments; R5 did not close or revoke any grant.
R5 and sidebar six-route tests PASS as gold-uat; no recent Wall journal errors.

## UI sizes and semantics
Heading title .term .head 12px UNCHANGED.
Command body 12.5 to 14px; output pre 12.5 to 14px; metadata 11.5 to 13px; command row 12 to 13.5px; result line 12 to 13.5px; COMMAND/PTY badge 10 to 11px, Copy label 11 to 12px.
Button/link no underline, cyan hover border (#67b9e4) and keyboard focus visible; danger/primary semantic red/yellow hover borders. Respects reduced-motion.
Live green/ping cloud desired+connected with valid status/stream; yellow dormant; red disconnected, EventSource error or status-fetch failure. SSE onopen alone never paints green.

## Rollback and next
Restore the saved final Wall-only *abv2lab.conf systemd drop-in atomically from backup above, daemon-reload and restart Wall only; check 4/4 services. Do not restore whole LXD unless last resort because of database rewind.
Owner Chrome Ctrl+Shift+R and visually check stream COMMAND/output readability (not heading), border hover/no underline, and Live amber dormant / red disconnected / green connected.
Browser visual owner acceptance remains OPEN. Backend A/B security and separate pending Owner Close E2E gates remain OPEN; not production-ready.
