# Light Remote Gold — Long Memory + Codex Observer corrective audit and handoff

Date: 2026-10-24 Asia/Ho_Chi_Minh
Worktree: feature/project-continuity-plan-20261023, descendants of frozen Windows Gold #486
Source baseline that must remain usable: 30766940ac18e55cb735354b40a3af9ba37eddb8
Previous branch HEAD: 5189c97e8027bb5cbb4fbbf0120aaa3d38a29dac
RELEASE: BLOCKED. Code/source tests only; no build or production changes.

## Authoritative user requirement (supersedes old P4 delegated-worker plan)

Extend the existing, already tested Light Remote Gold. ONE Account identity, ONE Wall, same Agent/Operator/Plugin/A-B/permissions/Fleet/Filesystem/PTY, same product. Do not rebuild Gold, create another Gold service/Wall, or require a new account. A bundled private IPC subprocess may protect the local SQLite database as part of the Gold Client; it is NOT an additional remotely hosted service.

Two independent Gold device-level modules, both OFF by default; neither needs a user-created Project:

1. **Long Memory** (previous working name Project Memory). Aim: maintain ongoing work context across ChatGPT Web sessions without manual handoff, context-meter estimates, or repeatedly reconstructing commits/handoffs. Sources: verified Gold tool receipts, owner-confirmed decisions, cited notes and explicit agent-submitted checkpoints when such authenticated capture is available. Store private context/receipts locally in SQLite on the owner's CLIENT. Gold cloud may confidentially relay owner-approved bounded results, never retain raw chat, credentials, complete Memory or a second copy in PostgreSQL/Redis/analytics/job logs. Cannot read the hidden ChatGPT Web context or remaining context capacity through existing plugin tools; automatic knowledge of unobserved conversation is NOT supported.
2. **Codex Bridge — observer/coordinator ONLY**. Optional Codex availability, including owner-authorized official plan sign-in / supported Codex runtime. Monitor Controller task state and suggest CONTINUE / WAIT_OWNER / DONE (with evidence). Codex DOES NOT perform edits, execute user jobs, own the workspace, create a second Agent or auto-approve actions. User originally wanted it to act like human "tiếp tục" across ChatGPT Web turns. There is presently NO VERIFIED supported API in the installed Gold connector to inject a new user turn or resume a ChatGPT Web reasoning invocation. Do not fake this by browser clicking, API-token extraction, uncontrolled retries or turning Codex into a worker. Leave true automated Web continuation OPEN pending a documented supported integration.

Both modules OFF: exactly the tested Gold core, no Memory writes, no Codex process. Memory-only needs no Codex. Codex-only needs no Memory. Both ON share local Controller evidence with explicit access checks. Task Controller is an internal deterministic state/receipt coordinator, not a third module or independent product.

## Code inventory: KEEP / CHANGE / REMOVE

KEEP (reusable and aligned):
- device-agent/project-continuity-store.mjs: SQLite WAL, local source refs, memory FTS5, Controller tasks, approved evidence, append-only event/receipt model, idempotency and crash/UNKNOWN reconciliation.
- owner-broker, owner-grants, IPC/client adapter: sealed signing-key and signed owner consent. A separate internal OS process may protect memory but must ship and update as part of Gold.
- operator-host signed session delegation and confidential device response: device binding and owner-approved remote read; no cloud body persistence.
- Gold Client Core manifest superset, original operator-agent.mjs/local-wall.mjs, Gold Account login, user Permissions/A-B; feature gated OFF.

CHANGE THIS TURN:
- Device-side schema v10 adds bounded local Gold tool activity receipts (only category, outcome, timestamp, dedup key; no command text, args, outputs, secrets). Captured PASSIVELY from the original Gold duplex and poll command completion, only if Memory feature opted in. A failed Memory write cannot fail/slow the original Gold command. Context brief includes source-labeled metadata in the hidden default scope. This is SOME context continuity, not full transcript.
- Existing Plugin project-context tool can use default scope when projectId absent. The EXISTING Gold connection_helper opportunistically retrieves a short local brief ONLY from an active session after the owner issued signed remote-read consent; timeouts/denials preserve helper normal behavior. Nothing is persisted on Gold Cloud.
- Same Gold Wall: global Long Memory + Codex toggles are not overwritten by Project selection; default-scope owner remote-read approval/revoke + remembered context activity + default plan ledger work with no Project; Codex labeled observer-only. Account-only mode continues to authenticate through the current Gold Account (not new uat-owner).
- Codex app-server proposal stays read-only/non-authorizing and marks Web turn continuation NOT SUPPORTED in this bridge. No worker dispatch surfaced.
- Plugin automatic recovery helper extracted to pure fail-closed function for isolated tests; no new account or process.

REMOVE FROM FEATURE BRANCH (historical Git commits preserve receipts):
- device-agent/project-continuity-uat-wall.mjs: false synthetic Wall.
- UAT synthetic Wall/NAT Account/emergency enrollment shell scripts and temporary NetBird browser tools. None are product features.
- Remove delegated Codex worker from authoritative future delivery plan. Historical Controller claims may remain internal for Gold/native receipt/idempotency but are not exposed to Codex and must not become a worker feature by accident.

STILL OPEN / NEVER CLAIM PASS:
- Capturing owner intent and ChatGPT Web-only reasoning/decisions without an explicit tool-visible source. Need a supported API for ChatGPT to submit verified milestone notes and retrieval in a new conversation; the platform does not reveal invisible context.
- Proving remote plugin context helper, owner consent and Account/Wall live on a REAL enrolled device, with no false A/B claims. Pure unit tests are not remote acceptance.
- Real Codex app-server observation on owner-authorized Plus/Codex runtime; server login/entitlements validation, privacy and token budget. Mock proposal is not actual Codex.
- Official, supported way to continue ChatGPT Web reasoning across its platform-enforced turn boundary. No such API has been proven from the existing Gold connector. If unsupported, expose safe draft/resume plan to user, NOT simulated automatic resume.
- Across Windows native DACL/CNG/Service SID, Linux Server, macOS/Keychain and Linux Desktop integration. Owner-tested #486 unchanged. No installer until gates.

## Focused tests completed

- Gold Client Core 102 files after adding passive observer; manifest includes every frozen Gold #486 source path, staged/verified SHA256 and packaged Wall assets.
- opt-in local Gold tool receipt metadata only, duplication suppression, secret output exclusion, safe failure isolation; v10 schema migration tested.
- SQLite schema v10 migrated from v3; Memory-only/Codex-only/both/OFF modes; no Project prerequisite.
- default Memory source, owner Ed25519 consent/revoke and fail-closed remote read across SQLite reopen.
- same Gold connection helper automatic recovery pure fixture: active session and owner consent required, bounded nonblocking return; OFF/OFF and timeout safe.
- signed Operator relay/pinned device/session + no-job confidentiality regression; exact authenticated GOLD Local Wall API test for default scope, recent activity and CSRF; packaged Wall source/branding regression.
- Codex Supervisor mock read-only proposal; no live Codex/ChatGPT Web turn control.

One comprehensive Plugin test required zod package unavailable in this worktree, so **NOT PASS**; it may run in the normal CI where dependencies are installed. No source compile success implies actual connection/session readiness. The only verified cross-session return to the ChatGPT Web connector is a PURE HELPER MOCK. No live owner-approved Gold A/B cross-chat run occurred.

## Rollout / next engineering milestones

M1: Client-local memory capture from Gold tool receipts (source proof), owner-authorized default memory and implicit bounded context from plugin helper (source proof); implement authenticated ChatGPT milestone note submission only through an approved, auditable A/B route. A meaningful automatic handoff requires context actually observable by Light Remote.

M2: On an already enrolled owner-tested Gold device with the SAME Account/Wall, acceptance: memory ON, Agent runs work in Web session A, source-linked significant decisions submitted, new Web session B calls ordinary helper and recovers correct objective/decisions/unfinished work. No Project, no manual handoff, no duplicate effects. OFF/OFF Gold smoke.

M3: Codex-only read-only observation of Controller plan with supported owner-authenticated Codex app-server, recommendation receipts, no filesystem edits, task execution, owner auto-approval or Web turn injection.

M4: Only if official ChatGPT Web extension/API supports continuing turns, add explicit governed coordinator trigger. Otherwise preserve waiting state and provide direct, actionable safe continuation to user. Never conceal the platform limitation.

M5: Windows and Linux Server physical parity first, then macOS/Linux Desktop; Gold #486 rollback and one final installer only after all release gates.

Never return to standalone Projects UAT, duplicate Accounts, host-NAT experiments or pushing production Gold without owner acceptance.
