# Gold Codex Supervisor — live acceptance, 2026-10-26

Environment: **LXD light-remote-gold-uat** on VPS-ARM. Candidate SHA `362228790ae8dbc8a2bb1ed0940b60cffe16bc8c`, branch `feature/gold-memory-completion-20261026`.

## PASS — real ChatGPT Plus Codex, no mock

Using the separately authorized `@light-remote-gold` connector directly on `light-remote-gold-uat`:

- `createGoldCodexPlus.account()` returned `connected=true`, `authMode=chatgpt`, `plan=plus`.
- `runDelegated()` started a real Codex app-server `workspace-write` turn in a separate temporary UAT directory, requested a tiny text fixture, and verified that Codex wrote and read the exact contents `GOLD-CODEX-LIVE-UAT`.
- Codex returned `status=completed` and `RECOMMENDATION: DONE`. This standalone smoke fixture was automatically cleaned by the test.

## PASS — Gold Agent autonomously picks up an owner-delegated task

A **separate** isolated UAT task was created using Gold's Task Controller API, with owner approval flag and `maxRounds=1`. No browser turn or manual `supervisorTick()` was used after delegation.

- Fixture Task ID: `6a8f92f3-dc35-42e5-8487-682c8abfb599`.
- Gold Agent's 15-second timer picked up the armed delegation and launched **real ChatGPT Plus Codex**.
- Codex created and verified `supervisor-proof.txt` in its own `codex-workspaces/<fixture task ID>` with exact content `GOLD-SUPERVISOR-REAL-E2E`.
- Durable SQLite: `rounds=1`, `decision=DONE`, `state=review_required`, one receipt `efc22d04-5550-476f-8f97-e9ad2c4282f0` with `result_status=completed`.
- Task Controller independently remained `todo`: **no automatic owner DONE approval**.
- After restarting **only the UAT Wall/Agent service**, the same receipt, one round, file content and `review_required` persisted, with no rerun. `@light-remote-gold` reconnected through its existing session.
- Test task was **soft-deleted**, with prior receipt and history preserved; no active fixture task remains.

## Runtime / scope checks

- LXD `operator`, `plugin`, `wall` and `process-supervisor` all reported `active`.
- Effective Wall SHA matched `362228790ae8dbc8a2bb1ed0940b60cffe16bc8c`.
- Internal NetBird front door: `/login` HTTP 200, `/codex-cli` and `/long-memory` expected HTTP 303 to authenticated login.
- No production services, real project files or existing user tasks were modified.
- Existing Gold regression: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40278774765 (PASS).
- Existing Windows build regression: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40278774803 (PASS; Windows installation not tested).

## Explicit limitations / cleanup

The `@light-remote-gold` structured file deletion of the fixture workspace
`/var/lib/light-remote-gold-uat/wall/codex-workspaces/6a8f92f3-dc35-42e5-8487-682c8abfb599`
was denied by the device policy (`filesystem_path_outside_allowed_roots`, HTTP 403).
**Do not bypass this policy using a shell or another plugin.** The small text file remains in that isolated UAT workspace; owner may clean it through an explicitly permitted local procedure later.

This is proof of separately running, **owner-delegated Codex work when ChatGPT Web is inactive**. It is **not** proof that ChatGPT Web's own conversational turn continues, and it does **not** complete full multi-section dependency/CONTINUE_SECTION_B coordination, Windows live acceptance, or cross-device Task Controller execution.
