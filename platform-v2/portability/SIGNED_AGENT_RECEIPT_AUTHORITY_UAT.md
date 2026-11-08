# rc50 P0 — Signed fake Agent receipt authority under Linux flock

**2026-10-13 · Linux / VPS-ARM · synthetic and source-only UAT · NOT PRODUCTION-READY**

This checkpoint builds directly on `c707fee`. It makes a **real Ed25519 signature check happen within the Linux OS-locked fake receipt worker**, instead of accepting a caller-provided `verifiedBy` flag as an assertion of cryptographic authorization.

## Files

- `synthetic-agent-receipt-authority-worker.mjs` (amended): accepts new `initialize_signed`, `signed_epoch`, `signed_accept`, `signed_start`, `signed_complete`, and local `signed_recover` **only within private synthetic test fixtures**. Its pre-existing unsigned fake test mode remains for older UAT; it is categorically rejected after a verifier is pinned.
- `synthetic-signed-agent-gate.mjs` (amended): exports strict, canonical fake Ed25519 epoch/command verifiers and domain-separated SHA-256 digest helpers, while preserving the original experimental gate's behavior and signatures.
- `test_synthetic_signed_receipt_authority.mjs` (new): 25 Linux multi-process and signed-receipt tests.
- `../test/test_synthetic_signed_receipt_authority_source.py` (new): 9 offline source guards.
- `README.md` (updated index).

## Signed test-only trust flow

1. The test supervisor generates a throwaway Ed25519 keypair **only in RAM**, opens a mode-0600 stable Linux `authority.lock` and invokes the worker via `flock -x -n -E 77 -F <absolute lockfile path>`. Worker verifies matching inherited fd3 inode, private `/tmp/lr-rc50-agent-authority-*` directory and local file permissions. Independent `flock` contender proves the actual kernel lock is held, not merely inode equality.
2. Only `initialize_signed` on a previously nonexistent receipt can persist a canonical Ed25519 SPKI public verifier and its SHA256 fingerprint. **This initial key is supplied by the trusted UAT supervisor, NOT an authenticated production Wall owner.** After initialization, another verifier cannot reinitialize the root. Receipt and verifier fields are protected only by fixture OS permissions + cooperative locking, NOT hardware-backed key custody.
3. For `signed_epoch`, worker verifies the Ed25519 signature *while holding the OS lock*, exact fake target account/device/Agent, generation, grantRevision, validity interval, and monotonic generation/grant floor. SHA-256 of canonical, domain-separated signed epoch payload is persisted alongside generation. Equal generation with a different epoch digest fails closed; no implicit revocation or signer rotation is assumed.
4. Every `signed_accept`, `signed_start`, `signed_complete` separately re-presents both signed epoch and signed command. Under the exclusive OS lock, worker re-verifies both packets using the pinned verifier, checks epochDigest, target, grantRevision, generation, packet expiry, and digest of the exact command payload. **Time is read inside worker with `Date.now()`**, not taken from arbitrary `request.nowMs` in a user-controlled command. A changed command under the same ID is rejected.
5. Only after these checks does the worker translate to the existing synthetic receipt decision model, which produces an **unexecutable** durable receipt mutation proposal. Atomic persistence includes exclusive temporary file, complete write, file `fsync`, rename and parent directory `fsync`. The operation is not a real PTY, SCP, native process or desktop command.
6. After `SIGKILL` immediately following fake STARTED receipt persistence, the Linux kernel releases `flock`; the next worker can perform **local-only** `signed_recover` to mark pending receipt `UNCERTAIN`. Re-presenting a correctly signed duplicate cannot replay it. Recovery cannot trigger physical action.
7. Signed epoch advance fences not-started fake receipts, preserves completed fake receipt, and refuses stale prior signed epoch/commands. Receipt corruption, broken symlink, changed pin fingerprint and rogue Ed25519 key all fail closed.

## Measured tests on approved VPS-ARM

```bash
node --test platform-v2/portability/test_synthetic_agent_receipt_authority.mjs platform-v2/portability/test_synthetic_signed_receipt_authority.mjs platform-v2/portability/test_rc50_agent_receipt_decision.mjs platform-v2/portability/test_rc50_agent_dispatch_triage.mjs
node platform-v2/test/test-synthetic-signed-agent-gate.mjs
python3 -B platform-v2/test/test_synthetic_agent_receipt_authority_source.py
python3 -B platform-v2/test/test_synthetic_signed_receipt_authority_source.py
node platform-v2/portability/verify_synthetic_agent_os_lock_uat.mjs
```

Observed: Node combined **113/113 PASS** (19 original locked authority + 25 signed authority + 26 receipt decision + 43 dispatch), independent original Ed25519 synthetic gate **20/20 PASS**, original source guards **7/7 PASS**, new signed authority guards **9/9 PASS**, corrected Linux 8-process inode-lock UAT PASS. Tests run only against freshly fabricated local fixtures, no existing account/device/billing/database states.

## Critical security limits — explicit FAIL of readiness claim

- **No authenticated owner-signed issuer**: the first pinned verifier comes from the test harness; no Local Wall A/B approval, account authorization, trusted remote distribution or key rotation process is proven.
- **No trustworthy monotonic clock or offline revocation bound**: using `Date.now()` inside worker removes a caller clock override but does not solve local clock rollback, malicious kernel time, reboot, or instant revocation for a disconnected device.
- **Pin and receipt share filesystem custody**: a hostile process with the same OS user permissions could alter both pin and receipt or ignore advisory `flock`. Real Agent needs a trusted protected launcher/service and independent trust anchor, robust storage custody and OS-specific access policies.
- **No crash/power-loss guarantee across all failure points**: file and directory fsync are explicitly called in UAT, but ambiguity after interrupted rename/fsync, whole-host power loss, network filesystems, malware, and malicious race conditions are not fully tested.
- **No actual native side effect**: all packets are `fake_noop` with `physicalExecutionAuthorized:false`. The fake `verifiedBy:'synthetic_test_only'` marker is set internally *only after real cryptographic verification*, but is NOT a production authorization credential.
- **No integration into `device-agent/operator-agent.mjs` or real terminal/process/desktop/SCP/filesystem/update execution**. Duplex/poll, owner grant revoke, Fleet dispatch, PG writer and billing remain separately unfenced. Windows mutex/ACL and macOS flock still NOT RUN.
- **Production global single-writer, cross-host move, real billing/OAuth cutover remain NOT_READY**.

## Next P0 engineering gates

1. Specify genuine owner/issuer trust bootstrap tied to Local Wall A/B approval; signed grant serial, target, generation, lease and revocation as durable authority (no caller-supplied public key), fail closed on stale network/device offline windows.
2. Introduce signed key rotation and verifier pin protection with independent OS/HSM policy, source-of-truth issuance and rollback controls.
3. Test receipt filesystem crash windows, symlink/path races, JSON torn writes and high-watermark retention; extend native lock implementations to Windows/macOS.
4. Add mandatory fail-closed physical-side-effect checks for all command leaves in a nonproduction canary only, after signer and OS adapter acceptance.
5. Keep Node.js ESM `.mjs`, Express5 and the active client wire protocol untouched. Do not deploy this synthetic worker.

The previous same-host two-Compose synthetic cold-move remains PASS at `6fc7da3`, but it cannot establish a safe real host switch.
