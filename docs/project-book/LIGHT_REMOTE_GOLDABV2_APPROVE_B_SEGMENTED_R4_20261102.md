# GoldABV2 Wall Approve B R4 — two-code cards and segmented B input

Date: 2026-11-02. Scope: isolated GoldABV2 Lab only on branch feat/gold-single-owner-transfer-20261101. Baseline R3 live source fb005567, handoff commit 053595ad.

## Owner screenshot acceptance
- Dedicated bordered Block A with prominently readable, bold yellow one-time A code (Google Sans Code 26px, weight 800; 22px small screen).
- Block A contains clear English instruction: Get the B code from the AI chat, then enter it in Block B.
- Between blocks is a bundled inline SVG arrow pointing from A to B, with subtle animation and reduced-motion fallback (no CDN, no external icon dependency).
- Dedicated Block B with eight visually separated input cells, 4 + 4 with a dash separator; each cell one uppercase character and accessibility label. 24px bold code entry, responsive mobile width.
- Typing advances focus; Backspace returns to previous cell, Left/Right arrows move focus, paste distributes complete code across 8 boxes, spaces and formatting hyphens are cleaned, invalid character classes rejected. Supports B: and B code: prefixes. Does not silently submit.
- A pending signed request refresh every 12s does not steal focus or erase partially entered digits when owner is actively typing. Server still validates request ID, attempt, B code, account consent and expiry.
- Actual POST to /api/abv2/approve keeps exactly the existing security contract: requestId, expectedAttempt, validated B code 4+4, one-time ownerConsent if required, CSRF header, and web confirmation. No auto-grant or user-code capture.

## Test and safety
- New deploy/scripts/selftest-gold-abv2-b-segmented-input.mjs runs the actual B normalization/typing/paste/Backspace/readB functions in isolated Node vm. Tests 8 inputs, A/B cards, arrow, responsive/motion CSS, invalid B, incomplete B, formatting, and 4+4 final code.
- Manual DOM simulation with local-only linkedom also PASS for paste/glyphs/focus/input/Backspace and approved request payload on synthetic data; no grant issued on real Operator.
- Existing A/B owner approval/navigation, Owner Close preserving other Agent, V1 deny, 6-route Wall navigation, plugin/tool contracts must continue PASS.
- No Operator, PostgreSQL, Redis, grant code or schema touched.
- Require GitHub Gold Source Gate and Docs Integrity PASS. Snapshot isolated Lab, stage source file, change only Wall systemd drop-in, restart only Wall, verify active grants unchanged and 4/4 healthy.

## Next, rollback and acceptance
- Owner visual Chrome check of two cards, arrow, code legibility, segmented typing and paste. Real pending request not required for backend unit tests; don't create/grant B without Owner action.
- Previous Lab source is /opt/light-remote-abv2-lab/source-fb005567-wall-r3-final-STAGED.
- For rollback restore backed up Wall drop-in to R3 source, daemon-reload and restart Wall only; never full LXD rollback except last resort (database state).
