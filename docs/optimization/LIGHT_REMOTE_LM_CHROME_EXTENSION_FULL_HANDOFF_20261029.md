# Light Remote LM Chrome Extension — Full Handoff — 2026-10-29

## READ FIRST: Scope and constraints
This is an independent Chrome extension prototype for **Light Remote Long Memory**, under **Thai Duy Digital** (the parent publisher). NOT a request to develop browser automation, RM V2, the Gold Connection Lifecycle GC feature, P0/P1, billing or Pro Team.
Owner decision: RM V2 already controls the entire OS and browsers; do not port Browsentic's browser automation, MCP, CLI daemon or Chrome debugger tool suite. Browsentic was examined only for ideas about chunked reading, stable-content/cursor verification, provenance and untrusted page-data boundaries. Light Remote LM implementation is independent and does not copy Browsentic source.

**ACCEPTANCE: source tests PASS; physical Chrome -> Local Wall -> verified Gold signed Long Memory checkpoint NOT YET TESTED. Not production-ready. Not automatic background capture or cross-session auto-sync.**

## Source / Git / environment
Use official @Light Remote on explicitly authorized VPS-ARM, then Git SSH on that VPS-ARM. Do NOT confuse GitHub connector access with the Git SSH credentials on the ARM.
Repository remote: git@github.com:n8n2erpnext/light-remote-mcp.git
Worktree: /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/gold-lm-chrome-extension-20261029
Branch: feature/gold-lm-chrome-extension-20261029
Previous verified pushed HEAD before this handoff: 864a1a76bb37841759b456b5a99dd0ba47333e44
Gold branch base: 7f46dea1380cfd6a57dcfacf377bdad67cdf2736
Earlier commits:
 a614a69: initial Chrome capture + manual Wall staging
 331a739: v0.1 ZIP packaging
 864a1a7: v0.2 chunk cursor + SHA-256 consistency validation and ZIP
Never work directly on main or running Gold UAT; the GC, PostgreSQL, migration 040 streams are separate and must not be touched.

Paths, relative to worktree:
 extensions/light-remote-lm/manifest.json
 extensions/light-remote-lm/popup.html
 extensions/light-remote-lm/popup.css
 extensions/light-remote-lm/popup.js
 extensions/light-remote-lm/capture.js
 extensions/light-remote-lm/background.js
 extensions/light-remote-lm/icon.png
 extensions/light-remote-lm/README.md
 extensions/releases/Light-Remote-LM-v0.2.0.zip
 deploy/scripts/selftest-gold-lm-extension.mjs

v0.2 ZIP SHA256 (previously checked):
75b4c61d517f0178110fa1b717a18ab546b613e3f1325199586aba70ca9788a1

## Implemented exact flow
1. User opens chatgpt.com in Chrome and explicitly clicks Light Remote LM toolbar popup -> Capture visible conversation.
2. The extension reads currently loaded DOM turn nodes, limited to role user/assistant. capture.js exposes lightRemoteLmCaptureSegment; bounded up to 64KiB UTF-8-safe bytes per invocation, with monotonically advancing cursor and full currently loaded DOM transcript SHA256. Re-reads ensure no change during the segmented capture; fail closed on stale. A final reassembled SHA256 check is performed in popup.js. Browser source URL, conversation ID when available, time, turn count, hash and limited DOM coverage are included in metadata. Important: this is NOT the complete official ChatGPT transcript or hidden model context.
3. User explicitly clicks Review in Local Wall. background.js stages the captured text through chrome.storage.session and opens the loopback Local Wall at http://127.0.0.1:5491/long-memory on that same computer. An isolated injected function fills Gold Wall textarea #goldContextText and title input #goldContextTitle and shows a banner. This does NOT click Save, select a memory scope or opt in.
4. The owner chooses a Gold Memory Scope, enables the existing full-context opt-in for that scope if required, reviews text, clicks Save complete context, and approves the confirmation. Local Wall auth and CSRF govern the backend call.
5. Existing Gold Local Wall POST /api/gold/modules/scope/context/save invokes Gold saveFullContext -> saveOwnerFullContext. Gold uses authoritative Home-only scope signing and stored signed scoped checkpoints (Ed25519), followed by existing authorized device sync policies. The extension does not create a separate DB, cloud, MCP service or backdoor.
6. Until an actual Chrome E2E proves the checkpoint exists and can be verified via Gold scoped read/handoff, DO NOT claim the bridge is fully accepted.

Existing Gold source APIs to inspect:
 device-agent/local-wall.mjs (route, opt-in, save, read, and Wall controls)
 device-agent/gold-wall-modules.mjs (saveFullContext, fullContextPreference, listMemoryScopes)
 device-agent/gold-memory-scope-admin.mjs (saveOwnerFullContext, readOwnerFullContext, 512KiB, owner opt-in)
 device-agent/gold-memory-scope.mjs (Home-scoped authoritative Ed25519 signed checkpoints)
 device-agent/gold-memory-sync.mjs and gold-memory-device-selection.mjs (existing authorization and sync, NOT controlled by extension)

## Exact current capabilities / tests
Manifest V3 with activeTab, scripting, tabs, storage; host permissions only localhost:5491 or 127.0.0.1:5491. NO blanket all_urls, debugger, cookies or remote tunnel permissions. No browser automation.
Popup on-demand capture and manual review. No periodic monitoring, no automatic project selection, no background transcript reading, no automatic account-wide memory sync.
Focus test command on ARM:
 node deploy/scripts/selftest-gold-lm-extension.mjs
Most recent PASS: includes chunk reassembly, UTF-8 multibyte boundaries, SHA256, stale DOM detection, localhost target restrictions and checking no automatic scope select/opt-in/save. Node syntax checks PASS. This is only a mocked/source-level test, NOT Chrome Gold end-to-end.

## Limitations and security blockers
- User must have Gold Agent and Local Wall running on the same computer as Chrome, using port 5491; LM must be enabled; current memory scope must be authoritative on that Home to save. Login redirect and page injection timing not physically verified.
- Only currently loaded ChatGPT text is captured. Old messages not loaded in DOM, images, attachments, tools, rich components, ChatGPT mobile app, and hidden ChatGPT model state are NOT captured.
- DOM selectors are heuristic and may change with ChatGPT Web updates.
- Entire owner-reviewed snapshot, including metadata header, must fit Gold's existing 512KiB full-context input; too big fails without truncation or appending. No background continuation.
- Duplicate warning checks only last **staged** URL+SHA256 in the extension's current Chrome session, NOT a Gold DB deduplication guarantee or proof the owner clicked Save.
- Pending plaintext is held in chrome.storage.session for the manual Wall handoff; pending expiry is checked when related events occur, not a guaranteed prompt deletion timer. Fix strict TTL/retention before claiming specific privacy compliance on Chrome Web Store.
- Historical transcript content is untrusted data and must never be treated as new agent instructions or permission grants.
- No Chrome Web Store signup, listing, payment or publication. Parent publisher must remain Thai Duy Digital; extension is a Light Remote product. Developer Store research notes: one-time account registration fee, proper privacy disclosure required for user conversation content; no claim of zero collection merely because local-first.
- RM V2 OS/browser control is out of scope. No Pro Team 5-seat changes; Pro Share $25 proposal remains frozen/not deployed; no Gold GC rollout or migration change.

## Next session acceptance plan (DO IN ORDER)
1. Connect @Light Remote to VPS-ARM and read THIS handoff and extensions/light-remote-lm/README.md; verify worktree branch, Git SSH, latest commit, test command, ZIP hash.
2. Install the unpacked v0.2 ZIP on user-authorized Chrome Windows (Gold agent installed), open ChatGPT Web with a test conversation, test popup capture, loaded DOM coverage, Unicode, stale content handling.
3. Test real Local Wall login and staging (including redirected login), choose existing correct Memory Scope, turn on full-context opt-in, confirm save. Verify a new Gold signed scoped checkpoint via supported read/handoff without leaking private transcript.
4. Fix real E2E blockers and improve clear errors. Add source + real integration regressions, staying fail-closed and scoped. Do not silently save or infer a project.
5. Separately design v0.3: project/turn idempotency in actual LM database, per-conversation binding and explicit user consent, strict ephemeral retention, incremental event capture, pause/revoke. These DO NOT exist in v0.2.
6. Prepare Chrome Store only after Chrome E2E, privacy policy, listing assets, consent proof and reviewer test notes. No store account, payments, rollout, main-branch merge or Gold UAT deployment without owner instruction.

This file is the continuation anchor. The extension's README is supplementary.