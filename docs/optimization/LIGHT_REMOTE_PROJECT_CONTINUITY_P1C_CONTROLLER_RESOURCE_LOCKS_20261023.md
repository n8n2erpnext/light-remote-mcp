# Project Continuity — P1c local Controller resource conflict checkpoint

Date 2026-10-23, Asia/Ho_Chi_Minh. STATUS: SOURCE-ONLY IMPLEMENTED, NOT RELEASE READY.
Branch: feature/project-continuity-plan-20261023
Immutable pre-feature Gold checkpoint: checkpoint/gold-pre-project-continuity-20261023 at 30766940ac18e55cb735354b40a3af9ba37eddb8.
Owner-tested Windows: Actions Windows Tray Client #486, exact Gold SHA 3076694.

## Changes since previous commit 491aee59bee434e092f6b1994cfb8551204969eb

- Local SQLite migration to user_version=4. New relational tables:
  section_resources(section_id, resource_key, mode), section_claim_history(project_id, operation_id, section_id, status, recorded_at).
  Previous claim records are backfilled into history. Existing user tables and Gold cloud PostgreSQL/Redis remain untouched.
- Section resource intents are declared on section creation. Keys allow lowercase ASCII labels and slash/colon tokens, max 192 chars, no duplicate key per section, max 32 per section. Modes: read/shared and write/exclusive.
- Controller claimSection atomically checks all held and UNKNOWN resources across all local Projects for conflicts. Shared read/read succeeds. Any write conflict blocks. One claimed resource in UNKNOWN continues to block newer effects until owner-reviewed reconciliation; no timeout-based release.
- Once owner reconciliation releases a claim, a NEW operation ID can be used; the previous ID remains in section_claim_history and cannot be reused. Never promise exactly-once OS execution from this coordination ledger alone.
- Local Wall create-section form allows optional exact resource label and read/write intent, with explicit note that the key is a scheduling hint, NOT filesystem access permission.
- Durable handoff now quotes source and fact body as data, explicitly labels untrusted text and never places injected free-form Memory entries as Markdown instructions. Bounded output including truncation marker remains within caller maxChars.
- Local IPC requests are not owner authentication. Audit actor on unprivileged project/module/section/memory creation changed from falsely labelled owner to local_client_unverified. Owner verification is still an OPEN privileged boundary.

## Verified focused source evidence

- selftest-project-continuity-p1.mjs: PASS SQLite, 4 module preferences, Wall owner session/CSRF, separate IPC process, restart and backup.
- selftest-project-continuity-p2.mjs: PASS source attribution, bounded context and untrusted Memory text, cross-project read/write conflict, parallel read/read, UNKNOWN restart, owner reconciliation, historical operation ID denial, project isolation and Memory-only/Codex-only independence.
- selftest-project-continuity-codex-supervisor.mjs: PASS MOCK app-server-only, approved tool requests declined; Codex response remains PROPOSED and does not mutate task states.
- No owner-installed Windows build made, no real Codex CLI observed, and no official ChatGPT MCP memory flow claimed.

## Important architectural discovery: remote Memory relay cannot reuse ordinary Exec/FS job envelope

Gold Operator startFsOperation, startSearchOperation and startJob record job.resultData in job journals; sending bounded project memory extracts over that path can persist them in Operator/PG on the server, violating user-local data ownership. New first-class Project MCP routing MUST provide:
  - owner A/B and session identity binding through existing official Plugin
  - explicit device-local per-Project remote-read permission (separate from ability to edit project settings)
  - no persistence of raw memory, project content or secret-bearing output to Gold job telemetry, PostgreSQL, Redis, plugin logs or traces
  - bounded, encrypted, in-flight-only memory response; sanitization and session/project access validation
  - local fail-closed when permission is absent, disabled, offline, changed or ambiguous
This relay is still NOT IMPLEMENTED. Do NOT "solve" it by spawning PTY, cat SQLite, calling FS read on exported handoff, or saving full chat in cloud.

## Critical remaining blockers — release gate stays BLOCKED

1. Owner-bound cryptographic approval step and Windows/macOS local IPC/service process isolation. A same-user IPC token with generic access cannot be treated as privileged owner consent.
2. Native confidential MCP device relay plus explicit project ACL and new ChatGPT conversation real UAT.
3. Real Codex app-server owner-authorized authentication and commercial eligibility. Mock is not acceptance.
4. Gated worker execution through existing governed Light Remote rights, with signed terminal receipts, budgets, cancel/reconnect, and safe restart. Local section resource key alone is not an execution gate.
5. Cross-platform installer/service lifecycle and physical Windows #486 parity. No single Windows test installer until gates 1–4 are resolved.

Next: implement the confidential in-flight-only device relay without ordinary persisted job path, then owner ACL/privileged-channel review and hardware-installed Codex test. Keep Gold UAT M6 unresolved claims intact and leave pre-feature checkpoint untouched.
