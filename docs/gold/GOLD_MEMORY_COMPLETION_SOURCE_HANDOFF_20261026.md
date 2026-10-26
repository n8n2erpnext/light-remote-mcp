# Gold Long Memory Completion — source-only handoff, 2026-10-26

Base commit: `b8de92df049d529a0bd4b7387fdefa3d998405a1`.
Branch: `feature/gold-memory-completion-20261026`.
Owner workflow: implement Memory source first, then test real Codex CLI/observer on Windows and run regression before any GitHub Actions build. The owner confirmed Codex CLI read-only observer `completed` on Windows with a receipt requiring explicit owner approval on 2026-10-26. Regression was then run on the isolated ARM source checkout.

## Implemented in source (NOT validated or deployed)

- Memory Library: Manage scope → Archive / Restore / Delete on this device. Delete across account is displayed but remains **explicitly disabled**, and endpoint returns HTTP 501. It is unsafe to claim remote deletion before a durable signed tombstone and per-device offline ACK protocol exists.
- Local deletion requires owner-authenticated Local Wall + existing CSRF middleware + exact scope-name confirmation and second browser confirmation. Deletes only that scope's local events, evidence, outbox/inbox, grants and checkpoints in a transaction; retains irreversible local tombstone and an archived metadata stub. Database secure_delete is enabled and WAL checkpoint attempted; copies and backups cannot be erased by this operation.
- Replication import/accept blocked on locally deleted or archived scopes; Home grants/send reject archived scopes; Restore only works on archived scopes not tombstoned.
- Memory Library shows local SQLite allocated/live pages, signed checkpoint body bytes, per-scope bytes and last **verified** sync (Replica ACK at Home or frame received by Replica), not the last requested Sync time. It does NOT invent total account-wide bytes.
- Full context is an explicit per-scope owner opt-in. Owner may paste text or choose a local .txt/.md/.json file and click Save. Each snapshot capped at 512 KiB UTF-8, no silent truncation; Home signs every chunk + final SHA-256 manifest in one atomic transaction. Read reconstructs the most recent snapshot and validates signatures/parts/hash.
- No hidden ChatGPT transcript interception: user must explicitly supply context or use an authorized connector integration in future.
- Gold MCP memory read schema now adds `scope_full_context` (paged, verified, max 10,000 characters per read) and `scope_usage`, to allow an authorized new conversation to request saved full context without a pasted handoff. This DOES NOT auto-invoke itself when a new ChatGPT session starts.
- Gold Windows client-core manifest includes the new module; CI manifest preflight includes it. No Windows installation touched.

## Codex Task Controller Edit/Delete

- On /codex-cli each active task now exposes inline **Edit** with Save/Cancel, and owner-confirmed **Delete** requiring the exact task title.
- Edit uses optimistic `expectedChangedAt` to reject stale tabs; state remains unchanged. Delete is a soft delete (`deleted_ms`) that excludes the task from active lists/future Codex observations, preserving the original row and audit history. Both are denied while Codex observer is in progress.
- Codex receipts remain immutable. Old receipts cannot approve a task altered or deleted since observation. Task state transitions also use a monotonic revision timestamp and SQLite CAS.
- On-disk SQLite schema migrates `observer_tasks` with an optional `deleted_ms` and `observer_task_history`, preserving existing tasks.
- Automatic project-bound capture supports `task_updated` and `task_deleted` event classes for trusted bound tasks; no arbitrary transcript captured.
- New test `deploy/scripts/selftest-gold-codex-task-management.mjs` covers edit/delete, CSRF/owner, receipt invariants, stale revisions and in-browser JS syntax.

## Local regression performed (temporary fixture only)

- `selftest-gold-codex-task-management.mjs` PASS.
- `selftest-gold-memory-scope-management.mjs` PASS: archive/restore/delete, opt-in Unicode full-context import and verified restore, tombstone scope isolation.
- `selftest-gold-wall-navigation.mjs`, `selftest-gold-memory-reader-export.mjs`, `selftest-gold-memory-scope-v2.mjs` and `selftest-gold-client-core-imports.mjs` PASS.
- No real Windows/Gold UAT Memory, task, or snapshots modified during source fixture tests. CI and live deployment remain separate gates.

## Key files
- `device-agent/gold-memory-scope-admin.mjs` (new)
- `device-agent/gold-wall-modules.mjs`
- `device-agent/gold-memory-sync.mjs`
- `device-agent/local-wall.mjs`
- `device-agent/gold-memory-cli.mjs`
- `plugin-server/gold-memory-bridge.mjs`
- `plugin-server/tools.mjs`
- `client/core-files.json`
- `.github/workflows/windows-native-client.yml`

## Gates before deployment

1. Run syntax checks and owner-scoped Memory fixture tests (NONE run during implementation as requested).
2. Test FK deletion paths and tombstone anti-resurrection on Home and Replica, including after restart and receiving stale invitations/frames.
3. Validate capture/import chunked UTF-8 with emoji and max-size input, verify hash and complete version/chain, confirm rollback on forced failure.
4. Verify sync timestamps correspond to actual received signed ACK and no erroneous remote storage total.
5. Verify archived scope Restore, Local Delete and account-delete fail closed against real UI/API auth and CSRF.
6. Cross-session retrieval from *fresh ChatGPT chat* using explicit scope ID and paged `scope_full_context`; do not claim automatic self-selection without a separate orchestrator.
7. Test Codex managed runtime + ChatGPT Plus sign-in + read-only observer receipt on Windows.
8. Only then push/enable GitHub Actions build, install on Windows for UAT, then controlled Gold Linux UAT with snapshot rollback.

## Remaining architecture issue

Account-wide delete with offline enrolled devices is not complete. Require account-owned durable signed tombstone including scope ID, epoch and monotonically ordered deletion generation; Home and all Replica verifiers must fence stale data; each device persists tombstone and acks; queued delivery retries for offline peers. UI must distinguish pending/partial/complete and never return completed until every enrolled participating device acknowledges. This build only offers local scope delete; the across-account button is disabled.

Full automatic ChatGPT context capture is also impossible without a user-approved data source; explicit full-context import and verified retrieval are implemented in source. Auto event capture is unchanged and is different from Sync Auto.
