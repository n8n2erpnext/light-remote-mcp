# Project Continuity — P1b / P2 Local / P3 Supervisor protocol source checkpoint

2026-10-23 Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Frozen fallback (DO NOT REWRITE): checkpoint/gold-pre-project-continuity-20261023 = 30766940ac18e55cb735354b40a3af9ba37eddb8
Windows owner-tested build reference: Actions #486, 3076694

STATUS: IN DEVELOPMENT. DO NOT BUILD OR INSTALL A CUSTOMER-FACING WINDOWS TEST INSTALLER YET.

## Implemented source since P1

- SQLite local schema now v3 (additive from v1/v2) with canonical Projects/Tasks/Sections/Evidence/Approvals, typed per-section resource claims, operation ID uniqueness, conservative UNKNOWN crash/start reconciliation, explicitly owner-reviewed release reason, and per-project Codex thread identity. This is a CONTROLLER and history mechanism, not permission to run OS commands.
- Owner-approved declaration is an internal store method only. It is NOT exposed through generic IPC or MCP, because a remote AI with filesystem scope may be able to read a same-user token. Owner-proof cryptographic/OS separation still needed.
- Local project memory is opt-in and source attributed. FTS5, fact provenance confidence (unverified vs owner_confirmed), bounded contextBrief, atomic handoff Markdown, SHA-verified checkpoint JSON and SQLite online backup. Obvious secret patterns rejected (heuristic, NOT general secrets detection).
- Local Wall authenticated /projects page now provides project/task/section creation, Memory/Codex toggles independently, owner-curated memory notes, scoped search and generated handoff view. Page requests use session auth+CSRF. Direct UI currently not proof of ChatGPT multi-conversation integrated MCP read.
- Standalone IPC service routes expose local bounded contextBrief/exportHandoff/memorySearch. CLI includes brief PROJECT_ID with explicit local project selection. Local user-owned IPC secrets are NOT adequate to authorize privileged Codex worker effects.
- New Codex app-server stdio JSON-RPC adapter has read-only thread/init/resume, turn/start, declines all server-initiated approval requests, enforces readOnly sandbox policy with scoped read root, finite time/output, validates CONTINUE/WAIT_OWNER/CONTINUE_SECTION_B/DONE against Controller snapshot. Proposals remain PROPOSED and never modify tasks or execute effects.
- No Codex binary installed on the ARM development device during this checkpoint. Adapter tested against a local mock process only. No ChatGPT OAuth/plan entitlement, API key, or Codex secrets were read or installed.
- Node 22 built-in node:sqlite currently experimental. Windows/macOS isolation/lifecycle remain unverified.

## Focused receipts completed on ARM

1. selftest-project-continuity-p1.mjs — SQLite, Memory OFF/ON, Codex OFF/ON, Owner Wall login/CSRF, local IPC, separate process restart/online backup: PASS.
2. selftest-project-continuity-p2.mjs — source-attributed memory, search, bounded handoff, local CLI, project isolation, owner confirmation, secret-pattern rejection, Codex-only section claim, restart UNKNOWN, not blind retry: PASS.
3. selftest-project-continuity-codex-supervisor.mjs — JSON-RPC init/thread/resume/turn, no auto command approval, proposal validation, thread persistence and Codex-only without memory (MOCK app-server): PASS.

These are not a packaged Windows installer, not true ChatGPT-Web-new-conversation retrieval, not real Codex account inference, not delegated background execution, and not official MCP release acceptance.

## What must be completed BEFORE a single user test build

REQUIRED OPEN GATES:
- Actual authenticated native MCP Light Remote Project Context/Memory tools, explicit device/session/project binding, authorization and read-only Cloud relay with no memory persistence on PG/Redis/logs. No exception or silent exec/PTY workaround.
- Owner step-up verification connected to Controller through a strictly separated privileged local channel. Ordinary device FS/SCP/PTY rights cannot mint a fake owner approval or worker claim.
- Authenticated delegated work scopes, resource locks across sections, signed terminal receipts, quotas/time/cost budgets, pause/cancel/recovery, and no duplicate effects across worker+Agent restarts.
- Real user-installed Codex app-server testing in both Memory-only OFF/ON, Codex-only ON/OFF modes, lifecycle, login methods and commercial distribution eligibility. Do not reuse browser cookies or claim unlimited ChatGPT Plus usage.
- Windows named-pipe ACL, local service lifecycle independent of the tray, installation/uninstallation, updater rollback; macOS/Linux support boundaries.
- Readiness/performance regression against OWNER-TESTED Windows #486: Filesystem drive Read/Write root picker, SCP scope, non-blocking Local Wall, RM V2, PTY and restart behavior.
- A single integrated Windows build AFTER source/security gates pass. Then owner real-device UAT for all four module combinations. NO installer now.

Gold M6 independent cutover block remains; do not release old Windows resource claim, rewrite UNKNOWN history, promote a Gold candidate, restart production or migrate PostgreSQL for this feature.

## Next developer entrypoint

Read this and master plan. Work next on authenticated owner/worker IPC boundary and data-minimizing first-class Light Remote MCP plumbing, then a REAL Codex app-server smoke with owner-supplied official authentication. Keep focus on deliverable, avoid unbounded test proliferation. Build only after all above gates are met.

Official documentation consulted: https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server and https://learn.chatgpt.com/docs/app-server and the Codex upstream app-server v2 schema.
