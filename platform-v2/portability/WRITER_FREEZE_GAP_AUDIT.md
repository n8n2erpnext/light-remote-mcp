# rc50 P0 — Writer freeze / flush gap audit

**2026-10-12 · SOURCE AUDIT ONLY · NOT READY FOR LIVE SNAPSHOT**
Target: `feature/rc50-mjs-scale-20261011`, not production/staging. No Docker or database mutation.

## Verified coverage

The machine-readable `writer-freeze-readiness.json` maps all **14** named Operator durable file entries in `legacy-state-contract.json` to their actual writer source modules, plus all **4** plugin state writers. `audit_writer_freeze_readiness.py` enforces exact IDs and classification, requires reviewed source markers, rejects optimistic `fsync_proven` / `source_fence_proven` / `consistent_generation_proven` claims and checks five dependent process/pump risk markers. Successful execution deliberately returns `status: NOT_READY`, not backup acceptance.

### The main missing durability barriers

1. **Operator 14/14 + Plugin 4/4 direct JSON writes:** reviewed writer modules contain `fs.writeFileSync(`; many write temp files and `fs.renameSync(`. Rename provides a useful atomic namespace update but, without file and containing-directory `fsync` acknowledgements, does not prove crash durability. The static scan found **no fsync proof** in those source modules. This does not mean every file is necessarily corrupted during a crash; it means crash-consistent persistence is *not proven*.
2. **Operator event log (rc50 dev patch):** `operator-host/executor.mjs` now uses `AuditAppendBarrier` from `operator-host/audit-append-barrier.mjs` to latch failed `fs.promises.appendFile` writes, propagate errors to request-level `await flushDiskRecords()` and exit nonzero after shutdown flush failure. This is a **source-dev change only**, not deployed. The append remains asynchronous and is **not fsynced**, so crash durability and an authoritative journal watermark are **still unproven**. Earlier pre-patch source swallowed append failures; do not describe that old behavior as current on this branch.
3. **Support outbox:** `plugin-server/support-backoffice.mjs` has a scheduled `setInterval` pump that may mutate status and delivery checkpoint after a naive file-copy fence. Capture/pause pump state and in-flight network delivery, then reconcile remote delivery deduplication.
4. **Fleet:** `operator-host/fleet-router.mjs` uses process-local `commands`/`completed` maps and `setOwnerDrain` is node-scoped. A global pause across all ingress, PTY, node dispatch and stale worker generations is not yet demonstrated by source. Do not equate an idle Fleet view with durable drain proof.
5. **OAuth:** `plugin-server/oauth.mjs` has process-local `usedCodes`, `usedRefresh`, `usedResume`; Google OAuth pending `flows` is also memory-only. Cross-process anti-replay needs a durable policy-enforced replay store; a restored process must fail closed/expire unfinished PKCE, not reset consumed JTIs.

### Implementation sequencing

1. Implement an owner-authorized **global writer-epoch lease/fence** externally persisted in a durable authority store, with fencing checked at *every* mutating ingress, background pump and outbound command dispatch. A disconnected client holding an old epoch may not execute a new command.
2. Add bounded drain of already-authorized jobs, PTYs, command receipts, OAuth exchanges, webhook handlers and support delivery. New ingress denied or durably journaled. No guessed `jobs: 0`: require a signed/measured count.
3. Make JSON state persistence durable (unique same-directory temp file; restrictive mode; flush file; rename; flush parent directory; surface failures; preserve security properties). Avoid broad production migration without complete UAT tests.
4. Preserve the dev error-latching append fix and add **real fsync/journal sequence ACK** with a durable offset; successful `appendFile` alone is not a freeze checkpoint. Ensure outbox provider IDs and usage charges reconcile idempotently.
5. Record one **generation + freeze ID** across all authoritative planes and signer identities, capture hashes only after actual writer barrier acknowledgements, and restore into a target with network + writers disabled.
6. Cross-check identities, revocations, account/Team/usage, OAuth consumed hashes and remote Paddle/ERPNext outbox receipts *before* enabling a **single** target writer.

## Safe prototype in this branch

`freeze-epoch-guard.mjs` is a tiny **in-memory synthetic-only** state machine with one-way `OPEN→FENCED→DRAINED→CHECKPOINTED`; it blocks fresh mutations on fence, requires existing mutation tokens to complete, requires an explicit external work-count report (never assumes zero), rejects active jobs/PTY/commands, then requires six flush lane acknowledgements bound to the same synthetic generation.

`../test/test-freeze-epoch-guard.mjs` has **12/12 PASS**. It intentionally does not call real Operator, OAuth, Fleet, Docker, the filesystem or database. Caller statements are unverified, and neither the process-local guard nor its test fixtures provide a distributed lease or authoritative persisted epoch. Its `view()` *always* reports `realBackupProven:false` and `productionCutoverAuthorized:false`. **Not wired into production.**

`../test/test_writer_freeze_readiness.py` previously had **10/10 PASS** before the dev append-latch manifest update; its post-update regression run was **tool-blocked** and cannot be claimed as reverified. New `../test/test-audit-append-barrier.mjs` had **8/8 PASS** before that later blocked regression attempt.

## Do not bypass blocked tools

Previously blocked AES-GCM runtime tests, two-stack Docker cold-move rehearsal and privileged DB-role provisioning are **unchanged**. Owner has granted Docker access for the isolated rc50 project, but that does not remove tool-level safety denials. Never use PTY, shell wrappers, alternate interfaces, or rewritten equivalent invocations to bypass these denials. No production-state data/secret export, release promotion or live cutover.
