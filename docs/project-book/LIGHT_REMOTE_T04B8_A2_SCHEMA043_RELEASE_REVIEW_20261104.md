# T04b8-A2 — GoldABV2 isolated Lab schema 043 release review

Date: 2026-11-04 (ICT). Status: **LAB FORENSIC PASS; CANONICAL RELEASE NOT APPROVED; SSO OFF**.

## 1. Historical provenance established

- Primary provenance: `/home/ubuntu/handoffs/LIGHT_REMOTE_GOLD_ABV2_LXD_CUSTOM_MCP_HANDOFF_20261101.md`, created November 1, explicitly records PostgreSQL 17 Lab schema **043 manually applied after 040/041/042**, with a **lab-local-only** extra 043 checksum entry. The same handoff explicitly says **no production release approval** and Gold main UAT remained schema 042.
- On November 4 the authoritative isolated Lab `light-remote-abv2-lab-20261101` PostgreSQL `light_remote_gold_dev` was queried read-only. `lr_schema_migrations` is contiguous 001–043; schema 043 `applied_at` is **2026-11-01 15:25:05.798104 UTC (22:25:05 ICT)**, ~2 seconds after 042. The ledger stores version+timestamp, **not a SQL digest**.
- Both running old Plugin/Operator source directories have lab-local 43-entry lock. SQL043 pinned digest **935b268899c7b59761781db33d8ad2c573773566844fbfab0b861046f3a680d4** equals SQL043 in both old and new source trees. Canonical Git and new staged b8ec5d6f have a **42-entry lock**. The schema-startup gate and database code files are byte-identical across all three trees. The prior Operator `gold_pg_candidate_43_not_locked` therefore arises from the mismatch in the *staged* lock, not a new PostgreSQL migration.
- Independently checked actual PostgreSQL table structure: short_id/device_id/created_at, six-character CHECK, PRIMARY KEY, UNIQUE device_id, ON DELETE SET NULL FK, partial device index, and immutable update trigger are present and agree with the intended SQL043 structural contract. This is a DDL contract comparison, not a cryptographic proof of the original SQL execution history.
- Another historical handoff `LIGHT_REMOTE_GOLDABV2_SINGLE_OWNER_HANDOFF_20261101.md` records that Owner singleton SQL045 was **manually applied only inside this Lab**, without advancing the tracked 043 ledger. Read-only database observation confirms both Owner tables present and Guest044 table absent. No 045 canonical release approval is implied.

## 2. Hard boundaries

The Lab's historical manual 043/045 work is **experimental Lab authorization only**. It does NOT authorize changing signed/canonical Git `platform-v2/sql/migrations.lock.json`, migrating main Gold UAT (still documented schema042), releasing 043/044/045 to production, or activating signed Owner SSO. Lab Owner SSO remains OFF. Native Guest044 remains HOLD. A/B V2 per-Agent approvals and 24-hour leases are independent of Owner login.

## 3. Current pre-restart compatibility gate

- `deploy/scripts/gold-abv2-lab-cutover-preflight.mjs` is restricted to the exact LXD Lab and uses a read-only PostgreSQL transaction. It checks contiguous database ledger, canonical Git committed lock, all canonical and staged SQL SHA256 pins, staged Plugin `express` and Operator `pg` resolution, 043 table/trigger, Lab-only 045 Owner tables and Guest044 absence.
- `deploy/scripts/selftest-gold-abv2-lab-cutover-preflight.mjs` covers bad hashes, mismatched lock, noncontiguous ledger, missing tables/trigger and dependencies, accidental Guest044 schema and disallowed CLI args. The script has **no --apply**; `canCutover:false` even on technical compatibility.
- Actual old active 9d996956 source and new b8ec5d6f staged source both return **BLOCKED (exit3)** because the only formally tracked Git lock is 042. This is expected, not a new failure.

## 4. Next release decision (NOT TAKEN HERE)

**Lab-only path (preferred for finishing T04 safely):** independently approve a strictly Lab-scoped reproducible source compatibility artifact that records the already-applied 043 SQL digest, evidence of isolated device target, and verification of 045 sidecar tables. It must never alter Gold UAT/production migration lock or auto-apply migrations; it must be reviewed as a separate policy from production release. The startup gate must still be satisfied through a properly reviewed, checksum-correct Lab build artifact, never a runtime bypass. Separate owner authorization is required before staging/deploying the artifact.

**Canonical Git release path:** treat 043 as a production-eligible schema release only after a separate security/data/rollback review and explicit owner approval. Changes would need signed migration ledger plan for UAT schema042, safety/CI amendments that currently assert canonical lock042, negative Guest044 checks, versioned source+database contract, and staged UAT/production rollout schedule. No such approval is evidenced.

**Not acceptable:** copy the 043 lock from the Lab into canonical Git without review, toggle acceptance flags to suppress the gate, re-run already-applied SQL043, use the past mTLS transport probe as SSO acceptance, or migrate Guest044 merely to unblock services.

## 5. Real cutover prerequisite (future)

Before any new Plugin/Operator restart: explicit release choice and approval; exact preflight on immutable stage; dependency closure, snapshot, verified independent auto-OFF, scoped rollback, and prolonged health+operator readiness. Before enabling SSO: prove TLS-only private mTLS backend and eliminate legacy `:15583` plaintext bypass; then real authenticated Owner Redis/token revocation, signed device proof, Windows V4 App-to-Wall E2E. No live service or database was changed by this review.

Links: [Living Master](LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md) · [Code Map](LIGHT_REMOTE_CODE_MAP.md).
