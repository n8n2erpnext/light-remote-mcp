# Light Remote Documentation Library Rules

Status: canonical
Date: 2026-10-30
Scope: every human and AI editing Light Remote documentation

## Read first, search first
Before writing/moving/renaming: read [README](README.md), [Project Book](LIGHT_REMOTE_PROJECT_BOOK.md) and [Library Map](DOCUMENT_LIBRARY_MAP.md); search [Source Catalog](SOURCE_CATALOG.md) and existing source paths. **Update a canonical owner document instead of creating duplicate session summaries.** Never let a chat transcript alone determine project truth.

## Authority classes
- **Canonical** — intended current contract, always reconciled against code.
- **Decision** — owner-approved direction, not proof of implementation.
- **Verification** — dated SHA, test commands, measured evidence and limitations.
- **Release** — artifact/runtime provenance and separate approval.
- **Handoff** — bounded continuity: objective, starting state, changes, checks, blocker and next step, never current truth by default.
- **Historical** — old checkpoint/roadmap retained for provenance, potentially superseded.
- **Draft** — proposal without activation or owner signoff.
- **Machine evidence** — JSON/manifest consumed by code/tests, exact path locked.

When source claims conflict, prefer current deployed runtime and source at exact SHA, then CI/tests, then canonical contracts, then later dated decisions, then historical records. Never infer deployment or signing from fixture results.

## Shelving and naming
Use [Document Library Map](DOCUMENT_LIBRARY_MAP.md). Keep existing `docs/gold`, `docs/optimization`, `docs/releases`, `docs/operations`, `docs/real-remote-v2`, `docs/experiments` paths stable until exact-path consumers are audited. New governance goes under `docs/project-book`; future long-lived architecture decisions may use `docs/adr` once created; completed superseded agent handoffs may go into `docs/history/agent/handoffs` after documented migration. Do not place new random docs in repository root.

Use stable filenames, not `FINAL-v2`, `LATEST`, `NEW` variants. Preserve legacy names untouched when moving would break scripts. Date/time alone is not a reason to mint a duplicate document.

## Minimum document format
Use [Document Template](DOCUMENT_TEMPLATE.md): status, date, scope, supersedes, primary sources; purpose, decision, boundaries, evidence, current state, bookmarks and next action. Link repository sources relatively. Never store tokens, A/B plaintext codes, device secrets or customer personal data.

## After a meaningful change
1. Update the canonical contract **if** the change alters architecture or owner direction.
2. Append a short dated entry to [Worklog](LIGHT_REMOTE_WORKLOG.md) for durable milestones; do not create a worklog per session.
3. Update [Code Map](LIGHT_REMOTE_CODE_MAP.md) only if an executable ownership boundary or route actually changes; list exact verified Git SHA.
4. Put test receipts in existing release/architecture evidence, distinguish synthetic vs native E2E.
5. Regenerate [Source Catalog](SOURCE_CATALOG.md) and [machine catalog](source_catalog.json) with `node deploy/scripts/generate-doc-catalog.mjs --write`; validate via `--check`. It catalogs `docs/**/*.md|json` but excludes `docs/project-book` to avoid self-referential churn.
6. Overwrite `.light-remote/CURRENT_CHECKPOINT.json` when the next action changes or before session handoff; do not create dated checkpoint copies.
7. Check relative links and `git diff --check`; commit documentation separately from unrelated product implementation.

## Path migrations
Do not move historical documents without mapping source and destination, every non-doc script/test consumer and relative link. Avoid mass renames. Record old→new paths and retain redirects/bookmarks only after consumers are tested. No JSON evidence movement for style alone. Never delete historical evidence or rewrite an older conclusion as if it were accepted today.

## Current scope and future IT Support
Gold P2 currently targets **Light Remote core, A/B V2, Agent nickname and controlled Pro Share**, as expressly authorized in the integrated plan. Enterprise IT Support organizations/branches/group RBAC are **future architecture considerations only, after the pure Light Remote product stabilizes**. Do not create enterprise policy engines, database tables, enterprise access gates, or conditional release blockers for this future product now.

## Checkpoint discipline
`.light-remote/CURRENT_CHECKPOINT.json` is **one small overwrite-only state file**: timestamp, verified baseline source SHA, deployed-runtime distinction, completed evidence, blockers, one exact next action, and read-first paths. It is not a replacement for Git, Project Book, Worklog, or owner approval, nor is it itself production authority. It is excluded from the document catalog; update it without generating a second handoff for every turn.
