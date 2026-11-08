# Light Remote Document Library Map

Status: canonical-navigation
Date: 2026-10-30

## Shelves in current Gold repository

| Shelf | Classification | What belongs there |
| --- | --- | --- |
| `docs/project-book/` | governance/index | Read-first, rules, project truth snapshot, code map, worklog and source catalogs |
| `docs/gold/` | current Gold contracts + historical receipts | Gold P1/P2 specs, fixtures, migration plans and dated evidence; identify authority within each file |
| `docs/releases/` | release evidence | Client/build/release checklists, immutable artifact and rollback references |
| `docs/operations/` | operational guidance | Runtime, safety, deployment and recovery operations |
| `docs/optimization/` | technical optimization/history | Older optimization, Gold milestones/checkpoints; not automatically current |
| `docs/real-remote-v2/` | subsystem contract | Real Remote V2 source references |
| `docs/experiments/` | experiment | Experiments do not authorize release |
| `docs/history/` | future historical archive | Superseded notes and bounded handoffs, when safe path migrations are completed |
| `docs/adr/` | future decision records | Numbered decisions only when materially needed |

Do not bulk-move the existing 185 Markdown files or machine-consumed source paths. Historical external `/home/ubuntu/handoffs` remains outside the repo until a deliberate source-preserving migration. New files should use this map, not imitate historical file placement by default.

## Navigation
- [Project Book](README.md) — entry and reading order.
- [Library Rules](LIBRARY_RULES.md) — governance.
- [Project truth](LIGHT_REMOTE_PROJECT_BOOK.md) — baseline.
- [Code Map](LIGHT_REMOTE_CODE_MAP.md) — source reachability.
- [Worklog](LIGHT_REMOTE_WORKLOG.md) — chronology.
- [Source catalog](SOURCE_CATALOG.md) — per-path lookup; do not treat SHA from a past run as proof of currently deployed runtime.

## Source precedence
Current code/runtime/CI evidence > verified current architecture > owner decision > dated handoff > older history. Cross-check changed products, migration numbers, billing and device permission gates against current code and deployment; publication and feature flags are separate from source completion.
