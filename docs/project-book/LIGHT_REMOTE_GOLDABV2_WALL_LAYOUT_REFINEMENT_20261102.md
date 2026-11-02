# GoldABV2 Wall layout refinement — 2026-11-02

Owner screenshots after Google Sans rollout requested five visual changes. Branch feat/gold-single-owner-transfer-20261101 baseline e6a95c86.

## Visual source scope
- Local Wall Home/Long Memory/Codex: left fixed navigation with toggle, persistent collapsed mode, icon-only on collapse, existing exact connect/disconnect, permissions, Approve B, modules, settings, logout actions retained.
- Header A/B status: Short ID in yellow (signed Operator only), no A/B V2/V1 locked wording, standby neutral. Pending shows approval link + 5-minute server-derived countdown, green to yellow at 120s to orange at 60s to red at 30s. Expired refreshes signed pending status; no client-generated A code and no new grants.
- Header notification bell moved to the right; existing position-clamped fixed panel, bounded max-height and z-index preserved; responsive and overflow test remains.
- Live connection text 14px with green ping animation only for active SSE and reduced-motion support.
- Live Operator Stream uses Google Sans Code throughout. Command/label/risk badges compact 10px, metadata 11.5px, code output 12.5px, controls 11px. Existing syntax highlighting, statuses, copy, stop, live stream and session job behavior unchanged.
- Removed duplicate abV2WallStatus ID and removed stale AI Access V2 label rewrite. Removed redundant '(24-hour limit)' suffix from every grant row, without changing grant TTL.
- One new UI-only module device-agent/wall-ui-refinement.mjs, existing device-agent/local-wall.mjs modified. No account/Operator/grant/schema migration modifications.

## Tests
- deploy/scripts/selftest-gold-wall-ui-refinement.mjs: signed short-ID source, one status+bell, sidebar, command CSS, inline JS syntax, countdown phases and one-shot expiry revalidation.
- Updated two existing A/B source tests to verify signed dynamic Short ID and correct Approve B instead of obsolete literal A/B V2 · V1 locked display.
- Existing Wall Google typography, A/B owner preview, navigation, notifications, dialog, Close cache, plugin contracts to be run before push.
- Source/docs checkpoint gate and Gold GitHub CI required.

## Cutover and rollback
- Only isolated GoldABV2 Lab LXD light-remote-abv2-lab-20261101 at http://100.94.184.141:15591. No production/main Gold UAT.
- Current active source before cutover: /opt/light-remote-abv2-lab/source-e6a95c86-wall-typography-STAGED.
- Last snapshot pre-goldabv2-fonts-20261102 is BEFORE previous font rollout; create a new snapshot now to avoid losing that rollout if rollback required.
- Rollback via backup of the final exact Wall drop-in and restart ONLY light-remote-gold-wall.service. Avoid full LXD rollback unless Owner accepts possible PG/Redis rewind.
- Verify 4/4 services, login HTTP200, signed Short ID and sole GPT-6 grant unchanged after restart; test generated HTML under gold-uat service user. Browser visual acceptance and popup clipping can only be fully established with authenticated real desktop screenshots.

## Source CI correction
Initial 21154b91 Gold Source Gate 41419031725: 3 jobs PASS, source-gate FAIL on old literal /V1 locked/ UI assertion in selftest-gold-ab-v2-lab-v1-lock.mjs. Owner expressly removed that visible text. The correction checks that V1 remains locked through existing HTTP 423 and no legacy call assertions while ensuring the phrase does not appear. No runtime source code changed.
