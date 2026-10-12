# rc50 portability P0 — first opt-in registry and fsynced synthetic journal

Checkpoint: **2026-10-12, source dev branch only**. This is a bounded experiment, not production backup/restore, no cold-move test, no approval to migrate authority.

## A. FreeBenefitRegistry synthetic writer opt-in

`operator-host/free-benefit-registry.mjs` now accepts an **optional** `syntheticDurableUat` constructor field. Production callers do **not** pass this field and retain existing `fs.writeFileSync + renameSync` persistence. To enable the test-only path, all of the following must be explicit:
- `mode: 'shadow'` (enforced/free-quota production mode **cannot** use it).
- `syntheticDurableUat.syntheticOnly === true` and caller-provided `writer({stateFile,value})` callback.
- Root path is an existing real immediate child of `os.tmpdir()`, basename starts `lr-rc50-benefit-fixture-`.
- State path is the exact `<root>/free-benefits.json`, absolute and normalized, not arbitrary production data.
- Callback in tests is `writeSyntheticJsonDurably({root,file:stateFile,value})`, which writes temp+file fsync+rename+directory fsync. `syntheticOnly` is an **intent marker**, not a cryptographic authorization token or distributed fencing mechanism.

After a write exception the UAT instance is **poisoned**: it refuses further `reserve` (including paid-path short circuit), `status` and rotation family lookups. Restart/reconcile is required. If directory fsync fails after rename the target may contain a newer-looking snapshot, **not** evidence that the last write was durably acknowledged. The UAT code never treats such an exception as a successful quota charge.

`platform-v2/test/test-free-benefit-durable-uat.mjs` — **6/6 PASS** after UAT root hardening. Tests use only `os.tmpdir()` synthetic fixture. They cover correct reload/idempotency, untouched default source writer, explicit shadow-only opt-in, file-fsync failure poison, ambiguous directory-fsync failure and no paid-path fallback after poison.

This **does not** change production Free/Team billing and does **not** prove a distributed account quota ledger. In-memory mutation can precede failed file persistence; poisoning is intentional and no automatic replay occurs.

## B. Synthetic fsynced journal sequence watermark

`platform-v2/portability/synthetic-journal-watermark.mjs` is **not imported by Operator**. A test fixture must reside at `<os.tmpdir()>/lr-rc50-journal-fixture-*/activity.jsonl`; no other path is accepted. Each JSONL record includes strict consecutive `sequence`, a prior hash and the record digest. Each append is bounded, opened with append+no-follow flags, written completely, then `fsync`ed. On first creation, parent directory is also synced. Only after successful acknowledgements does the in-memory `sequence / byteOffset / SHA-256` watermark advance. Any failure poisons the instance; do not continue writing.

On construction an existing synthetic journal is fully validated (private file mode, newline-terminated records, no sequence gap, matching predecessor hash and canonical digest). Corrupted/incomplete logs are rejected, not skipped. **A reopened journal reports `fsyncAcknowledged:false` until that new process actually performs its own successful append+fsync; content alone is not proof that a previous process acknowledged a write.** This detects deliberate or accidental file inconsistencies **on this local synthetic fixture**; it does **not** give trusted remote attestation, authenticated signatures, production epoch continuity, single-writer proof, or transaction coordination between PostgreSQL, JSON and provider webhooks.

`platform-v2/test/test-synthetic-journal-watermark.mjs` — **11/11 PASS**, including two fsync calls on new file, restart verification, injected file/directory sync failures, short write poisoning, malformed tail/hash, symlink/untrusted paths and an isolated compatibility test with `AuditAppendBarrier`. An initial fixture-lifecycle bug was fixed; tests subsequently passed.

## C. Open migration gates

- Existing `operator-host/executor.mjs` still uses the dev audit append barrier plus regular `fs.promises.appendFile`; it is **not** calling the fsynced synthetic journal, and no actual production log watermark exists.
- 14 Operator and four Plugin legacy JSON source writers still have no completed file+directory fsync conversion, writer generation fence, or synchronized freeze marker.
- Shared source fence across OAuth HTTP, Fleet commands, native PTY, Paddle/ERPNext and support outbox remains unimplemented.
- Source-level writer-audit regression from the previous checkpoint was safety-blocked after manifest changes. It has **not** been re-run via alternate commands.
- AES sealed synthetic runtime test, two-stack Docker cold move and privileged app-role provisioning remain previously blocked; do **not** use PTY or other interface to bypass them.
- No production filesystem, account records, signing keys, billing invoices or real Docker volume were touched in these tests.

**Next safe P0:** design opt-in **durable journal checkpoint/watermark** as an independent interface, plus a systemwide authoritative fencing protocol; avoid wiring the experimental journal into production by stealth. Prioritize proof that source and target can never accept writes simultaneously, then verify independent nonproduction restore after legitimate permission approval.
