# Light Remote Gold — Unified P2 release plan: A/B V2 + Agent nickname + Pro Share
Date: 2026-10-30 (Asia/Ho_Chi_Minh)
Status: **OWNER REQUESTED UNIFIED IMPLEMENTATION PLAN**. This document is an implementation/release specification, not a deployment or acceptance receipt. Execute on the Gold feature branch, feature flags OFF; no live UAT or production promotion implied.

## 1. Single release objective
Ship the P2 Gold release with **all four coupled workstreams** before the single final physical acceptance:
1. Core P2 Connection GC / execution epoch / signed terminal receipt / four-service rollback.
2. Owner-approved **Agent-initiated A/B V2** with account-scoped device discovery.
3. **Agent self-selected persistent session display nickname** with immutable sessionId.
4. **Pro Share**, reusing dormant Pro Team internals for **one Pro owner + one invited Free guest**, strictly scoped to selected devices.

Do **NOT** complete P2-C/D/E and then bolt on pairing/session/sharing. Introduce features behind independent flags, integrate and freeze one candidate SHA, then conduct one consolidated acceptance across auth, native clients, Wall, billing, updater and rollback. CI unit/regression runs on every implementation change; the expensive physical release acceptance runs once on the **final frozen candidate**, with targeted reruns only for affected gates if code changes after freeze.

**Owner product decisions are authoritative**, but actual paid launch still requires billing configuration and explicit owner commercial sign-off. Do not activate add-on payments or guest execution in live Gold while designing.

## 2. Read-first source decisions
- `/home/ubuntu/handoffs/GOLD_AB_V2_DEVICE_DISCOVERY_AGENT_INITIATED_SESSION_HANDOFF_20261028.md`
- `/home/ubuntu/handoffs/LIGHT_REMOTE_AGENT_SESSION_NAMING_HANDOFF_2026-10-29.md`
- `/home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_PRO_SHARE_PIVOT_2026-10-29.md`
- `/home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_P2_MASTER_HANDOFF_20261030.md`
- `/home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_P2_B_ENROLLMENT_REPLAY_20261030.md`

Current Gold source authority: VPS-ARM worktree `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/gold-windows-stability-20261028`, branch `feat/gold-connection-gc-reconciler-20261029`, baseline at plan start `d6892d7d99b585ff355caf7503de877bbfc3068c` (CI #41025222358 PASS 4/4). Source HEAD can advance; read Git log and diff first. Gold UAT live `light-remote-gold-uat` remains PG039 with four services; migrations 040–042 only tested in source/isolated clone. A/B V2, nickname and Pro Share are **not shipped**. Production rc47 must not be changed.

Current source audit highlights: `plugin-server/tools.mjs` helper takes 4+4 A code; `plugin-server/operator-adapter.mjs` still instructs copy A from Wall. `executor-routes-device-channel.mjs` and `plugin-server/operator-adapter.mjs` hardcode `ChatGPT Light Remote`; session registry stores `label`, but helper label does not reach the durable session display path. `executor.mjs` sets `teamSessions=null`; Team routes expose `crossAccountExecutionEnabled:false`. No approved Pro Share execution or Paddle product exists. New `lib/gold-verified-channel-context.mjs` is used only by test fixture, **not Operator runtime**.

## 3. Unified identity and authorization model
Keep these identifiers independent:
- Account principal / verified OAuth identity; optional delegated Pro Share actor account.
- Immutable device UUID + owner account + **public stable 6-character short ID**; display name/hostname/alias are nonunique search metadata.
- Device Ed25519 enrolled identity / signed connection ID and revocation state.
- One-time A/B request ID + requester Agent/client principal + short pending TTL.
- Explicit owner's device permission, A/B authorization grant with hard **24-hour** approval ceiling.
- Remote durable `sessionId` (unchanged by nickname, reconnect, hold, GC, A/B reapproval); `displayName` is only metadata.
- Pro Share membership/guest seat + explicit owner-device share + guest's independent A/B grant.
- Job/command/operation/execution epoch + native process identity / exact signed terminal ACK.
- `actorAccountId` and `billedAccountId` never infer from a client-supplied body.

**Authorization intersection on every guest action**: trusted guest OAuth + accepted invitation + currently paid/eligible owner add-on + explicit device share + exact guest A/B grant + connection/session validity + owner-approved device capabilities + guest restrictions + resource/work quota. Deny when any leg fails, including between queued and dispatch. Account login alone never controls a device; a short ID is not a credential; session displayName never grants permissions.

Pro Share uses public term **Pro Share** (not Family), proposed `$20 Pro + $5 optional guest = $25/month`. Exactly one invited guest, whose account may remain Free. Owner pays and guest usage consumes owner add-on, **not guest Free quota**. Keep Pro Team five-seat implementation/tables/tests dormant, no mass rename or deletion. Pro Assist is deferred. Candidate cap 1 guest Agent running, 2 guest retained sessions, 5,000 guest calls/month **UNCONFIRMED commercial defaults**. Never activate billing or imply these caps/prices are already charged/entitled.

## 4. A/B V2 exact product protocol
1. **OWNER CLARIFICATION 2026-10-30: always show the stable six-character prefix.** Wall in STANDBY visibly shows the permanent server-assigned device Short ID (e.g. `ABCD02`); authorized `/account` device rows and device-selection results may show the same public Short ID at all times, including offline/no pending request. This is the **fixed first six characters of V2 A**, not the complete one-time A code. Do **not** mint, show, count down, auto-refresh or rotate the **five-character suffix** in STANDBY. When exactly one Agent-initiated request is pending, show the *same fixed prefix* joined with its fresh suffix (e.g. `ABCD02-GHFDX`) and the request countdown; after approval/deny/expiry revert to only `ABCD02` in STANDBY. Device UUID remains authoritative; reserve immutable 6-char Crockford Base32 ID in PG17, uniqueness/collision retry, never recycle tombstoned ID. The public prefix is a nonsecret identifier, NOT an access code or authorization; account-scoped visibility rules still apply.
2. Owner or guest says e.g. "connect VPS-ARM / ABCD02 / Windows / THISPC". OAuth-scoped resolver shows ONLY permitted devices: owner-owned for owner, expressly shared owner devices for an invited guest. Return 0/1/N with count and at most 5 safe choices. Duplicate THISPC or 38 Windows matches require selection; never auto-pick Main or mint pending requests on ambiguous targets. Metadata discovery is not A/B authorization.
3. On exactly one online permitted target, helper initiates backend-bound request with A `6 short ID + 5 rotating characters` created ON DEMAND, independent B `4+4`, and one pending lifetime (~180 s first candidate). Both bound to account/client Agent/owner device/connection/request/grant scope, stored atomically with nonce/replay/rate controls. Agent sees **B plus verified target details**; no need to copy A from Wall.
4. Target Wall or owner-authenticated `/account` shows pending A, countdown, requester and **masked B indicator, never B plaintext in DOM/HTML/API**. Owner pastes B, verifies device and request, Approve/Deny; CSRF, owner account/device constraints and constant-time code verification required.
5. After approval helper resumes the **exact pending request** without reusing one-time A or exposing continuation secrets; grant/session creation uses existing governed mechanisms, 24h A/B lease, policies and separate session expiry. Race/retry idempotent; 2 Agent conversations / tabs / devices cannot hijack "newest" pending.
6. If expired/cancelled/denied/revoked/offline/connection ID changed, refuse and invalidate; legacy 4+4 A→B remains under compatibility flag on older Windows/macOS/Linux/plugin clients. No silent fallback to a different target.

## 5. Agent nickname, integrated into same A/B ready flow
After exact A/B approval and session creation, AI Agent **automatically chooses** nickname; no user prompt or extra approval. Examples: `ChatGPT Black Cat`, `ChatGPT GPT-6 Silver Fern`, `Claude Golden Mango`. Themes freely chosen from fruit, animals, insects, places, flowers, plants; optional inspiration library, **no server random fallback** and no mandatory fixed list. Model suffix only when reliably known; never inspect private prompts or guess model. Self-declared model is display-only and untrusted.

Persist `displayName`, source/owner priority and timestamp in existing authoritative session store (PG/Redis as appropriate), not separate JSON/SQLite. Owner rename wins; first authorized Agent nickname wins otherwise; legacy label visible temporarily or for old sessions until named. First-name idempotent, optional same-account collision suffix, strict Unicode/HTML/control/Bidi validation, no cross-Agent/session rename. Resume/restart/reapproval/GC must retain same name AND same immutable sessionId. Agent nickname failure must **never block A/B, helper ready or any job**. The helper's existing `label` is NOT proven to be persisted; correct routing or a nonblocking authorized metadata call is required.

## 6. Pro Share implementation on retained Pro Team core
- Preserve existing `ProTeamRegistry`, PG team tables, invitation/inbox, device sharing, audit, and historical 5-seat tests unchanged. New distinct `pro_share` add-on entitlement defaults OFF; limit SELLABLE guest seats to owner+one without globally editing `MAX_SEATS=5`.
- Existing team dispatch is only preview and `teamSessions=null`; do not flip those switches globally. Add a narrow authenticated guest execution path for exactly one allowed guest and selected owner devices. Verify actor OAuth at issuance AND dispatch, guest A/B on that device, owner share/grant, capability intersection, current entitlement and expiry, and owner-paid operation debit **exactly once**.
- Use owner-paid, independently bounded quotas with per-operation idempotency; guest's personal Free quota and private devices unaffected. Shared physical device locks are account-independent; owner workload cannot be starved by uncontrolled guest jobs.
- Revocation/unshare/guest removal/add-on lapse/downgrade/24h A/B expiry immediately prevent new commands and fence queued commands; in-flight side effects are not silently considered terminated. No broad account mismatch bypass, no owner grant inheritance, no delegated re-share, and no guest access to another owner's sessions/output.
- Simplify UI to **Pro → Add a Guest (+$5/month, proposed) → Invite Email → Share Device → Guest A/B V2**. Guest uses own login and approved Agent. Owner sees which devices and usage are shared, revoke button, and audit. Keep any old Team UI hidden from normal customers, never delete it.
- Real Paddle entitlement/billing connection, taxes, caps, prorations and public paid availability remain **commercial activation gates**. Implement safe UAT feature path and ledger first; never create invoices/subscriptions or publish marketing copy as part of this plan-only commit.

## 7. RESEQUENCED P2 execution — one integrated delivery train
Use ONE Gold implementation branch/worktree linked to the current P2 source (or topic PRs merged into it in a fixed order). No parallel runtime forks. A/B, nickname and sharing must all converge **before candidate freeze**, rather than reopening P2-C tests afterward.

| Stage | Work | Hard exit gate |
| --- | --- | --- |
| **P2-I0 Source/contract freeze** | Audit active Gold source/runtime/service SHA, migrations lock, plugin scope, owner vs guest OAuth, SessionRegistry/Redis mutators, existing team dispatch and Wall/account routes. Define exact signed request/metadata API contracts and flags. | Source-to-design map + no conflicting migration/version/worktree + baseline CI |
| **P2-I1 Persistence foundations** | Introduce additive, reversible PG schema **after 042** for stable short IDs, paired-request/audit mapping, session naming metadata and Pro Share subscription/seat/device allowlist/usage as needed. Use Redis8 only for TTL/CAS, PG17 for durable ownership/state. Backfill with collision handling, zero forced rename/re-key. | Independent restore/restart/readback, old code tolerates new columns, migration lock hashes and rollback script tested on isolated clone |
| **P2-I2 A/B V2 + discovery** | Scoped resolver, stable short ID, on-demand atomic A/B, exact pending correlation, helper/operator adapter, Standby and pending Local Wall, protected `/account` B approval, legacy path. Add separate guest-eligible lookup constrained to expressly shared devices (initially disabled). | 100-device enumeration limits, concurrency/expiry/replay/CSRF, old/new plugin and Win/mac/Linux compatibility PASS on fixtures |
| **P2-I3 Durable Agent nickname** | Nonblocking first Agent-selected metadata on ready, authoritative session persistence, owner rename precedence, Wall/account label, durable Hold/reconnect/reapproval. | 2 different AI clients with immutable sessionId, rename/race/XSS and fallback label PASS |
| **P2-I4 Pro Share core** | New entitlement and seat cap2, owner invite + guest Free acceptance, explicit per-device share, independent guest A/B V2, tightly-scoped actual guest dispatch and owner-billed usage. Keep public add-on checkout OFF. | Real synthetic owner/guest/other-owner isolation, 403 denials, exact-once budget, revoke/queued-work fences, no 5-seat scheduler activation |
| **P2-I5 Integrated candidate freeze** | Merge all features, flags OFF by default; bring 040–042 + new migrations into one immutable candidate, isolate test account/device allowlist. Run full source/PG/Redis/CI tests and paired rollback on clone, then record one **frozen SHA**. | Full automated matrix PASS; rollback + source-to-deployed SHA, baseline historic data preserved |
| **P2-C ONE final physical UAT** | On **owner-authorized Gold UAT only**, exercise single A/B V2→nickname→owner/guest shared job→receipt/revoke/GC flow on Win10 and Win11 plus macOS/Linux compatible paths, Wall5491, Fleet5492, `/account`, plugin clients, owner browser. | Combined signed physical E2E evidence/negative cases PASS at frozen SHA; no fake ACK |
| **P2-D Signed client update** | Signed installer/updater package, Windows/macOS/Linux upgrade and rollback, helper version compatibility, restart/reconnect, memory/session preservation; feature flags staged. | Publisher signatures or documented equivalent and upgrade/failed-package/rollback receipts PASS on same build |
| **P2-E Release readiness** | Four-service immutable candidate, independent fresh PG+Redis+unit backup/restore, migration and rollback, canary/health telemetry, exact source↔binary↔runtime SHA; explicit owner decision for production release. | All gates signed off; production rc47 archived, unchanged until separate cutover approval |

Dependencies: I0 → I1 → I2; nickname I3 depends on the final session creation/ready contract of I2; Pro Share I4 depends on account-scoped discovery, guest-specific A/B and durable session metadata. I2/I3/I4 are NOT production enabled independently. I5 → P2-C → P2-D → P2-E. Existing P2-A isolated rollback and P2-B source/fixture successes are reusable evidence, not a substitute for the new combined candidate's migration/rollback test.

## 8. One combined acceptance matrix: avoid redundant certification
A test ID can be accepted ONCE for an unchanged code/artifact SHA, with a stored receipt, rather than manually repeating it at each feature stage. Each new commit still runs fast CI security regression. At freeze, one integrated end-to-end checklist covers:

| Test group | Required cases | Acceptance evidence |
| --- | --- | --- |
| **M1 pairing** | Owner and invited guest; 0/1/N target; duplicate hostname; 100 devices; A on demand/B protected; multi-Agent concurrent; 180s expiry, disconnect, wrong B, revoke; 24h grant | Real Wall and /account plus server audit; zero wrong-target grants |
| **M2 naming** | Agent auto nickname without user step; no model available; flowers/plants; two identical names; resume/HOLD/reconnect/reboot; owner override, XSS; session ID invariant | Session table+Redis readback, wall display and client identity proof |
| **M3 guest isolation** | Pro owner/Free guest/unrelated Free; invite/accept; one explicitly shared device, one private; guest independent OAuth + A/B; resource locks; quota owner-billed exact once; remove guest/downgrade/revoke midflight | Real distinct principals + ledger; no privilege/usage leakage |
| **M4 signed effects** | Win10/Win11 reconnect/reboot; stale epoch, unknown/no-PID, receipt replay, session capacity and GC fences, real job cancellation | Authenticated native Agent + server receipt; no fabricated termination |
| **M5 client/Walls** | Local Wall 5491 + Fleet Wall 5492 + owner account portal; Win10, Win11, macOS/Linux selected compat cases; generic MCP clients ChatGPT + another provider | UI recordings/snapshots and backend sources on SAME frozen SHA |
| **M6 upgrade/rollback** | fresh backup and independently restored PG/Redis; four-unit systemd swap; successful and deliberate failed candidate; signed updater; preserved A/B grants, nickname, invite and usage | Restore receipts, SHA/provenance and release flags verification |
| **M7 safety/scale** | 1k/10k synthetic signed devices, concurrent pending pairing, nickname uniqueness and billing idempotency under two Operator instances; Redis/PG crash/restart | CI output plus no stale access resurrection/double-charge |

**Stop/retest rule:** if a late fix changes permission, pairing, session persistence, native process or billing paths after freeze, run affected M-groups + cross-feature M1/M2/M3/M4 smoke and issue a NEW frozen SHA. Do not claim old physical PASS for newly modified code. Pure text/UI copy can use scoped visual regression when security logic unchanged. This is how to prevent needless repeated full UAT without weakening release safety.

## 9. Security, migration and release switches
Proposed isolated switches (verify actual configuration naming at I0; names are not live variables): `GOLD_AB_V2_DISCOVERY`, `GOLD_AB_V2_AGENT_BEGIN`, `GOLD_SESSION_AGENT_NICKNAME`, `GOLD_PRO_SHARE_UAT`, `GOLD_GUEST_DISPATCH_UAT`, and existing signed-epoch/GC/monitor feature gates. Each is OFF by default and allowlisted to explicit UAT owner accounts/devices/Agents. Do NOT expose an endpoint merely because a UI toggle is hidden; hard backend authorization controls remain mandatory.

Schema versions **043+ are reserved for planning only**: confirm migration lock at implementation, allocate sequential immutable SQL files and lock SHA hashes. Do not rewrite 040–042 or overwrite existing migration numbers. The legacy A/B path and owner personal Pro path must function while new flags OFF. PostgreSQL/Redis failure = deny or safe retry, not fallback to JSON, in-memory grant, unlimited quota or auto-approval.

Roll back **code/flags/UI** first where possible; never roll schema backwards by dropping active authorizations without verified migration rollback and owner consent. Rehearse restore on the isolated clone using original 039 dataset and compare all 27 unknown-work rows and one remaining historical M4 claim. Two owner-orphan recoveries from 2026-10-29 are historical audited UNKNOWN releases: do not re-run or count them as signed terminal proof for the separate remaining claim. No mass cleanup or fabricated ACK.

## 10. Proof boundaries and action authorization
**PASS already reusable:** P1 A–E source/CI, P2-A real isolated 039→042 and paired rollback rehearsals, P2-B no-NIC signed HTTP/real PG fixture, native Win10 offline modules, enrollment replay fixtures, CI 4/4 on baseline d6892d7. **NOT YET PASS:** live Gold epoch041, real enrolled-Agent signed terminal ACK for historic M4, exact runtime Operator callback with real enrollment, Pro Share real cross-account guest execution/billing, A/B V2 UX, nickname persistence, signed installer/client updater, Fleet5492/Win11 final physical E2E.

This new integrated plan **authorizes source development, tests, CI and isolated clone exercises now**, following the owner's request to integrate into P2. It does **NOT** authorize changing live Gold UAT schema039, releasing any historical claim, turning on real paid billing, disabling approval, or production rc47 cutover. Request a separate explicit owner decision only at the high-risk live P2-C/E cutover or paid public activation gates, after the single combined test candidate is ready.

## 11. Immediate implementation queue
1. Add this plan to Gold Git; verify clean branch, source-to-runtime map and CI by exact SHA; create one acceptance evidence index keyed by SHA and M1–M7.
2. Start P2-I0 with the concrete routes/migration tables/mutator whitelist and current Tool schema, so there is only **one** canonical account discovery→pending approval→working session path.
3. Allocate additive migrations and smoke tests on no-NIC clone, then implement A/B V2 account-scoped resolver first (no grant on discovery). Continue exact request issue/approve and legacy compatibility.
4. Wire first Agent nickname into the post-ready session metadata using existing durable session registry; implement owner override.
5. Activate Pro Share code behind OFF-by-default UAT flag and integrate guest scoped discovery/A-B and metered dispatch.
6. Produce immutable integrated SHA, automatic cross-feature smoke/rollback, then schedule one P2-C physical acceptance and signed updater P2-D before any P2-E release approval.

Maintain one handoff pointer, one release manifest and one signed/dated evidence matrix. Do not restore old split workstreams or spend another full physical UAT on a partial candidate.
