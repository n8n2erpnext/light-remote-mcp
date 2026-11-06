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

## 6. Read-only deterministic Lab043 artifact proposal, 2026-11-04

Use deploy/scripts/gold-abv2-lab-043-compatibility-review.mjs --review to verify the exact isolated Lab. It derives a HYPOTHETICAL 43-entry migration lock in memory from version-controlled Git42 and pinned SQL043, SHA256 9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609, exactly matching both old Plugin and Operator Lab-deployed lock files. No artifact file is emitted or installed.

The actual Lab review verifies applied ledger 043/timestamp, SQL043 SHA 935b268899c7b59761781db33d8ad2c573773566844fbfab0b861046f3a680d4, short-id immutable trigger, Owner045 tables and Guest044 absence, and stage042. Output is a reproducible proposal with canCutover=false, releaseApproved=false, canApplyMigration=false, canEnableSso=false. No file, service, database or auth state changed. Lab-only staging and any live cutover still require explicit separate owner scope approval, snapshots, rollback and signed E2E; this does not authorize Gold UAT or production release.

## 7. 2026-11-04 ~18:36 ICT — Lab043 GO/NO-GO decision record

**NO-GO for source cutover.** Real prepared artifact audit exit0 and Node syntax all 222/222 staged JS files PASS. Both update-lifeboat Linux/macOS dynamic targets exist and syntax PASS; no runtime import or process startup was exercised. Stage checksum and all 18 external + 309 relative imports resolve.

Canonical preflight remains BLOCKED exit3: Git committed migration lock ends at 042, isolated Lab database ledger and prepared source lock at 043. No reviewed release exception policy grants a source cutover, and this review does not authorize changing main/UAT/prod lock. Lab-only Owner045 and Guest044 HOLD remain unchanged.

A future separate owner decision must identify exact isolated Lab target, pinned stage and acceptable startup gate; fresh snapshot, independent rollback timer and bounded health tests must pass immediately before any restart. SSO/Guest044/production are not in this scope.

## 8. 2026-11-04 19:00 ICT — Owner conditional trial authorization and system safety stop

The owner authorized a strictly isolated LAB043 Plugin/Operator guarded source trial, with SQL unchanged, SSO/mTLS OFF, Guest044 HOLD and UAT/production excluded. This is NOT authority to override the canonical Git042 vs Lab43 startup preflight without a reviewed separate Lab-only release gate. Before any source switch, host systemd rollback timer installation failed: /etc/systemd/system is on read-only host root. No cutover or SQL occurred. Fresh isolated Lab snapshot pre-t04b8-a2-owner-approved-20261104-1900 was created. Continue only after independent timer readiness and Lab-only schema/startup review are both satisfied.

## 9. 2026-11-04 19:25 — Native staged schema043 Lab gate and real source restart PASS

A specifically Owner-authorized isolated Lab-only trial ran source b8ec5d6f from inside LXD after proving PostgreSQL ledger43 and exact artifact lock043 SHA256. Its native assertGoldStartupMigrationLedger and assertGoldStartupExtensionTables PASS on real PG with SQL043 trigger and Guest044 absent. Both Plugin+Operator actually booted and served HTTPS200. The separate canonical Git lock042 preflight intentionally still BLOCKS generic UAT/prod release and has NOT been disabled or modified. Lab-local service rollback restored old source and timer disarmed. No SQL applied, SSO OFF, main Gold UAT/prod untouched.
