# rc50 P0 — Single-instance replay lease & live journal identity (2026-10-13)

**Status:** HTTP verifier **SOURCE-ONLY**. Node filesystem unit tests PASS on VPS-ARM. No HTTP Docker integration, no persistent server deployment and no production migration.

## Baseline
- Parent `2485f3f`: pre-provisioned, owner-only append+fsync nonce journal; 7/7 unit tests PASS. Its replay cache remains single-instance; two Node processes could keep independent in-memory sets when given the same journal, so two instances must not be allowed to open concurrently.
- Most recent full disposable Docker/PostgreSQL/Ed25519 runtime UAT is still historical `c7bb175`. The HTTP service runner integration attempted in the preceding sessions was blocked; it has **not** been reattempted via another interface.

## Source changes
1. New `synthetic-single-instance-lease.mjs`: local-file `O_CREAT|O_EXCL|O_NOFOLLOW` lock at `<journal>.owner-lock` on owner-only directory. Writes fixed header + PID and fsyncs file+directory. Only a holder whose live fd **and** lock-path inode match can claim ownership; files with unsafe ownership/mode are rejected. A second same-path instance is denied. Clean release checks inode before unlink+directory fsync; process death leaves the lock in place and prevents automatic startup. **There is no automatic stale PID reaping or lock reset.**
2. `synthetic-origin-verifier-http-service.mjs`: now acquires `SyntheticSingleInstanceLease(replayJournalPath)` **before** opening replay journal. Refuses authentication if `lease.owns()` becomes false; health checks lease and journal. Graceful server close on SIGTERM/SIGINT closes journal then releases lease. Abrupt process exit intentionally leaves a stale lock requiring deliberate operator investigation.
3. `synthetic-durable-nonce-journal.mjs`: captures opened journal's device/inode/expected byte length; checks fd and current path still refer to same owner-only single-link inode of the expected size before appending a new nonce. Unexpected external append, replacement/rename, size change or permission alteration latches 503, not an in-memory fallback. Existing fsync on accepted nonce is maintained.
4. `Dockerfile.synthetic-origin-verifier-uat`: copies only a new UAT `.mjs` module; does not deploy.
5. `test/test_synthetic_single_instance_lease.mjs`: four actual Node filesystem unit tests, including **another Node process unable to take same lock**, clean release/reopen, crashed child leaving stale lock, unsafe directory, tampered lock inode.
6. `test/test_synthetic_durable_nonce_journal.mjs`: one new unit case for external append and journal-path replacement while active; 8/8 total.
7. `test/test_persistent_verifier_source_only.py`: two new source guards for lease integration and journal inode checks; 12/12 total.
8. This report + README index.

## Measured on actual VPS-ARM
```sh
node --test platform-v2/test/test_synthetic_durable_nonce_journal.mjs \
  platform-v2/test/test_synthetic_single_instance_lease.mjs
# 12/12 PASS (8 journal + 4 exclusive lease)
python3 -B platform-v2/test/test_persistent_verifier_source_only.py
# 12/12 PASS (source only)
python3 -B platform-v2/test/test_synthetic_verifier_container_source.py
# 12/12 PASS (source only)
python3 -B platform-v2/test/test_origin_cross_container_clients_source.py
# 10/10 PASS (source only)
python3 -B platform-v2/test/test_owner_channel_reader_acl_source.py
# 7/7 PASS (source only)
node --check platform-v2/portability/synthetic-origin-verifier-http-service.mjs
git diff --check
# PASS
```
The fixture creates temporary owner-only files under the user's temp directory; no existing PostgreSQL, customer state or production service is changed. Crashed-child lock cleanup is intentionally manual **only inside the disposable unit-test fixture**.

## Security boundary and limitations
- This ensures **ordinary local UAT processes sharing a trustworthy directory cannot claim the same lock at once**. It is NOT a distributed or cross-host consensus/lease, Docker Fleet authority or protection against an attacker with the same UID/directory write access.
- A malicious same-UID actor may delete a lock, replace a journal with a valid-prefix older snapshot, or fabricate a valid-looking replay file. Inode/size checks detect some **live mutation**, not a complete rollback attack after restart. Genuine rollback resistance requires an independently trusted monotonic checkpoint, preferably PostgreSQL transactional replay ledger coupled to writer fence.
- Stale lock after crash intentionally blocks liveness. An owner must confirm no instance is running, journal validity and external proof before manually reconciling; no automatic stale-lock breaking script is provided.
- Journal still has fixed 1024 lifetime HMAC claims, no pruning; exhaustion defaults to DENY/503. Producer HMAC possession is not real Local Wall consent. Writer/issuer still trusts format-valid digest fields and needs an authenticated, per-decision, replay-consumed verifier proof.
- Existing blocked HTTP Docker integration remains blocked; no PTY, wrapper, alternate connector or other bypass attempted. No live Agent PTY/RM/SCP effect, API exposure, production operator/plugin, billing, ERPNext, Git main, customer data or secret touched. **GLOBAL_WRITER_FENCE_NOT_READY**.

## Next P0
1. Design and source-test PostgreSQL **single transactional replay-ledger** semantics for multi-instance verification; writer generation/lease must share the same fence. Do not promote local O_EXCL lock as global correctness.
2. Add a short-lived, authenticated verifier→issuer **decision capability** bound to approved request/grant/session/device/nonce/proof hash/expiry and consumed once by a trusted issuer. Use fake keys and source-only tests until integration is permitted.
3. After acceptable authorized integration process: private-network HTTP UAT, HMAC bad/replay/restart negative tests, PG ACL/TLS/HBA and kill/restart before grant commit. Real owner B-code and Agent side effects remain off.

Node.js ESM `.mjs` + Express 5 product architecture remains canonical; scale-up/k3s is future portability, not today's cutover.
