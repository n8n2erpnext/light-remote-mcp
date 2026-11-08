# GoldABV2 Wall R5 — Hover, STREAM BODY Font, Cloud Live Indicator

2026-11-02. Isolated GoldABV2 LXD Lab only on feat/gold-single-owner-transfer-20261101. Owner corrected a prior misinterpretation: DO NOT increase the title LIVE OPERATOR STREAM, increase COMMAND/output content BELOW the title by ~1–2px.

## Changes
- Wall link/button controls use no text underline and cyan border-color hover, similar to Web Distribution outline controls. Yellow confirmation and danger keep semantic yellow/red hover borders. Keyboard focus-visible preserved. Reduced-motion disables transition.
- Stream TITLE .term .head stays at 12px. Body command row +1.5px to 13.5, command text 12.5→14px, pre output 12.5→14px, metadata 11.5→13px, action buttons 11→12px, command badges 10→11px, result line 12→13.5px. Wider status/timestamp columns prevent crowding.
- Live badge green/ping only when cloudDesiredConnected and cloudState=connected and Wall stream not failed; dormant/standby amber/yellow, disconnected/error/cloud or failed Wall SSE red. SSE opening alone no longer forces green. Cloud refresh updates badge, status-fetch failure fails red.
- Wall UI only. No grant, B approval, Operator, Plugin, database or policy change.

## Quality acceptance
- New deploy/scripts/selftest-gold-wall-r5-interactions.mjs simulates live-state paths, checks font sizes/hover, and validates 6 HTTP Wall/feature routes.
- Existing R4 B8, R3 PTY, sidebar/dialog, Owner Close and source contracts also required.
- GitHub Source Gate and Docs Integrity must PASS before isolated Lab Wall cutover. Snapshot LXD and back up original final Wall unit drop-in; verify 4/4 and unexpired grant counts before/after.
- Owner browser visual acceptance is separate; never close/grant any Agent to test cosmetic UI.
