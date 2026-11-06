# GoldABV2 Approve B R4 LIVE deployment handoff — 2026-11-02

## Source and quality
- Branch: feat/gold-single-owner-transfer-20261101.
- Feature source commit: 1a99c489fb2515934e3c7b3ad741fcb62394fc9c.
- Source Gate: GitHub Actions run 41442446526, 4/4 jobs PASS (source, Windows epoch, PostgreSQL 1000, 10000).
- Documentation integrity: run 41442446648 PASS.
- Scope: UI-only code in device-agent/wall-ab-v2-preview.mjs; new regression deploy/scripts/selftest-gold-abv2-b-segmented-input.mjs, docs/checkpoint/CI.
- Detailed source brief: docs/project-book/LIGHT_REMOTE_GOLDABV2_APPROVE_B_SEGMENTED_R4_20261102.md.

## Isolated Lab deployment
- VPS-ARM LXD: light-remote-abv2-lab-20261101.
- Wall URL: http://100.94.184.141:15591/approve
- Previous live R3: /opt/light-remote-abv2-lab/source-fb005567-wall-r3-final-STAGED
- Current LIVE R4: /opt/light-remote-abv2-lab/source-1a99c489-approve-b-r4-STAGED
- LXD pre-cutover snapshot: pre-goldabv2-approve-b-r4-20261102 (2026-11-02 19:10 Asia/Ho_Chi_Minh).
- Original Wall systemd drop-in backup: /var/backups/light-remote-goldabv2-wall-before-approve-b-r4-20261102.conf.
- Switched only final Wall drop-in WorkingDirectory/ExecStart source paths; restarted only light-remote-gold-wall.service; MainPID 1008074 active.
- No Operator, Plugin, Process Supervisor, PostgreSQL, Redis or backend authorization code changes.
- R4 preview source SHA256 matched Git worktree and staged runtime:
  6638ca492d0fb9a3e81a800ac62dde0fa34a685e94049633e476b77950782d0f.

## Post-cutover verification
- Operator, Plugin, Wall, Process Supervisor 4/4 active.
- Local /login 200, public /login 200, HTTPS health 200.
- Active lab device A/B grants before 2, after 2; grants kept intact.
- R4 8-character B input test, signed request owner preview and six-page shared sidebar navigation PASS under gold-uat.
- Wall journal errors since restart: none.
- UI behavior simulated in a local DOM using linkedom: copy/paste formatted B code with B: prefix, uppercase conversion, eight fields, automatic focus, Backspace and synthetic approval payload POST all PASS. This is not a real grant.
- Manual Chrome owner visual acceptance is still open (spacing, animated arrow and focus on actual browser).

## Visual design
- Block A (one-time A code), animated local SVG flow arrow (respects prefers-reduced-motion), Block B (8-character segmented B code).
- A code is yellow 26px Google Sans Code 800; responsive 22px.
- Eight per-character input cells, grouped 4+4; type/auto focus, Backspace/left/right navigation, paste whole text normalized to approved alphabet A-HJ-NP-Z2-9; validation requires all 8 to send.
- English instructions in Block A and B. The signed A code is displayed only from Operator pending row.
- Existing Owner web dialog, signed request ID/attempt matching, 24-hour grant ceiling and optional one-time independent Owner consent remain unchanged.
- 12s refresh will not steal focus or erase active B/Owner consent input; backend still decides whether request is valid/not expired.

## Rollback and safety
- Restore the final *abv2lab.conf inside /etc/systemd/system/light-remote-gold-wall.service.d/ atomically from /var/backups/light-remote-goldabv2-wall-before-approve-b-r4-20261102.conf.
- systemctl daemon-reload, restart only light-remote-gold-wall.service, verify WorkingDirectory points back to R3 and 4/4 services active.
- Keep LXD snapshot as last resort (full LXD restore can rewind PostgreSQL/Redis). Never revoke/close existing Agent grants to test UI.
- No Gold UAT main or production deployment.

## Next acceptance
- Owner Chrome Ctrl+Shift+R on /approve with an actual pending request, check B segmented auto-focus/paste with valid real B provided to Owner by their AI Agent. Do not auto-approve without Owner action.
- Test on desktop and narrower viewport; inspect any clipped inputs, border spacing, arrow alignment, front-end status/error messages. Keep changes scoped to isolated GoldABV2 Lab.
