# Gold Codex Supervisor — 2026-10-26

## Original goal
Extend useful work after a ChatGPT Web turn/session stops by delegating
explicitly scoped work to the owner's ChatGPT-plan Codex app-server, with
Task Controller as durable authority and optional Long Memory handoff.
This does NOT secretly restart or inject turns into ChatGPT Web.

## Implemented bounded owner-delegated lane
- New native Wall UI on /codex-cli using existing CSS, Material icons, and
  Owner+CSRF API: 'Delegate to Codex', Pause/Stop, Refresh, receipts.
- Each authorization names one existing Task Controller task and a bounded goal,
  a specific approved local workspace, and 1..5 independent rounds (UI default 2).
- Missing workspace defaults to a private per-task directory in codex-workspaces.
  Working on an existing project requires the owner/admin to allow a directory
  via LIGHT_REMOTE_GOLD_CODEX_WORKSPACE_ROOTS (path-delimited absolute dirs).
  Only canonical allowed realpaths accepted; the Codex runtime additionally
  enforces workspace-write OS sandbox, approvalPolicy never, ephemeral threads.
- Gold local Agent timer checks every 15 seconds even if ChatGPT Web is closed.
  Only owner-delegated armed tasks are picked; one task/turn at a time per device.
  Each Codex turn bounded to 120 seconds; timed-out Codex child is terminated.
- Each turn produces an immutable SQLite supervisor receipt and structured
  recommendation CONTINUE/CONTINUE_SECTION_B/WAIT_OWNER/DONE, with freeform
  or failed output conservatively mapped to WAIT_OWNER.
- CONTINUE continues a bounded next round; WAIT_OWNER pauses further action,
  DONE becomes review_required and NEVER approves Task Controller Done.
  Budget exhausted stops until owner explicitly re-arms the task.
- A restart/crash while a Codex turn is running yields WAIT_OWNER, preventing
  duplicate edits of an unknown workspace state. Task Edit/Delete and state
  transitions are blocked during the critical running turn.
- Long Memory OFF: Codex Supervisor still works independently.
  If Memory ON and a task was explicitly bound to an authoritative Home scope,
  its Codex receipt is saved as an 'observed' Home-signed handoff in ONLY that
  scope. This is not presented as an owner-approved completion.
- Both modules OFF: normal Light Remote unchanged, no unsolicited Codex work.

## Tests
- Mock Codex app-server verifies workspace-write JSON-RPC, no auto approval,
  ChatGPT Plus auth and no Platform API key fallback.
- Device-local SQLite fixtures cover owner-only authorization, workspace
  allowlist, real bounded file writes, rounds, receipt retention, crash recovery,
  pause, final owner approval required, isolated scoped Memory and CSRF.
- Chromium fixture: owner delegates in original Gold Wall, closes browser,
  background supervisor advances work, reopens browser and reads receipt.
- No real owner task or project modified during automatic tests.

## Truthful limits / next gates
- This does not extend the actual ChatGPT Web process/harness or send a new
  Web chat turn. The device-resident Codex worker can continue separately.
- Four-state recommendations are advisory, not a full section/dependency DAG;
  CONTINUE_SECTION_B requires future explicit section scheduling logic.
- No server/cloud transcript mirroring; Long Memory only receives explicitly
  owner-bound scopes and signed receipts.
- Workspace-write mode must pass a real isolated Codex UAT test on this
  platform; fixture tests alone cannot prove Codex CLI provider support.
- Rollout to other devices requires their native Agent update (Windows build).
- Rollback existing Gold LXD snapshot first; never modify production.
