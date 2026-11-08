# rc50 P0 — HMAC replay journal, fail-closed on missing state (2026-10-13)

**Scope:** SOURCE-ONLY persistent HTTP verifier prototype, Node.js ESM. No Docker service integration or production/staging deployment. Parent checkpoint `4e97f0b` contained only unintegrated HTTP modules. This patch resolves the identified **RAM-only nonce replay vulnerability** in the proposed service; it does not remove the preceding tool block on the Docker UAT runner.

## Threat and fix

Previously `synthetic-origin-verifier-http-service.mjs` kept seen 128-bit HMAC nonces in `new Map()`, pruning after 30 seconds. Restarting with the same HMAC secret could accept a previously authorized request within its valid 30-second timestamp window.

**New `synthetic-durable-nonce-journal.mjs`:**
- Introduces `SyntheticReplayJournal` for **single-instance synthetic UAT only**. It requires an **already initialized** file under a preprovisioned owner-only directory. Service opens the existing file with `O_NOFOLLOW`, verifies regular file, single link, same UID and no group/other access. Wrong permissions, missing directory/file or unparseable/torn/duplicate history -> fail-closed at startup; no auto-repair/rotation.
- `initializeSyntheticReplayJournal` is a separate explicitly called, create-once helper using `O_CREAT|O_EXCL`. **The live HTTP service never imports or calls the initializer.** Deliberate operator provisioning is required before an eventual UAT deployment; an accidentally lost/deleted journal cannot silently recreate an empty replay store.
- Journal format: `LR_RC50_UAT_REPLAY_V1\\n` header plus 32 lowercase hexadecimal nonce + newline records. Nonces are never automatically pruned, even after expiry, so backward clock movement cannot revive previously recorded nonces. Strictly bounded at **1024 lifetime successful HMAC claims**; thereafter all *new* nonce claims return 503 until an explicitly reviewed migration (NOT automatic cleanup).
- On a valid signed request, the nonce record is appended and **`fsyncSync` completes before returning authenticated status 200 and before invoking the Ed25519 verifier**. Duplicate nonce returns 409. Any short write or fsync failure sets a sticky fatal latch (503); do not continue in RAM-only mode. Initial create-once provision fsyncs file and parent directory.
- `synthetic-origin-verifier-http-service.mjs` now hard-fails bootstrap if journal missing/corrupt, and checks that HMAC secret file is a single-link, same-UID regular file with no group/other mode bits and no symlink. `/var/lib/lr-rc50-uat/nonce-journal` is intentionally **NOT provisioned by code**, so the service cannot accidentally start on a live machine or a read-only image without a reviewed writable durable volume.
- Dockerfile adds only a source `COPY --chmod=0444` for the journal module. No active Compose/systemd service changed.

## Tests actually performed (VPS-ARM developer host; no Docker UAT integration)

```sh
node --test platform-v2/test/test_synthetic_durable_nonce_journal.mjs
# 7/7 PASS: replay across journal close/reopen AND a fresh Node process; capacity and invalid nonce;
# torn/corrupt history; symlink/file/dir permissions; deleted journal; duplicate;
# create-once cannot overwrite an existing journal.
python3 -B platform-v2/test/test_persistent_verifier_source_only.py
# 10/10 source guards PASS
python3 -B platform-v2/test/test_synthetic_verifier_container_source.py
# 12/12 existing verifier image source guards PASS
node --check platform-v2/portability/synthetic-origin-verifier-http-service.mjs
git diff --check
```
All tests above are unit/static/syntax only. No persistent HTTP service launch, no real Docker producer, no HTTP stress/restart integration, no actual new image build, no live A/B. The last completed **isolated PostgreSQL/Node Docker UAT** still belongs to `c7bb175`.

## Risk not solved

- This journal provides **single-process crash/restart memory**, not cross-process/multi-host atomic replay protection. Multiple independent verifier instances must NOT share this file or HMAC identity until a global database-level replay arbiter or a correct cross-host lock exists.
- **Valid truncation or replacement by a malicious same-UID actor may not be detected**: the text journal is not MAC chained, signed, or anchored to an external monotonic watermark. No proof against storage rollback, malicious administrator or filesystem snapshot restore.
- Bounded 1024 lifetime claims intentionally trade availability for no silent replay-history deletion. Exhaustion fails closed and requires explicit owner migration.
- No end-to-end producer identity beyond possession of UAT HMAC; no verified service TLS/mTLS, real owner consent/signatures, signed verifier→issuer decisions or nonforgeable grant authority. Do not grant physical Agent actions.
- No Docker image/host port/production Operator/Plugin/Billing/ERPNext/Main-branch changes. No previously tool-blocked integration was retried via PTY/alternate tool. **GLOBAL_WRITER_FENCE_NOT_READY** and production cutover **NOT_READY**.

## Next

After allowed integration review: test the actual separate producer/verifier containers with the deliberate durable state volume, signed request HMAC and restart: first accepted, replay denied before and after restart, expired window denied, lost journal prevents startup, replay-capacity 503, corrupted record failure, reader credential revoke DENY and writer isolation. Afterwards design authenticated verifier→issuer decision proof and TLS/CA HBA boundaries. Do not merge to main or enable real Agent capabilities.
