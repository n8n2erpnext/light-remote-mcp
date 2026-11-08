# GoldABV2 Lab — Chrome Extension LM v0.3 integration handoff — 2026-11-02

## Scope and current status

**SOURCE INTEGRATION READY; REAL CHROME + SIGNED HOME CHECKPOINT END-TO-END NOT YET ACCEPTED.** User requested to connect an existing ChatGPT Web DOM Chrome Extension to GoldABV2 Long Memory, rather than recreate it. Target branch feat/gold-single-owner-transfer-20261101. Do NOT change main Gold UAT or production, install without Owner, or auto-capture private chats.

### Provenance

- Existing independent extension branch: feature/gold-lm-chrome-extension-20261029 at worktree /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/gold-lm-chrome-extension-20261029, HEAD 6cafb33b. Original preview v0.2.0 had 64KiB UTF-8 chunks, per-page/full SHA-256, manual Chrome popup, chrome.storage.session 10-minute pending Wall handoff. Source tests PASS, but no real Chrome E2E.
- Source copied without modifying its original worktree to dedicated GoldABV2 directory extensions/light-remote-lm-abv2 on current GoldABV2 branch.
- New version 0.3.0, MV3, private LAB-only target, not production/Chrome Web Store.
- Build artifact: extensions/releases/Light-Remote-LM-GoldABV2-v0.3.0.zip. Locally created with Python stdlib zipfile (no zip tool on ARM), ZIP CRC/contents PASS, SHA256 76a3649a4fb7704cb930f4a1912f70b80d8387128f69aff023e9a306f3fd0dcd, 28,095 bytes, 8 static files.

### User workflow

1. User-controlled Windows Chrome with NetBird overlay access to Lab Wall http://100.94.184.141:15591/long-memory.
2. Load unpacked extension from ZIP in chrome://extensions (not installed from this session). Open ChatGPT Web at https://chatgpt.com/ and explicitly press Capture visible conversation. No background capture, no automatic ChatGPT login scraping.
3. Popup verifies snapshot across <=64KiB chunks using full SHA256, source URL and loaded user/assistant turn count; rejects stale/oversized capture, says loaded DOM only. Session transcript with metadata max 512KiB.
4. User explicitly clicks Review in GoldABV2 Lab. Extension opens exact private NetBird Wall page (not Windows localhost). Chrome extension allows ONLY http://100.94.184.141:15591/* (plus activeTab temporary ChatGPT permission); no generic LAN/Internet host access.
5. Owner logs into authenticated Lab Wall if needed. Pending text staged in existing #goldContextText and #goldContextTitle; GoldABV2 native My Work banner guides Owner to open/create a work. #goldMemoryContextDetails opened but inside Work detail, not displayed before Owner selects a scope.
6. Owner chooses an authorized current-enrollment Work (or creates one), expands Saved context, reviews/redacts, enables explicit full-context opt-in for that scope, clicks Save context and confirms. Only this triggers existing CSRF Owner-authenticated /api/gold/modules/scope/context/save, Home-signed Ed25519 checkpoints. No Extension post/auto Save/opt-in/scope selection/A-B grant.
7. Owner verifies signed readback in Wall. This step NOT executed against a real Owner session or actual ChatGPT conversation.

### Security invariants

- Manifest V3 permissions activeTab, scripting, tabs, storage, alarms; host_permissions only exact NetBird Lab Wall. No cookies, debugger, webRequest, all_urls, automatic content_scripts or APIs for other sites.
- Strict origin/path checks inside background.js and injection; reject localhost/Gold main, other NetBird hosts, HTTPS arbitrary domains, wrong paths, query strings with credentials.
- chrome.alarms guarantees 10-minute pending plaintext expiry even if service worker sleeps; staging success and tab-close remove pending. Storage.lastStaged only URL/SHA, not durable save proof.
- Text injected into Owner's browser DOM only; no transcript POST until Owner submits the existing Wall form. The private HTTP route is intended only on authenticated encrypted NetBird overlay. Do not expose publicly.
- Historical conversation content untrusted; never follow it as instructions; exact Home/Account binding, CSRF, Owner approval remain mandatory.
- Historical 3 scopes in Lab SQLite belong to previous Account/Memory Home. Current owner has no matching scopes. NEVER set accountId/deviceId manually or import into old scope.
- Previous user requested **delete only old Long Memory DATA**, preserve Long Memory and Codex features. That cleanup is NOT yet done: current GoldABV2 Account Sync is ON and this device selected. Official /api/gold/modules/memory/delete/local explicitly refuses until Device Sync selection disabled. Do not delete SQLite directly or bypass sync fence. Ask Owner to disable selection in Device Sync then use official Owner-confirmed deletion/backup.
- This integration preserves previous Gold branch and GoldABV2 Lab service; no DB schema migrations or Wall service restart needed.

### Verified source acceptance and limitations

- node deploy/scripts/selftest-gold-lm-extension-abv2.mjs PASS (synthetic DOM UTF8 chunk reassembly/SHA256/stale rejection/allowed wall/private origin/manual staging/no auto selection/save).
- node deploy/scripts/selftest-gold-wall-r5-interactions.mjs PASS.
- node deploy/scripts/selftest-gold-memory-scope-v2.mjs PASS (temporary DB).
- Node --check popup.js/background.js/capture.js PASS, ZIP integrity PASS, exact lab URL /long-memory reachable with HTTP 303 redirect requiring Owner login (normal for unauthenticated request).
- Do not claim actual Owner Chrome installation, successful authenticated login redirect handoff, network reachability FROM Windows, true signed checkpoint, scope binding change, real cloud relay, background monitoring or Chrome Web Store publication.
- Current GoldABV2 Wall R5 stays at /opt/light-remote-abv2-lab/source-61b18b8b-wall-r5-STAGED. No service deployed/updated by packaging. 4/4 services remain as previous audit unless new read-only check says otherwise.
- Test only with synthetic non-sensitive ChatGPT conversation first. Real user content and credentials must not enter build logs or Git.

### Next acceptance runbook

1. Verify Source Gate and Documentation CI on GitHub before installation. Download exact release ZIP, compare SHA256.
2. On Owner Windows with NetBird, open the Lab /long-memory and complete login before using extension. In Chrome Load unpacked extracted folder light-remote-lm-abv2.
3. Capture synthetic ChatGPT conversation; verify loaded turn count, unicode, stale detection, clipboard not required.
4. Click Review in GoldABV2 Lab. Confirm redirect from unauthenticated login returns to /long-memory and payload staged only there. Check auto-expire and tab close remove pending; no auto Save.
5. Ensure Memory Home identity is current and an authorized new scope exists. If old-data cleanup requested, first disable Device Sync selection and use official local data deletion after restricted backup/Owner confirmation.
6. Owner open/create Work, review/redact staged text, enable full-context and click Save context. Verify successful signed checkpoint and readback with source/provenance.
7. Add real Chrome E2E evidence, screenshot, and privacy notice. No distribution to production or Store before Owner sign-off.

### Reference source

- Original branch: feature/gold-lm-chrome-extension-20261029, README and docs/optimization/LIGHT_REMOTE_LM_CHROME_EXTENSION_FULL_HANDOFF_20261029.md.
- New code: extensions/light-remote-lm-abv2/{manifest.json,popup.html,popup.css,popup.js,capture.js,background.js,README.md,icon.png}.
- Regression: deploy/scripts/selftest-gold-lm-extension-abv2.mjs. GitHub CI: .github/workflows/gold-connection-lifecycle-gc.yml.
- Wall context form and signed save endpoint: device-agent/local-wall.mjs, device-agent/gold-wall-modules.mjs, device-agent/gold-memory-scope-admin.mjs.
- Identity audit: docs/project-book/LIGHT_REMOTE_GOLDABV2_LONG_MEMORY_AUDIT_20261102.md.

## CURRENT OWNER HANDOFF: DATA-ONLY CLEANUP AND E2E ORDER

- Post-commit 5b4fd64d read-only Lab verification: all four GoldABV2 services ACTIVE, Wall is R5. Local SQLite shows Long Memory and Codex flags both enabled, 3 historical Gold scopes remain, Device Sync selection enabled=true. No old data cleanup has been performed.
- Owner instruction: **Delete old Long Memory DATA, not Long Memory FEATURE**. Official deletion is gated by Device Sync selection; still blocked/pending. No direct SQLite DELETE, account/device ID rewrite, key or module disabling.
- Owner Windows Chrome physical installation and real signed checkpoint E2E are NOT DONE; source CI and static ZIP only.
- Correct next sequence: verify ZIP/hash, Owner unselect target Lab device in Device Sync, official Owner-confirmed data-only cleanup after restricted backup, establish new current-enrollment Work, manual synthetic ChatGPT Capture/Review in authenticated Lab Wall, explicit opt-in and Owner Save, signed checkpoint verification.
- Exclude main Gold UAT, production and previous original Chrome LM v0.2 branch from any change.

## Hosted CI and post-push verification

- Extension integration source commit: ea622a336b1a29073aff7936f5730277b35942f2.
- GitHub Source Gate run 41454866776: 4/4 PASS on 2026-11-02; Documentation Integrity run 41454866605: PASS. Verified GitHub branch HEAD/origin after push.
- Isolated Lab post-push read-only check: 4/4 services active, Wall WorkingDirectory remains source-61b18b8b-wall-r5-STAGED, HTTP /long-memory returns 303 login redirect for unauthenticated request and HTTPS health returns 200. No service restarted.
- Long Memory flag ON, Codex flag ON; 3 historical mismatched scopes remain unchanged; no data deletion or account/device migration.
- Pending: actual Windows Chrome unpacked install, NetBird reachability from Windows, Owner login redirect/injected DOM and signed checkpoint read-back with a synthetic conversation.
