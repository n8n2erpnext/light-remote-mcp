# Gold Codex Review Loop — microtask orchestration plan (2026-10-26)

## Goal — user's original acceptance
ChatGPT (or another authorized coding agent) performs a **very short** step, sends an actual work report and evidence; independent ChatGPT Plus Codex reads them and explicitly tells the agent **CONTINUE** or **WAIT_OWNER**. The next predefined step must stay **locked** until a valid Codex decision. Repeat, then the final report receives **DONE** for the plan, not the owner's Task Controller approval.

This is a different optional capability from Codex Supervisor V1's autonomous coding worker. It is hosted **inside the existing Gold Wall** at `/codex-cli`, with the original CSS, fonts, icons and owner/CSRF protections.

## Three-step practical test plan

| Step | Agent performs | Required evidence | Codex gate |
|---|---|---|---|
| T1 | Create one tiny isolated file containing a declared string | Exact filesystem path and verified content/hash | Only `CONTINUE` unlocks T2 |
| T2 | Independently read and verify T1 output | Readback + explicit PASS/FAIL and expected contents | Only `CONTINUE` unlocks T3 |
| T3 | Prepare a handoff with results and receipt identifiers | Evidence from T1 and T2, no unsupported claims | `DONE` closes the review plan |

For each step, report through `/api/gold/modules/coordinator/report` using `planId`, `stepIndex`, `expectedRevision`, `summary`, and `evidence`. If Codex responds `WAIT_OWNER`, the plan does not advance. It persists a review receipt in SQLite. On crash mid-review, plan goes `waiting_owner` and does not automatically advance or repeat the agent's task.

## API and Wall controls
- `POST /api/gold/modules/coordinator/create` requires an authenticated owner, CSRF and `ownerApproved=true` (2–8 steps).
- `GET /api/gold/modules/coordinator`, `GET /api/gold/modules/coordinator/plan?planId=...` and `GET /api/gold/modules/coordinator/receipts?planId=...` retrieve state.
- `POST /api/gold/modules/coordinator/report` uses a CAS plan revision; concurrent/replayed/out-of-order submissions fail closed.
- Wall provides `Codex Review Loop`, built-in three-step plan, report/evidence fields, per-step status and the Codex decision.
- Codex review is an ephemeral `sandbox=read-only`, `approvalPolicy=never` app-server turn authenticated with ChatGPT Plus. Agent reports/evidence are labeled untrusted; Codex is directed not to run commands or read/write files during review.
- Codex output accepts only a single explicit `DECISION: CONTINUE|WAIT_OWNER|DONE`. Unsupported, missing, conflicting, premature and failed answers resolve to `WAIT_OWNER`.

## Required verification stages
1. **SQLite fixture:** three gates, locked steps, revised state, WAIT_OWNER, persisted receipts after restart, no auto owner task Done.
2. **Chromium:** create plan on real Gold Wall markup, submit 3 short reports and verify next-step unlocking; owner auth and CSRF.
3. **ARM UAT live:** use real ChatGPT Plus Codex, create one isolated plan, submit T1/T2/T3 agent reports and review signed/verified outputs; no existing user tasks.
4. **Windows CI:** create Windows build with new coordinator module in native agent file closure; Windows installation is **not** implied by CI build success.
5. **Windows live acceptance (after owner installs):** verify agent version/connection, Plus Codex on Windows, then repeat 3-step report/decision cycle while ChatGPT Web tab may be closed between steps; verify no unauthorized device switching and no cross-project Memory writes.

## Critical boundary
This coordinator makes the next **predefined agent task available and returns Codex's instruction**; it does NOT send a new message inside ChatGPT Web or perpetually extend ChatGPT's own turn. It can be called by ChatGPT through authorized Light Remote interactions, and by an allowed agent runner. Full automatic ChatGPT turn injection is not supported. The owner remains the authority for dangerous operations and final task approval.

## Rollback and isolation
- UAT LXD snapshot before deployment.
- Never test using real user Memory, tasks or repositories.
- Keep Windows install optional until owner confirms installation and UAT/test readiness.
