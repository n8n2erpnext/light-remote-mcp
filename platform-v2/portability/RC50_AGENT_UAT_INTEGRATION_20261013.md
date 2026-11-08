# Light Remote rc50 P0 — Consolidated Agent UAT integration checkpoint

**13 October 2026 (Asia/Ho_Chi_Minh). Scope: source-only, NONPRODUCTION, not wired into Agent.**

## Canonical Git target

Repository: `/home/ubuntu/n8n2erpnext/light-remote-mcp-main`
Worktree: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform`
Worktree HEAD ref: `feature/rc50-mjs-scale-20261011`
Last independently verified branch commit (via Git refs, not stale handoff): `2543432d6b46ba915a0cbcc182c09c4aeff58ac5`.

**Do not update** `/home/ubuntu/handoffs/LIGHT_REMOTE_MJS_HANDOFF_CURRENT.md`. An earlier operation to modify this pointer was blocked by OpenAI safety checks. Do not retry via alternate shell, Git operation or connector. Instead follow this exact checkpoint and branch ref.

## Source files gathered into this worktree

Existing pending Linux experimental UAT:
- `platform-v2/portability/synthetic-agent-locked-worker.mjs`
- `platform-v2/portability/verify_synthetic_agent_os_lock_uat.mjs`

New offline-derived, pure fake-only implementation and tests:
- `platform-v2/portability/rc50_agent_receipt_decision.mjs`
- `platform-v2/portability/test_rc50_agent_receipt_decision.mjs` (26 Node.js tests)
- `platform-v2/portability/rc50_agent_dispatch_triage.mjs`
- `platform-v2/portability/test_rc50_agent_dispatch_triage.mjs` (43 Node.js tests)
- `platform-v2/portability/rc50_os_lock_adapter_contract_v2.json`
- `platform-v2/portability/rc50_dispatch_boundary_matrix.json`

The six new files were transferred using Light Remote's explicit authorized file-write operation. SHA-256 checksums returned by the device match the offline source artifacts exactly. The two original Linux files remain unchanged from their prior 7-process simulated OS-lock PASS and are NOT runtime-integrated. There is no production signer, real remote OS action, database change or deployment in these new sources.

## Verified actual runtime source seams, NOT YET FIXED

`device-agent/operator-agent.mjs` duplex and polling paths both call `executeCommand` (source around lines 236 and 863). Common dispatcher starts around line 551; current `running` spool entry is converted to `finished` error code 125 after restart rather than an authority-backed UNCERTAIN receipt. Local JSON writes use exclusive temp-file `.lock` acquisition/deletion, not an OS kernel lock held for a whole command action. Current spool trim may retain only 100 newest/24 hours: not yet proven compatible with offline replay windows. P0 requires a **single trusted AgentReceiptAuthority** spanning both transports, durable receipt writes, signed owner/grant/epoch validation and fresh just-before-side-effect checks for terminal, process, RM, SCP, fs, updater and script spawn.

The new receipt decision module is a **pure proposal**, not a receipt writer, signature checker or real OS execution gate. Its fake flags `lockState:'acquired'` and `verifiedBy:'synthetic_test_only'` are explicitly NOT trusted security proofs. The dispatch classifier is source review aid, not an authorization allowlist; unknown paths and filesystem suboperations require manual audit. All returned results explicitly deny physical execution.

Linux `flock` is advisory. A matching FD or inode alone cannot prove the lock is held, and bypassing the trusted gate could still write receipts. Windows named mutex Session 0/Global/Local and ACL require native UAT; macOS BSD flock requires native UAT. Use real owner-authenticated signature issuance, revoke, monotonic floor and true durable single-writer authority before any production wiring.

## Evidence and acceptance limits

- Offline independent test runs: **26/26 receipt**, **43/43 dispatch** PASS on 2026-10-13; tests are pure Node and no real OS calls.
- Prior Linux fixture supervisor observed PASS for contention, SIGKILL release, uncertain recovery and unchanged lock inode. No cross-platform native OS lock acceptance exists.
- Historical private PG synthetic Ed25519 outbox test `2543432` passed fake-only E2E; not connected to native Agent.
- Old safety blockers remain untouched: seven AES sealed runtime tests, dual Docker cold move, DB-role provisioning, combined writer source regression, obsolete HANDOFF_CURRENT update, and any identical previously rejected tool operations. Do not route through PTY, wrappers or another connector to evade.
- If individual new test or Git operation is denied by safety or device-local policy, stop that operation, preserve all successfully copied sources, document exact denial and do not retry with another interface.
- No tests here establish user/owner real A/B approval or guarantee against disconnected-device physical side effects. **Global writer fence and cross-host migration: NOT_READY.**

## P0 order after consolidation

1. Native OS lock integration exclusively within an Agent-side authority service (not independently per HTTP handler).
2. Consistent durable generation+receipt flow across duplex/poll, with read-after-crash UNCERTAIN reconciliation, no blind replay.
3. Per-action signed grant/lease check immediately before PTY input, process start/input, desktop run, SCP upload-commit, updater and fs mutations.
4. Windows/macOS kernel lock tests plus Windows service/desktop privilege boundary; validate lock abandonment semantics.
5. Complete mutation census, billing/OAuth/support outbox and independent restore gating.

Keep Node.js ESM `.mjs` and Express5, existing protocols and production unchanged.
