# rc50 P0 — Linux kernel-locked synthetic Agent receipt authority

**Date: 2026-10-13 · Experimental, Linux-only, fixture-only · NOT PRODUCTION**

## Why this exists

The inspected real `device-agent/operator-agent.mjs` has duplex and polling commands meeting in `executeCommand()`. The in-process `CommandExecutionCoordinator` shares one `Map`, which does not coordinate two independent Agent processes. The existing `readCommand` / `writeCommand` spool keeps separate per-command JSON files and `writeJson0600` uses a temporary `.lock` file created with `wx` then unlinked. That does not create a durable shared device-level receipt writer nor safely fence native side effects. The post-restart conversion of `running` to a terminal code-125 `finished` error cannot establish physical side-effect nonexecution; a future authority should persist `UNCERTAIN` and reconcile without replay.

## New files

- `synthetic-agent-receipt-authority-worker.mjs`: a **disposable UAT process**, never imported from real Agent. Called by a trusted test supervisor under util-linux `flock -x -n -E 77 -F <absolute receipt lock path>`. The supervisor passes descriptor 3 referencing that lock inode, and a separate process probes kernel contention to confirm the lock truly applies to the intended inode. A matching fd alone is not proof of lock acquisition.
- `test_synthetic_agent_receipt_authority.mjs`: currently **19/19 Linux process-and-file UAT PASS**. Creates random private `/tmp/lr-rc50-agent-authority-*` directory, `authority.lock` mode 0600, exercises fake generation/command envelopes only. Exits and cleans fixture.
- `../test/test_synthetic_agent_receipt_authority_source.py`: **7/7 source guards PASS** checking file+directory fsync, race/denial, lock identity and absence of real Agent imports.

`rc50_agent_receipt_decision.mjs` is the previously committed **pure test-only policy model**. In this UAT, a trusted supervisor supplies a fake lock marker to its decision API only after launching the OS-locked child; such flags are **not authorization evidence for any production caller**.

## Actual tested lifecycle

1. Lock `authority.lock` as a stable file on a local Linux filesystem; reject mismatched inherited descriptor, non-private fixture, symlink or hardlink anomalies.
2. Initialize once, persist `authority.json` with mode 0600; write complete temporary file, `fsync` file, atomically rename and `fsync` parent directory. Refuse corrupt or symlinked receipt snapshots and refuse unsafe reinitialization.
3. Under the lock, accept a **fake** Ed25519-like envelope marker (NOT real cryptographically verified signer); durable fake generation and receipt, duplicate no-op and changed digest fail-closed.
4. A separate process contends on the exact `authority.lock` inode; receives exit code 77. A second worker cannot change receipt during lock hold.
5. After writing fake STARTED, self-`SIGKILL`; lock is automatically released by kernel; the next worker reads durable STARTED, proposes and persists UNCERTAIN instead of executing the fake command. Duplicate remains no-op; uncertain cannot start.
6. A distinct fake command completes normally; generation advance fences accepted receipts while preserving completed receipts.
7. Corrupt JSON, invalid synthetic generation and a broken symlink never enable silent receipt reset.

All workers refuse any physical OS action: `physicalExecutionAuthorized:false`. `fake_noop` is only an in-memory label, not an executable script or a PTY request. The fixture runner's authority file and lock are deleted only as part of temporary directory test cleanup when no worker remains.

## Commands (VPS-ARM rc50 worktree)

```bash
node --test platform-v2/portability/test_synthetic_agent_receipt_authority.mjs
python3 -B platform-v2/test/test_synthetic_agent_receipt_authority_source.py
node --test platform-v2/portability/test_rc50_agent_receipt_decision.mjs platform-v2/portability/test_rc50_agent_dispatch_triage.mjs
node platform-v2/portability/verify_synthetic_agent_os_lock_uat.mjs
```

Actual results: **19/19**, **7/7**, **69/69**, and the existing **8-process corrected inode-lock fixture PASS** respectively. Node syntax checks and `git diff --check` also passed.

## Explicitly NOT ACCEPTED for production

- The UAT worker may be launched only with a private synthetic fixture. Its fake `verifiedBy:'synthetic_test_only'` cannot authenticate a real owner or device grant. A direct actor with raw filesystem access could bypass an advisory lock. Kernel flock is not a signed writer epoch.
- No integration into `operator-agent.mjs`, `device-agent` production command handlers, `lib/native-terminal.mjs`, `lib/native-process.mjs`, Real Remote, SCP, Fleet, operator or billing code. No production command dispatch or deployment.
- No Windows native mutex/ACL/abandonment or macOS BSD flock acceptance. No cross-host block device, NFS, network split-brain, actual SSD power-loss, external replay or malicious local processes proven.
- No owner-signed generation issuer and trusted account/device/grant binding; no monotonic offline lease with bounded revocation delay or generation high watermark tied to real A/B approvals. No global Operator/Plugin/PG writer fence.
- Atomic receipt writer **does not make arbitrary PTY/GUI/script effects idempotent**. Crashes after side effects need UNCERTAIN with independent reconciliation; never blindly replay.
- Fixture `delayMs` and `crashAfterPersist` are UAT-only knobs and MUST NOT become RPC options in real Agent.

## Next engineering gates

1. Trusted platform-independent authority contract with explicit signed-generation verification **inside** the locked gate and read-only issuer key pinning, not caller-supplied flags.
2. Native OS adapter acceptance on Windows/macos; enforce one compulsory entrypoint for **every native side-effect leaf**, including terminal input and desktop run after command admission.
3. Journal/tombstone retention across reconnect/redelivery windows; bound corruption/failure after rename/dir-fsync; test forced writer crash at each durable transition.
4. Bind network-issued grants and revocations to local high-watermark, ACK reconciliation and PG outbox epoch, prove disconnected-device stale denial.
5. Only then wire into `device-agent/operator-agent.mjs` in strictly opt-in nonproduction canary and run real-client negative tests before promotion.

Latest synthetic Docker two-stack same-host cold-move passed twice in earlier commit `6fc7da3`, but **production host switch stays NOT_READY**.
