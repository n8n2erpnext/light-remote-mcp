# rc50 P0 — One Linux lock and durable state for fake A/B grant + Agent receipt

**2026-10-13 · VPS-ARM · NODE ESM · STRICTLY SYNTHETIC/TEST-ONLY · NOT DEPLOYED**

## What changed

The UAT now models **one mandatory receipt authority** rather than two unrelated test modules. Under the *same* Linux kernel `flock` and within *one* atomically persisted `authority.json` snapshot, it evaluates:

1. Three independently pinned and test-generated Ed25519 verifier keys: a fake Wall A/B approval signer, a fake lease issuer, and an independent fake Agent epoch/command signer. A reused key is refused at trust bootstrap. Neither a real owner nor Local Wall is involved.
2. `bound_accept`: verifies both A/B proof-chain packets with the pinned Wall/lease issuer keys, exact account/device public-key fingerprint/Agent/connection/grant/approval digest, revocation floor, grant expiry, generation and grant revision; then verifies signed writer epoch and command with the third pinned Ed25519 key and the same lease generation/revision. It atomically commits the **grant high-watermark + writer epoch + fake ACCEPTED receipt together** (complete temporary-file write, file `fsync`, rename and parent-directory `fsync`) under one kernel-held lock.
3. `bound_start` / `bound_complete`: rechecks a fresh A/B signed lease **before the fake state transition**; independently rechecks the signed writer epoch and command. No native OS command, PTY, GUI, SCP, filesystem, or networking executes; the fake payload is only `fake_noop`.
4. `bound_revoke`: verifies issuer-signed revocation, durably updates floor and tombstones old grant, **FENCES all outstanding ACCEPTED receipts** and converts all outstanding STARTED receipts to UNCERTAIN. COMPLETED remains completed. This conservative per-device behavior may block unrelated staged work because the current fake receipt schema has no per-grant pointer; this is **deliberately fail-closed**, not a production revocation policy.
5. `bound_recover`: only reconciles local incomplete fake receipts into UNCERTAIN. It requires valid pinned writer/Wall/issuer keys, mutually consistent and valid receipt/grant snapshots. No signature or grant is needed to mark potentially executed fake work uncertain, and recovery never performs physical work.
6. All `bound_*` operations are barred on non-bound fixtures; all old unsigned and less-restrictive `signed_*` mutation paths are forbidden on a bound root. A matching FD3 inode alone is insufficient; an external `flock` contender verifies the lock actually excludes a separate process.
7. On every bound operation, corruption/inconsistent generation or revision, tampered Ed25519 pin, malformed receipt, and local clock lower than last-seen persisted watermark fail closed. The worker reads its own `Date.now()`, not network/caller-provided `nowMs`.

Code artifacts:

- `platform-v2/portability/synthetic-agent-receipt-authority-worker.mjs`: extended **only** within the synthetic Linux fixture process.
- `platform-v2/portability/synthetic-ab-grant-lease.mjs`: exported a source-only state validator for safe restore checks.
- `platform-v2/portability/rc50_agent_receipt_decision.mjs`: exported a source-only receipt snapshot validator.
- `platform-v2/portability/test_synthetic_bound_agent_authority.mjs`: Linux multi-process Node UAT.
- `platform-v2/test/test_synthetic_bound_agent_authority_source.py`: read-only source guards.
- `platform-v2/portability/README.md`: latest checkpoint index.

## Acceptance evidence and experiment limitations

`node --test platform-v2/portability/test_synthetic_bound_agent_authority.mjs`: **29/29 PASS**, including rejection of direct worker invocation, bootstrap duplicate/reused signing key, old unsigned/signed API bypass, rogue Wall/issuer/writer signatures, wrong lease-epoch generation, correct atomic grant+receipt admission, duplicate suppression, independent kernel lock contention, revocation before STARTED, SIGKILL after persisted STARTED, post-restart UNCERTAIN quarantine, regrant under increased generation/grant revision, valid fake completion, revocation during STARTED, corrupted grant/receipt/pin, failed clock rollback, torn JSON, symlink.

Source guards independently check no real Agent imports and no real OS action capability. Previous signed receipts, pure grants, decision/dispatch and OS inode-lock tests are preserved. Only random `/tmp/lr-rc50-agent-authority-*` fixtures and ephemeral RAM Ed25519 keys are used. No production data or credentials were accessed or altered by these tests.

**Production gate is NOT READY.** This does not authenticate an owner or real Wall B-code approval. Fake issuer keys are provided by an untrusted local test supervisor; actual A/B request/grant transaction, revocation feed, key custody, lock adapters for Windows/macOS, monotonic rollback-resistant clock, and global PostgreSQL writer authority are absent. The file is only protected from other cooperative processes, not an attacker with the same OS account. Real PTY/desktop/process/SCP side effects remain *entirely unwired* and require independent just-before-effect checks. A process already acting on an OS command cannot be forced to undo that action merely because its receipt changes to UNCERTAIN. Disconnect/revocation delay cannot be claimed better than the signed lease window, assuming sound clocks.

## Next gate

- Formalize real `Local Wall approved request → transactionally issued grant → signed short lease` owner and device identity provenance, including team-delegation rules separately.
- Design a protected Agent service and native mutex/flock ownership for Windows/macOS, plus atomic lease/grant/receipt journal retention across reboot and hostile clock rollback.
- Add safe failure injection at each fsync/rename phase and deterministic replay/retention tests.
- Only then build an **opt-in test Agent integration** that gates every side-effect leaf; keep production untouched and global migration `NOT_READY`.
