# rc50 — real Operator signed HTTP Fleet/WAL retention UAT

Date: 2026-10-16 Asia/Ho_Chi_Minh.
Branch: `feature/rc50-mjs-scale-20261011`.
Baseline: `e6fab96929ced15963ea128bf3a35f623f93c727`.
Scope: disposable local Operator process, real protocol signing/verification and HTTP routes, simulated Agent result; NO actual remote OS execution.

## Purpose and boundary

The previous DEV remote-effect WAL and native shutdown improvements were proven by library fixtures and runtime-source assertions. This test exercises the **actual HTTP boundary** with signed enrollment and Agent channel messages, real Operator `/v1/execute`, Fleet queue and result handling. The fake Agent does not execute the command, so this is not an Agent-binary trust-chain test or side-effect-exit attestation.

## New test

`platform-v2/test/operator-real-signed-fleet-wal-http.test.mjs` starts the real feature-branch `operator-host/executor.mjs` as an isolated child. All files, signer keys, Ed25519 Agent identity, device enrollment and state are synthetic in a private temp directory. DEV local freeze and DEV journal are both opt-in. The journal is explicitly provisioned as valid empty mode-0600 JSON.

The script checks these steps against live Unix HTTP:
1. Real enrollment begin/approve for a fake device with a fresh Ed25519 key; a signed `connect` and signed Fleet `poll` identify the fake leaf.
2. A real remote session and cryptographically sealed `exec_batch` dispatch via `/v1/execute`; the received job routes to `outbound-leaf`.
3. Verify the journal **already contains the matching command ID before any Agent poll**. Verify mode 0600; reject unsigned poll.
4. Signed poll receives that command. A tampered `result` signature is rejected and journal remains pending.
5. Signed fake `result` returns successful job ACK and duplicate is idempotent. Journal deliberately still has the command: a remote `process start` or similar ACK is not proof that OS effects have ended.
6. Real SIGUSR2, `/healthz`, `/readyz` and `/v1/capabilities` show `freezing`/503 admission with the fsynced marker; no false `frozen` ACK.
7. Real SIGTERM exits nonzero, leaves journal ownership lock and pending command durable; fresh Operator startup refuses the unresolved marker/journal.

No real customer data, production API, connected Agent, external TCP network, or server deployment is contacted. The script removes only its private fake test files and process.

## Important acceptance limits

- This is **signed Agent-emulator E2E**, not real Agent binary execution on HOMELAB/Windows/macOS. The test does not prove signed process-exit receipts or remote side-effect quiescence.
- No independently authenticated global writer epoch, crash-consistent cross-service checkpoint, complete ARM64→AMD64 state restore/rollback or signed production release was added.
- The existing registry-source audit remains 16/18 fsync-proven, global writer authority false. All P0-A/B/C/D/E remain **NOT_READY**.
- Real production remains unchanged, no merge into `main`, no bypass of previously policy-denied code paths.

Next: separately authenticated Agent-side OS lifetime receipts tied to durable writer generation, with end-to-end executable Agent UAT, then genuine fake multi-host restore/rollback behind one fenced writer. The owner must approve any blocked code paths through their legitimate permissions.
