# Light Remote Project Book

Status: canonical-navigation
Date: 2026-10-30
Scope: documentation governance and read-first routing

Read in this order before implementation or documentation work:

1. [LIBRARY_RULES.md](LIBRARY_RULES.md) — mandatory write/read/move rules.
2. [LIGHT_REMOTE_PROJECT_BOOK.md](LIGHT_REMOTE_PROJECT_BOOK.md) — project status and authority, with source provenance.
3. [DOCUMENT_LIBRARY_MAP.md](DOCUMENT_LIBRARY_MAP.md) — physical and logical documentation shelves.
4. [LIGHT_REMOTE_CODE_MAP.md](LIGHT_REMOTE_CODE_MAP.md) — code-based runtime, security and P2 maps.
5. [PROJECT_TRUTH_STATUS.json](PROJECT_TRUTH_STATUS.json) — machine-readable snapshot of verified facts and gates.
6. [SOURCE_CATALOG.md](SOURCE_CATALOG.md) / [source_catalog.json](source_catalog.json) — tracked source-document checksums and bookmarks.
7. [LIGHT_REMOTE_WORKLOG.md](LIGHT_REMOTE_WORKLOG.md) — cumulative project chronology.
8. [DOCUMENT_TEMPLATE.md](DOCUMENT_TEMPLATE.md) — template when a NEW durable document is justified.
9. [CURRENT_CHECKPOINT.json](../../.light-remote/CURRENT_CHECKPOINT.json) — one overwrite-only recent execution checkpoint.

**Critical distinction:** the Project Book is a guide and snapshot, never a replacement for the exact working-tree Git SHA, CI at that SHA, or observed running Gold UAT schema/services. Source code and live runtime can diverge.

Historical Light Remote handoffs in `/home/ubuntu/handoffs` are still external operational evidence, not silently promoted to canonical repository authority. Do not move or overwrite them en masse.

The first governance edition follows the **patterns**, not the content or product details, of LightBI Project Book, Document Library, Code Map, Source Catalog, Worklog and micro-checkpoint. Its historical reference was inspected read-only in `/home/ubuntu/n8n2erpnext/LightBI-docs-cli-lightbi/docs/project-book` on 2026-10-30.
