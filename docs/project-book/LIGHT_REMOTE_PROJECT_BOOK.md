# Light Remote Project Book — Source Truth Snapshot

Status: canonical-synthesis (source-scoped, not a live release claim)
Date: 2026-10-30
Scope: Git Gold P2 development, current runtime boundaries, cross-session continuity
Primary sources: [Code Map](LIGHT_REMOTE_CODE_MAP.md), [Library Rules](LIBRARY_RULES.md), [P2 integrated plan](../gold/GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md), [Ledger](../gold/GOLD_P2_UNIFIED_ACCEPTANCE_LEDGER_20261030.md)

## Identity and source precedence
Light Remote is a governed Node.js MCP remote execution system with a device Agent, Local Wall, Operator and Plugin server, with optional Windows/macOS/Linux clients. This Project Book is a **dated synthesis**, not a new source of security grants or production deployment truth.

The source audited here was Gold worktree branch `feat/gold-connection-gc-reconciler-20261029` at `47556b829425784e4c1240c88f08e7272970595f`, before this documentation governance commit. Production rc47, Gold source branch, isolated Gold clone and live Gold UAT must not be conflated.

Use current runtime hash and PostgreSQL schema for deployment claims; use exact Git SHA/CI job for code/test claims; use handoff for the state at its time only. See [Code Map](LIGHT_REMOTE_CODE_MAP.md).

## Owner-approved product direction (not shipped at snapshot)
- **A/B V2**: Agent discovers one permitted device, server issues A6+5 on demand and independent B, owner approves B at Wall or authenticated /account. Fixed device Short ID (six characters) always displayed in Standby; only five-character suffix rotates on active request. Existing 24h A/B grant and security remain.
- **Session nickname**: AI Agent chooses a distinctive human-readable nickname automatically after ready; immutable sessionId, no server-generated random nickname, no extra approval; owner rename wins.
- **Pro Share**: retain frozen 5-seat Pro Team internals; propose optional owner Pro $20 plus one guest +$5 ($25 total) with guest's separate OAuth/A/B and bounded owner-billed operations. No live billing/guest execution claimed.
- **Enterprise IT Support**: organization, branch, cluster, user, group, scoped RBAC are **architecture direction only after core Light Remote stabilizes**, not a P2 deliverable, implementation item or release blocker. Keep source designs extensible without introducing enterprise tables/UI now.

## Current Gold P2 release truth as previously verified
- P1-A to P1-E source/CI succeeded for scoped test cases, including synthetic 1k/10k device exercises. Synthetic signing and PostgreSQL transactions do NOT certify 10k physical Agents or deployed capacity.
- P2-A isolated 039→042 migration, successful/failure candidate and four-service/Redis/PG rollback rehearsals passed on a networkless LXD clone. No claim of live migration.
- P2-B signed HTTP/real in-memory enrollment + PostgreSQL fixtures and offline native Windows10 cryptographic boundary passed; final real native Agent ↔ Operator and historical exact terminal ACK still **unverified** at snapshot.
- Gold UAT live at last checked 2026-10-30: PostgreSQL schema **039/39**, **one distinct historical resource claim** and **27 UNKNOWN work rows** (26 historical predispatch and one started), four services active. Two other jobs had earlier audited administrative owner-orphan recovery; neither was a signed terminal ACK. Historical claim must not be fabricated or released without sufficient evidence.
- Production rc47 is untouched; source contains migrations 040–042 but live Gold UAT has not applied them.
- A/B V2, nickname persistence, Pro Share execution and public add-on charge are **NOT deployed**. The new P2 consolidated plan is a development direction, not authorization to change live UAT or production.

## Development map, read-first
1. [Code Map](LIGHT_REMOTE_CODE_MAP.md) for source owners.
2. [Unified P2 Plan](../gold/GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md) for approved near-term scope.
3. [Acceptance Ledger](../gold/GOLD_P2_UNIFIED_ACCEPTANCE_LEDGER_20261030.md) for evidence classification.
4. [P2-I0 Audit](../gold/GOLD_P2_I0_SOURCE_CONTRACT_AUDIT_20261030.md) for specific implementation seams.
5. [Current Checkpoint](../../.light-remote/CURRENT_CHECKPOINT.json) for exact next action, then **revalidate Git and runtime**.

## Governance migration boundary
This edition adds navigation and metadata only. It does **not** move pre-existing documents, rewrite previous handoffs or alter the current Gold runtime, jobs, credentials, A/B grants, PostgreSQL/Redis or production rc47.

## Next
Maintain a single Project Book/Worklog/catalog/checkpoint. Start near-term Gold P2-I1 source work only under the established source/CI/isolated-clone safety gates; do not expand enterprise IT Support RBAC before core stability.
