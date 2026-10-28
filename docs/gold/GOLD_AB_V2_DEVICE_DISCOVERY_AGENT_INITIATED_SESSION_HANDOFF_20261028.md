# LIGHT REMOTE GOLD — A/B SESSION V2 + DEVICE DISCOVERY
## Owner design handoff / 2026-10-28 / SPECIFICATION ONLY

STATUS: OWNER-APPROVED PRODUCT DIRECTION; NO IMPLEMENTATION YET. This document captures the owner's requested UX, verified source entry points, architectural decisions, migration/test gates, and deferred scope. Do not present the proposed behavior as shipped. Do not change production. All example codes and devices below are illustrative, never real approvals.

### 0. Purpose and decision boundary
The owner explicitly DOES NOT want A/B pairing removed. Keep two-sided A/B, one-time authorization, device binding, device policy, existing grant/session lifecycle, and the 24-hour approval lease. CHANGE ONLY THE ENTRY/DISCOVERY/PAIR-ISSUANCE/APPROVAL UX so the AI Agent initiates a connection and the owner enters B on Local Wall or /account. Avoid the current two-way copy/paste friction and dependence on physically opening the target device Local Wall before starting. This P0 is for individuals, homelabs, multiple servers and small-business IT Support. Organization, tenant, support-agent groups/branches, role-based group device access and enterprise ticket/SLA management are deliberately OUT OF SCOPE for P0.

The exact owner examples are:
- Wall in standby displays a STABLE device short ID, e.g. ABCD02 = VPS-ARM. No live rotating A displayed until Helper receives a connection request for that device.
- On Agent request, backend creates temporary A: ABCD02-GHFDX (6-character stable prefix + 5-character short-lived suffix) and independent B, e.g. 7KPX-42NM. Agent displays B plus basic, verified target details (device name, OS, architecture, online state). Wall or the selected device row in /account shows A active and a MASKED B/pending state, never the B plaintext.
- Owner copies B from the AI response to the specific device's Wall /approve OR to its device approval area in /account; checks target/context and approves. Then Helper resumes the existing authorization/session mechanism. Do not require user to copy A from the Wall into chat.
- A rotating suffix is minted ONLY on an actual Agent-initiated request (NOT continuously while Standby), stays bound to that pending request for its limited lifetime, and is consumed/cancelled/expired appropriately. After resolution, return to standby.
- With 100 devices, Helper MUST NOT dump 100 device records or create 100 pair requests. Users can say "connect ABCD02", "connect VPS-ARM", "connect ARM", "connect Windows", or "connect THISPC". Helper searches only the signed-in account's permitted device metadata and returns zero/one/ambiguous results. For duplicate THISPC, explain how many matches, present a SMALL bounded disambiguation selection; mint A/B ONLY when one exact device has been resolved.
- If user has no knowledge of any machine, ask a narrowing question such as hostname, OS, alias or branch; searching by OS returns a count and at most a bounded shortlist, never silently chooses a default or the Main device.
- Existing 24h lease, device-level execution policy, PTY, Files, Real Remote V2, HMAC and tool execution are NOT to be rewritten.
- No new team IT roles/organization/group/branch permissions yet, but preserve extension seams for future IT Support.

### 1. Source facts verified on VPS-ARM via official Light Remote MCP
Repository: git@github.com:n8n2erpnext/light-remote-mcp.git, local canonical /home/ubuntu/n8n2erpnext/light-remote-mcp-main; Gold rebuild worktree /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/light-remote-gold-rebuild-20261018 on feature/light-remote-gold-rebuild-20261018; other, newer isolated Gold worktrees exist. Source inspection on 2026-10-28 used the clean newer Gold branch fix/gold-windows-relink-rm-stability-20261028, HEAD a97f874, to avoid relying only on old main/baseline. Gold rebuild branch was 8c28dff and already had unrelated dirty tracked/untracked files: NEVER reset, stage, or rewrite those while handling this handoff.

Verified source paths:
- plugin-server/tools.mjs around lines 170–195: light_remote_connection_helper presently accepts optional aCode regex 4+4 ([A-Za-z2-9]{4}-?[A-Za-z2-9]{4}), continuation and helperGroup. With aCode it calls a.pairBegin and returns approval_required + B + continuation. With continuation it polls. With no args it calls pairRecover and may return ready. The tool is remote:read scoped; OAuth is NOT device authorization.
- plugin-server/operator-adapter.mjs around lines 58–95: pairBegin posts /v1/device-pair/begin with accountId, agentId, label, aCode. pairPoll posts /v1/device-access/poll with requestId/pollToken; pairRecover posts /v1/device-access/recover and recover-consume; attachPairing posts /v1/agent-client/attach. Critically device grant attach is not the same as opening an execution session, preserving independent session-capacity enforcement.
- operator-host/executor-routes-device-channel.mjs around lines 227–290: /v1/device-pair/begin REDEEMS A first against connected device; builds a forced-approval access request with pairingId; /v1/device-access/request, poll, recover, requests, approve/deny and /v1/agent-client/attach already exist. This is the primary place to introduce a separate server-initiated, device-targeted issue path while reusing approved grant attachment.
- operator-host/device-pairing-registry.mjs: existing default A TTL 3 minutes (configurable bounded 30 seconds..10 minutes); eight-character 4+4 A; per-device current/rotate/redeem; A one-time and bound to accountId/deviceId/connectionId; currentByDevice and invalidation on rotation/device change; plaintext excluded from emitted rotation events. New standby/pending semantics need a carefully isolated modification or new issue method, not a second uncontrolled auth engine.
- operator-host/device-access-grant-registry.mjs: request() with deviceId/connectionId/agentId, userCode (existing B 4+4), poll/approve/deny/recover, REQUEST_TTL_MS 10 minutes maximum; /v1/device-pair/begin currently asks for 5 minutes pending. AB_GRANT_MAX_LIFETIME_MS is 24 hours. Grant is checked against connectionId; requests and grants have persistence in the source registry. Recovery currently keyed by accountId/agentId; prove exact-request continuation when parallel requests exist.
- device-agent/local-wall.mjs: Wall currently requests A with POST /api/pairing-code; refreshPairing() auto-refreshes A when countdown elapses and has Show/Copy/Refresh controls; /approve page prompts B and uses GET/POST /api/approve; underlying accessApprove/accessDeny callbacks. Current copy-A instructions explicitly ask owner to paste A into chat. The revised UI must replace this default UX for Gold P0, preserve protected mutations, CSRF and device identity checks, and preserve optional legacy flow during migration.
- plugin-server/account-portal.mjs: existing /account management includes device management/enrollment, but review found no present B-pairing approval interface under /account. It must be added, never claimed as already working.
- operator-host/device-registry.mjs: deviceId/accountId/displayName/platform/architecture/state and device listing are already modeled. Exact hostname/alias/group search and stable public short ID are not yet evidenced as supported; implement new scoped resolution carefully. Do not confuse Device ID with transient A code.
- deploy/scripts/selftest-v09-device-pairing.mjs, selftest-v09-device-access-grant.mjs, selftest-v09-pairing-connect-flow.mjs, selftest-gold-ab-native.mjs are regression bases, not proof new flow exists.
- Current Light Remote MCP helper confirmed the existing live behavior: normalFlow says Local Wall creates A, helper takes A, B is pasted on Wall, and helper resumes. This is what P0 should simplify, not bypass.

IMPORTANT Gold release-state distinction from /home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_RESUME_CURRENT_20261028.md: live Gold UAT LXD was reported RUNNING with mixed effective service source hashes and PostgreSQL schema 37 + one unresolved resource claim. Source, Git branch, CI, live UAT and production are distinct. Documentation must not trigger a UAT cutover, reset claims, modify database, or deploy anything.

### 2. Required protocol and UX
Recommended helper input (PROPOSED interface; do not claim current tool accepts it):
- targetQuery optional string (hostname, alias, Short ID, OS); exactShortId optional; mode: resolve | connect | cancel | status; continuation remains internal/optional; label of AI client. Keep legacy aCode input separately behind compatibility flag. Server MUST resolve account from signed OAuth identity, not from untrusted model-provided accountId.
- resolve only reads minimal account-scoped permitted metadata: short ID, device displayName, platform/OS, architecture, online/offline, optional alias. It never mints A/B, grants or a remote execution session.
- connect requires exactly ONE eligible, online, currently connected device and an owner/client identity authorized to request its approval. It creates a single bound pending request. If 0 or >1 match, fail closed with a helpful filtered result and ask user to select; no silent Main-device fallback.
- no targetQuery and no previously exact user-specified target: ask user for short ID/name/OS. On a 100-device account, do not unilaterally return 100 entries.
- client-visible response includes B, exact target short ID, displayName, OS/architecture, expiry/countdown guidance, approval locations and status; NEVER include hidden requestId, pollToken, grant, auth header or continuation secret in user-facing prose.
- Wall standby: show stable Short ID and "Standby", no live A suffix or copy-A workflow by default. Wall pending for this specific device: show A full + countdown, request label/AI client, B masked (e.g. ••••-••••), copy/paste B field, Approve/Deny. Plaintext B must not be included in Wall HTML/API/DOM/JS; CSS-only masking of a plaintext B is NOT acceptable.
- /account device row: show the same pending metadata only for the selected, server-authenticated device, and allow B entry and approve/deny after owner account authentication + CSRF + device authorization. For headless VPS/server, remote operator need not open Local Wall.
- Wall and /account MUST approve only requestId whose accountId/deviceId/connectionId match the trusted approver and the entered B; validate target summary on screen. Do not use B alone as authorization.
- On approval, preserve grant creation, agent-client attach, session-capacity enforcement, device policy/permissions, 24h lease, revocation, audit, HMAC, and existing execution tools. Device online 24/7 does NOT imply AI automatically authorized 24/7.
- Agent calls Helper again with no A and no secret continuation in user prose; backend recovers the EXACT bound pending request. If >1 matching pending for a given agent and no unambiguous server-held handle, fail closed; do not pick newest request. If MCP cannot securely preserve an exact request binding between calls, implement a backend-owned scoped correlation mechanism and verify in actual multi-client tests before rollout.

### 3. Device identity: six stable characters, five rotating characters
A new stable Device Short ID must be server-assigned at device enrollment, bound to immutable device UUID, reserved per backend/account as explicitly chosen by schema, and non-reused after device deletion/re-enrollment. Device UUID remains the authoritative internal identity. Device displayName and alias are searchable but NOT unique identifiers.

Proposed alphabet for short ID: Crockford Base32 0123456789ABCDEFGHJKMNPQRSTVWXYZ. It deliberately ALLOWS digit 0 and therefore the owner's example ABCD02; it supports human-friendly normalization (O→0, I/L→1) if desired. Distinguish this alphabet from existing A/B 4+4 alphabet ABCDEFGHJKLMNPQRSTUVWXYZ23456789 which excludes confusing glyphs. A rotating five-character suffix can use the existing crypto-safe 32-character alphabet. Use cryptographically secure randomness for all ephemeral codes; no counters or predictable timestamps.

Capacity: 32^6 = 1,073,741,824 possible six-character short IDs, i.e. capacity bound, not a promise of 1 billion collision-free random allocations. Random assignment MUST use a database unique constraint and retry on collision; at 100,000 assigned devices birthday collision risk without uniqueness is already nontrivial. IDs can alternatively use a collision-free server allocation with proper obfuscation. Short ID is public reference data, NOT an auth secret.
A example: ABCD02-GHFDX. Parsing requires new format 6+5 and legacy 4+4 during migration; strict formats and no ambiguous normalization of ephemeral B.
The five-character suffix has 25 bits of space, appropriate only as SHORT-LIVED request binding combined with authenticated approver, independent B, server rate limiting, exact device/account/client binding and nonce replay protection; it must never authorize execution on its own.

The backend can choose target via short ID / exact displayName / alias / OS filter AFTER account identity is known. Server must NOT infer tenant from short ID alone. One Short ID should not grant discovery to unauthorized accounts. An offline device is distinguishable but not connectable; report it instead of producing a bogus pending request.

### 4. Search rules and 100-device UX
Inputs:
- "Connect ABCD02" -> Short ID exact lookup -> 1 permitted device -> mint A/B immediately.
- "Connect VPS-ARM" -> exact normalized hostname/alias first; 1 -> mint, >1 -> clarify.
- "Connect ARM" -> bounded prefix/substring matches; respond count and a maximum of five safe choices; no A/B until selected.
- "Connect THISPC" -> if three same hostname, return "3 matching devices" with each distinct short ID/OS when authorized. Do not choose by newest, first or Main.
- "Connect Windows" -> if 38 matches, respond "38 Windows devices, please specify hostname/short ID/alias", optionally bounded cursor/pagination if the user expressly requests listing.
- "Connect Light Remote" -> ask which machine; helper may only return count/filters, NOT auto-dump fleet metadata.
Result shape proposal: status='no_match' | 'ambiguous' | 'resolved' | 'approval_required' | 'ready'; exact matches/total count, at most five displayed items; stable opaque nextCursor if needed; server-side deterministic match ranking and rate limits; ONLY safe metadata, no filesystem/process/capabilities or secrets before A/B.

Pre-approval discovery is an explicit new account-authenticated metadata privilege, not a grant for remote access. Rate-limit query enumeration, audit target resolution and reject arbitrary accountId/group searches. Do not assume existing light_remote_list_devices can satisfy this: current tool expressly lists only A/B-authorized devices. Either add a constrained "discovery" mode in Helper or a separate scoped metadata endpoint still reached through Helper; no global fleet scan.

### 5. A/B issuance and lifecycle — no hidden weakening
Proposed lifecycle:
STANDBY -> TARGET_RESOLVED -> PENDING_A_B -> APPROVED -> GRANT_ACTIVE -> EXPIRED/REVOKED
                                  |-> DENIED/CANCELLED/TIMED_OUT
- Do not rotate A in Standby. When connect request is accepted, mint exactly one A suffix and one independent B, both bound atomically to account, device UUID, connectionId, agentId/client identity, requestId, requested scope/purpose and expiry.
- Existing A default is 180 seconds; current pair route issues a 300-second B pending (subject to other limits). For V2 define ONE effective pending expiry: initially 180 seconds to preserve behavior, optionally 300 seconds after owner approval. Keep A and B valid until the SAME minimum cutoff and never rotate A during an active pending request. Owner said 3 minutes may be increased slightly, not to remove expiration.
- On approve consume both pending code states exactly once in a database transaction or equivalent atomic compare-and-swap; successful retry idempotently returns same result to the rightful Agent without double grant. On deny/cancel/timeout/disconnect/re-enrollment purge or invalidate both sides.
- If Agent issued a request but never gave/used B, timeout or explicit cancel invalidates it. No ghost pending requests and no reusing old A/B after timeout. Limit concurrent pending per device and per Agent; multiple are allowed only when UI identifies each by independent requestId/target/label and approved B maps to EXACT one request. At minimum test two concurrent sessions, parallel clients and multiple browser tabs. Never correlate by "latest pending for account".
- Wrong B attempts: constant-time verifier against stored digest, per-account/device/request/source rate limits, bounded guesses and temporary lockout; avoid leaking valid/invalid target via timing or response.
- Reject approval when target device connectionId changed, offline, revoked, un-enrolled, grant invalid, owner revoked, expired, wrong account/Agent or stale OAuth session. No A or B in logs, telemetry, events, exceptions, analytics or handoff.
- Redis for short-lived pending/TTL/lock/CAS, PostgreSQL17 for stable device short ID + ownership + auditable approvals per Gold persistence goal; final schema and canonical storage must follow active Gold service code, not introduce JSON/SQLite business-data fallback.
- Preserve explicit 24h grant ceiling and underlying session and policy controls. Do not accidentally conflate 3m pending TTL, 24h access grant, device cloud connection lifetime and individual remote job/session grace.

### 6. Implementation approach — smallest safe diff
Phase A / inventory and baseline lock (read-only): identify active Gold source and exact runtime SHA; inspect pending, server and Wall callback wiring, scopes and account auth, database migrations, audit event interfaces, tests. Confirm active build pipeline and clean worktree; no UAT reset or production modification.
Phase B / database identity: create stable immutable device_short_id with UNIQUE index; backfill existing enrolled devices without changing UUID, account or local keys; verify collisions, removal/re-enrollment, device alias mapping and rollback.
Phase C / scoped resolver: new account-authenticated lookup by ID/hostname/alias/OS; count + bounded results; resolve 0/1/N; deny remote metadata if account or permissions unknown. Never list full 100 devices by default.
Phase D / agent-initiated pairing: new operator endpoint and adapter method (suggest /v1/device-pair/agent-begin) that accepts resolved device UUID from trusted server lookup, not A pasted from Wall; mint ephemeral A suffix + independent B, persist atomic pending, preserve old grant mechanism. New Helper targetQuery/mode while retaining legacy aCode and continuation for reversible migration. Do not change execution tool schemas.
Phase E / Local Wall: Standby short ID, pending A and masked B, TTL/approval state, B input with CSRF, no auto-rotation while pending; provide optional old copy-A entry behind feature flag for transition.
Phase F / /account: same pending state per authenticated device row; request lookup + B verification + owner approval; no public unauthenticated approval endpoint.
Phase G / tests + Gold UAT: branch isolated from production, compile/selftest, simulated 100-device index, true account-scoped lookup, two simultaneous requests, restore/resume, disconnect/re-enroll, Wall and /account E2E, cross-OS smoke, actual 24h grant/session behavior. Only owner-approved UAT cutover; do not modify production.
Phase H / deploy + migration: feature flags per backend/client, preserve legacy A/B for older Windows/macOS/Linux agents and plugin versions; verify rollback exactly, unknown-version compatibility and no orphaned active grants. Track source commit, CI build and runtime SHA separately; old client fallback remains usable until migrated.

Suggested code touch points (review current active Gold branch before edits):
- operator-host/device-registry.mjs and Gold database migration module: stable short ID and index.
- operator-host/device-pairing-registry.mjs: "Standby"/pending suffix lifecycle or a compatible V2 issue method.
- operator-host/device-access-grant-registry.mjs: request lifetime/poll/approve/cancel/recover correlation and client binding.
- operator-host/executor-routes-device-channel.mjs and server route guard: authenticated target resolve/agent-begin, account/device validation.
- plugin-server/operator-adapter.mjs: pairBeginForTarget, resolve and exact pending recovery.
- plugin-server/tools.mjs and tool-helper.mjs: new Helper discover/connect status contract, legacy aCode compatible, tool guidance.
- device-agent/local-wall.mjs: A Standby and B-approval UI, no default copy-A request.
- plugin-server/account-portal.mjs (+ account-portal UI): device-level pending requests + B approval.
- relevant Gold storage, event/audit and tests. Do not invent filenames for actual Gold migrations until verified in implementation session.

### 7. Security / behavior non-negotiables
- OAuth account login authenticates account, not device control. Device authorization is granted only by valid A/B approval on Local Wall or authorized /account device row.
- Short ID, name, OS and online state are account-scoped metadata only; knowing a short ID or an old screenshot cannot grant execution.
- B plaintext shown ONLY to requesting AI Agent (not Wall); Wall /account must show masked request indicator and receive user-supplied B through protected form. B MUST NOT be server-returned in plaintext to the Wall to merely hide it in CSS.
- Two codes are independently generated and server-bound to exactly one pending request. A is created on demand, not displayed at rest. Correct B must be entered to approve; an unconditional "Quick Approve" that skips B is out of scope.
- No plugin tag workaround or assumed bypass of OpenAI/other platform safety controls. The request tool should perform metadata lookup + authorization request only until approval; user still must select/connect the app per client platform policy.
- Cross-device, cross-account, cross-organization and cross-Agent replay must fail; deny old connection IDs; enforce scope and CSRF.
- No plaintext A/B in logs/handoffs, no secret in redirect query, no exposed credentials, no agent auto-execute on pending.
- Gold state migration must remain PG17/Redis and preserve rollback; separate support team RBAC postponed.

### 8. Acceptance gates / measurable tests
GATE 1: enrolled Windows/macOS/Linux short IDs survive restart and remain unchanged while still enrolled; new/removed/re-enrolled mapping correct; no collisions after high-volume allocation.
GATE 2: request by exact short ID -> correct device details and exactly one A/B; Wall enters Pending ONLY on target; no other device sees it. Standby has NO active A.
GATE 3: exact name/alias/partial/OS searches: 0/1/many, 100 devices, repeated THISPC, Windows 38 matches. No bulk tool result by default, no auto-selection of Main.
GATE 4: B valid only at exact target's Local Wall and its /account device row; B masked before paste; invalid B, wrong target, expired, used, cancelled, denied, revoked, disconnected and re-enrolled request all fail. Single-use atomic.
GATE 5: two conversations and two clients targeting same device, two devices with identical names, two simultaneous Wall tabs: no wrong-client approve/resume or "latest request" confusion; no extra grants.
GATE 6: Agent Helper after approved -> exact authorized target, agent client binding, existing session / 24h grant / policy; PTY/Files/RM/tool access still gated as before; tool list and session capacity unaffected.
GATE 7: account authentication and owner CSRF for /account; remote:read discovery only scoped metadata; unknown/unowned target never leaked or paired. Runtime logs redact codes.
GATE 8: legacy A code 4+4 + B flow remains working under compatibility flag on older clients, and full rollback is validated without wiping grants/keys or devices.
GATE 9: Gold UAT deployed source == intended tested SHA, PostgreSQL/Redis readback and restart, no regressions in current known mixed-SHA/resource-claim gate; production untouched until explicit owner authorization.

### 9. OUT OF SCOPE / future IT Support
Organization management, tenant isolation across enterprises, Support Viewer/Operator/Device Manager/Org Admin, groups/branch hierarchy and per-group permission policies, IT team sharing/assignment, 24/7 auto-approvals, support ticket SLA/escalation, and cross-AI client adapters (Gemini/Claude) are future features. Their later design can reuse the same canonical device_short_id, owner-account metadata resolver, device-scoped approval, grants and audit, but P0 must not implement broad group RBAC.

### 10. Explicit unresolved engineering questions — must verify, not guess
1) What stable per-client binding survives separate MCP calls and browser sessions to recover the EXACT pending request? Current accountId+agentId recover path is not automatically enough if overlapping requests are possible. Decide scoped correlation + atomic retrieval.
2) What is the authoritative device table/PK/migration path in active Gold PostgreSQL schema, including re-enrollment and tombstones? Do not implement a parallel JSON registry.
3) How does Gold /account authenticate/authorize owner approvals against each device and enforce CSRF, rate limits, and preventing scope escalation? Inspect actual portal routing.
4) How can the 3m A TTL, existing <=5m pair request TTL and 24h grant share strict deadlines, especially under server restart, Redis expiry, and clock skew?
5) Should multiple pending requests per device be shown in a per-device queue or capped at one? Preserve multiple OAuth client behavior; never overwrite another request silently.
6) Does existing Wall refreshPairing() have other dependent uses (test, copier, UAT) that require backward-compatible events? Map before editing.
7) Which source worktree is now canonical Gold merge target? Gold UAT was reported mixed service SHAs; do not assume this design document branch is the deployed runtime.

### 11. Implementation session starter
Read this file, current Gold resume pointer, active Gold source HEAD and existing pending/approval registries. Produce a source-to-design change matrix and implementation PR only on an isolated Gold worktree. Do not touch production or run migrations before owner approval and a verified restore point. After implementation, verify all gates and write a separate acceptance handoff with exact commit, CI, UAT runtime hashes, SQL schema and results. This is documentation, NOT a shipped feature.

Summary of owner UX: say "Light Remote, connect ABCD02/VPS-ARM" -> helper finds EXACT target within signed-in account (or asks which THISPC if duplicates) -> server mints A (prefix+temporary suffix) and independent B -> AI shows B + verified target -> target Local Wall or /account shows pending A and masked B -> owner pastes B and approves -> existing Gold A/B grant/session mechanisms continue unchanged. An enterprise team/group permission system is LATER.
