# Light Remote MCP — Project Book

Status: canonical navigation
Edition: 2026-11-08, unified repository
Authority: new repository n8n2erpnext/light-remote-mcp (not the archived repository)

## Read-first sequence

1. [Library Rules](LIBRARY_RULES.md) — how to preserve one source of truth without fragmenting branches or handoffs.
2. [Project Book](LIGHT_REMOTE_PROJECT_BOOK.md) — the actual unified baseline, not the old Gold/desktop history.
3. [Code Map](LIGHT_REMOTE_CODE_MAP.md) — source owners, entrypoints and HTTP/native paths verified from this tree.
4. [Document Library Map](DOCUMENT_LIBRARY_MAP.md) — canonical vs historical shelves.
5. [Project Truth Status](PROJECT_TRUTH_STATUS.json) — machine-readable source/evidence distinctions.
6. [Worklog](LIGHT_REMOTE_WORKLOG.md) — one cumulative record, not new files per session.
7. [Source Catalog](SOURCE_CATALOG.md) / [JSON](source_catalog.json) — generated file hashes and bookmarks, not proof of live deployment.
8. [Document Template](DOCUMENT_TEMPLATE.md) — only when a new durable document is justified.
9. [Root Master Checkpoint](../../MASTER_CHECKPOINT.json) — **sole** current checkpoint.
10. [Root Project Truth](../../PROJECT_TRUTH.md) / [Handoff](../../PROJECT_HANDOFF.md) — verified migration truth and immediate next actions.

## Working rule

**Official GitHub main → Full checkpoint tag → implement on main → targeted tests → reconcile the same Worklog/Code Map/Checkpoint.**
Do not make a branch per feature. A temporary branch is exceptional only if technical controls truly require it and Owner approves. Do not modify the archived repository, ARM legacy worktrees, or running production.

The former docs/project-book content in the old repository is a historical reference for workflow only. This book was authored for the unified repository and its new API contracts, paths, and proof boundaries.
