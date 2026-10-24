# Gold Wall optional modules — first native implementation checkpoint (2026-10-24)

The official immutable restore point is
gold-restore-before-memory-codex-20261024 -> ba579f8830a0654e8321204f17270db8d94c5593
(owner Windows build #486 source 30766940ac18e55cb735354b40a3af9ba37eddb8).

This new code is developed in feature/gold-m6-integrated-20261023, the SAME
Gold branch. No special Continuity branch, no second Account, independent
Wall/port, separate Project page or other LXD. It is newly authored from
Gold Core source. Never import the old project-continuity-* code into it.

Added:
- device-agent/gold-wall-modules.mjs: local lazy SQLite for two independent
  optional flags, attributed notes, and deterministic owner task-state ledger.
- Native collapsible controls embedded directly in canonical Wall /
  by modifying local-wall.mjs, using the existing authenticated owner cookie
  and CSRF check. Original /permissions, filesystem roots, PTY, Fleet,
  A/B grant countdown, SCP and Real Remote routes are preserved.
- Embedded same-process Gold Agent wiring in daemon and wall-only modes.
  No additional process, listener, database in Gold cloud, or Project.
- Gold Client Core 91-file manifest; fail-closed immutable #486 byte parity
  gate against frozen Git (allows changes ONLY in original Wall and Agent
  extension entrypoints and requires original sensitive FS/SCP/inventory code).
- End-to-end local UI/API test: existing owner auth and CSRF, rejects
  invalid/stale writes, memory-only, observer-only, both, neither, SQLite
  restart, unattributed notes rejected; existing Gold UI markers retained.

Existing Gold UAT is the owner-authorized sole test instance. The restore
point must remain byte-identical and untouched. Never alter production/Windows.
Use one same-Gold UAT source candidate from a single committed revision and
validate installed source checksum before a guarded UAT cutover.

Remaining OPEN, must never claim functional completion:
1. Remote source-labeled **signed** checkpoint submit and bounded read across
   genuine Gold ChatGPT Web Session A -> B, with per-owner consent and device
   account A/B binding. Hidden Web context cannot be read by Plugin.
2. Actually connect to authorized Codex runtime in observer-only mode;
   current recommendation is local deterministic Task Controller, NOT Codex.
3. Official supported ChatGPT Web auto-continuation is unproven; do not inject
   messages or pretend it works. Owner-directed continuation fallback only.
4. Native Windows #486 physical updater/FS/A-B/RM parity after integrating
   new binary, and macOS/Linux Server/Desktop parity.
5. Full backend M6 reconciliation (one unverified historical resource claim,
   ten unfinished records) and real browser owner acceptance.

Feature flags OFF/OFF must be inert (SQLite unopened/no local write) and
not interrupt Gold operations. This checkpoint is NOT a release approval.

## Gold UAT activation receipt — 2026-10-24 15:04+07
Commit eca45a0b2381e5c0a9521f664bcac3a3cf835a00 was staged
in SAME light-remote-gold-uat LXD as one git-archive source artifact at
/opt/light-remote-gold-uat-candidates/eca45a0b2381e5c0a9521f664bcac3a3cf835a00.
SHA256 of the Gold Wall/Agent/Plugin/Operator/Supervisor candidate source
matched Git; a candidate loopback HTTP smoke and FS roots check PASS.

First service cutover FAILED AND ROLLED BACK because the temporary UAT
systemd override omitted the mandatory "daemon" argument after
device-agent/operator-agent.mjs. It launched "status" and exited normally,
leaving Wall inactive. Pre-feature Gold all four services were returned
to /opt/light-remote-gold-uat-git486-20261024 and verified ACTIVE.
This was a CUTOVER SCRIPT regression, not evidence of functional module failure.

A corrected cutover revalidated the effective Wall unit ExecStart contains:
.../device-agent/operator-agent.mjs daemon
BEFORE restarting anything. All four canonical Gold services then started
successfully from the same eca45a0 artifact. PASS on UAT:
- Four active systemd units from the exact same new Gold source revision
- Node Wall daemon running with the mandatory 'daemon' argument
- Same Wall /login HTTP 200; Gold Plugin /healthz HTTP 200
- Account protected; unauthenticated /api/gold/modules HTTP 401
- Owner /permissions still requires Gold login (303 without session)
- NetBird Gold Wall /login at 100.94.184.141:5591 returned HTTP 200
- OFF/OFF did not create gold-wall-modules.sqlite and required no new process
- PostgreSQL schema still 35 with one pre-existing unresolved resource claim
- No other LXD, new Wall port, extra Account, credentials reset or new snapshot.

Known limitations:
- The owner has NOT yet authenticated and clicked the new controls in a real
  browser. API/UI source and isolated real-container smoke PASS, not owner acceptance.
- Remote ChatGPT cross-session Long Memory and real Codex app-server integration
  remain NOT IMPLEMENTED, NOT TESTED; no automatic Web turn continuation.
- Gold M6 legacy channel 502 / supervisor_owner_invalid may persist, unrelated
  to feature flags. No claim/job is rewritten to fake release acceptance.
- This commit is UAT ONLY. Production and Windows owner-tested build #486 untouched.

Restore instructions remain exactly as the immutable restore doc/tag specifies:
stop Wall, Plugin and Supervisor; point the four existing units back to
/opt/light-remote-gold-uat-git486-20261024, with Wall "daemon" arg;
restart Operator, Supervisor, Plugin, Wall in order. Preserve Gold PG/Redis
and owner enrollment data. Never use the old Continuity runtime.

## Native Codex API setup, test and scope (next Gold commit)
Gold Wall /, Codex Bridge: API-key password field, fixed OpenAI Agents API
provider, selected OpenAI model, Save key, Verify key, Run Codex observer
(explicit billable consent) and Disconnect. No second Wall/port/account,
and no legacy Continuity code or mandatory Project.

Platform API key must be scoped to agents.read + agents.write +
responses.write. Key access and billing are separate from ChatGPT Plus.
Provider endpoint is pinned server-side to https://api.openai.com/v1 and
cannot be customized from browser input. Device-local credential encrypted
with AES-256-GCM, with a separate mode-0600 random device key; never sent
back by any GET API. Device compromise can access both files, so this is
defense against incidental disclosure rather than a hardware security vault.
Owner auth, CSRF, revision checks and module ON gate remain mandatory.

'Verify key' only reads /v1/models, does not incur inference cost and cannot
establish Agents API entitlement. 'Run Codex observer' calls
POST /v1/agents/sessions, with OpenAI-Beta: agents=v1 and environment:none,
and streams a strictly READ-ONLY model response. No commands, remote
execution, Light Remote credentials, tools, shell, MCP or background worker.
Task names/states are transmitted ONLY after owner confirms the run; don't
put secrets in task titles. Completion is credited ONLY after receiving
agent.session.turn.completed, not after HTTP 200/idle/closed stream.
This read-only model consultation is NOT automatic ChatGPT Web continuation.
Status and failures do not disclose an API key; no key is committed to Git.

The NetBird Gold Wall address currently uses HTTP. Use a trusted encrypted
NetBird tunnel and ideally enable HTTPS before entering any long-lived key.
Test scripts use a dummy key and mocked OpenAI requests; no real user
credentials or paid requests were used in source tests. Real owner-provided
key + Agents API entitlement still require live owner acceptance.
