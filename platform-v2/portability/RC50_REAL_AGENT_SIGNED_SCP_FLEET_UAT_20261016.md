# rc.50 P0-C/P0-E — real Agent, Operator and signed Fleet SCP E2E (DEV isolated)

Date: 2026-10-16 Asia/Ho_Chi_Minh
Baseline commit: `8ce59cdb2a577b95757f749fe23fcb88cf8624c4`
Scope: source feature branch; ephemeral VPS-ARM loopback-only UAT; NOT production device, not installed plugin, not a release.

## Why this is a stronger test than earlier MCP callback checks

Earlier `scp-registered-mcp-callback.test.mjs` exercised real registered Plugin tool callbacks to a *mock Operator seam* and a real `LightScpRegistry`. That did not prove the remote Fleet/Agent wire path.

New `platform-v2/test/operator-real-agent-scp-fleet-wal-e2e.test.mjs` starts:
- Actual product `operator-host/executor.mjs` in its own Node process with disposable 0700 state/log/socket dirs, local Unix socket and development-only durable remote-effect journal, private mock keys, no integrated host, no production services.
- Actual product `device-agent/operator-agent.mjs daemon` in its own Node process with synthetic Ed25519 device identity, 0600 local enrollment state and command spool, a loopback ephemeral Local Wall and explicit filesystem allowlist restricted to the temporary UAT root.
- A strict 127.0.0.1 ephemeral proxy forwarding ONLY signed `device-channel/{poll,result,fleet-intent,update-report}` endpoints to this exact local Operator socket. There is no real external device, customer enrollment or network deployment.
- Real Operator enroll begin/approve/connect for its disposable Agent, a real opened session and actual signed Agent polling and signed result receipts.

The test explicitly invokes `prepareScpUploadChunk` (the source Plugin adapter from commit d200ddc) to produce `upload-chunk` command envelopes. It then seals each SCP Operator request through the actual Operator private UAT fixture and routes each command through real Fleet queue and real Agent. The Plugin HTTP server is **not** started here, so it does not prove the connected deployed plugin has been updated; that separate registered-MCP callback boundary is tested in `scp-registered-mcp-callback.test.mjs`.

## Operations observed on actual Agent executable

1. Begin a 140011-byte random binary upload with real SHA-256 and chunkBytes=65536. A real signed Agent result is accepted and DEV remote-effect WAL retains a pending row.
2. Deliberately submit a signed SCP upload-chunk envelope with actual bytes but **incorrect explicit per-chunk SHA-256**. Actual Agent returns signed `status:error` / `scp_chunk_hash_mismatch` without accepting the bytes. Independently signed `status` confirms zero received chunks and zero received bytes; no destination file exists.
3. Pass all three actual binary chunks through the source Plugin's canonical per-chunk SHA adapter, sealed Operator route, real Fleet, real Agent `LightScpRegistry`. Signed Agent results report 1/2/3 received chunks, and the pending WAL counts remain outstanding.
4. Signed `upload-commit` passes real whole-file checksum. Independently read destination bytes from the synthetic-only UAT path and compare byte-for-byte against original.
5. Signed Agent `download-begin`, three `download-chunk` results and `cancel`; each returned chunk hash verifies and concatenated bytes exactly match the original binary.
6. Real SIGUSR2 freeze signal to UAT Operator: durable local freeze marker is written, reported `pendingExternal>=4`, and `/readyz` returns 503. The Agent is stopped cleanly. Operator startup while journal owner lock and pending remote effects remain is refused. Signed command ACK is NOT side-effect quiescence.
7. All children, Unix socket, enrollment/keys, UAT files, private spool, ephemeral HTTP proxy and temporary state are removed in `finally`; nothing is deployed.

The test uses **real actual product Agent/Operator executable and local signed channel**, not fake Agent for the SCP portion. The malformed-hash case is injected below Plugin's public validation to test Agent's independent last-line check; the Plugin itself already rejects the same invalid hash in its own test suite.

## Commands and gating

Focused:
`node --test platform-v2/test/operator-real-agent-scp-fleet-wal-e2e.test.mjs`

Consolidated:
`node --test platform-v2/test/*.test.mjs`
`python3 -B -m unittest platform-v2/test/test_real_pg_redis_cross_host_uat.py platform-v2/test/test_cross_host_synthetic_state_uat.py`
`python3 -B platform-v2/test/test_p0_release_gate.py`
`python3 -B platform-v2/test/test_writer_freeze_readiness.py`
`python3 -B platform-v2/portability/audit_writer_freeze_readiness.py`
`python3 -B platform-v2/scripts/p0-release-gate.py --report` (NOT_READY is expected)
`python3 -B platform-v2/scripts/p0-release-gate.py --require-ready` (expected exit code 3, explicit release DENY)
`git diff --check`

On final commit, verify actual native CI ARM64/x64 and isolated data contract on **exact pushed SHA**; no assumption from local success.

## Strict limitations

- Deployed ChatGPT Light Remote public plugin is NOT automatically upgraded; earlier actual HOMELAB public tool `scp_invalid_sha256` remains unresolved until a canary with updated Plugin is approved and verified.
- This is one machine running two real OS executable processes and a signed local proxy, NOT a two-physical-host production-equivalent OAuth and A/B admission or WAN transport test.
- The entire end-to-end proof uses synthetic enrolled identity, synthetic account and temporary paths. It cannot certify real Local Wall B issuance or billing/security entitlement, device reconnection under arbitrary network partition or production secrets.
- The DEV durable remote-effect WAL refuses settlement even after a successful file commit. That is intended fail-closed behavior, not evidence an independently authenticated global writer fence exists.
- Prior policy-denied runtime paths remain untouched, no production service restarted, no main merge.

**All P0 release gates A/B/C/D/E remain NOT_READY.** The next blocker is independently authenticated global WriterEpoch and enforced fencing on **every** write path, plus full actual Agent-side durable effects and legitimate reconciliation. One successful source-level signed SCP canary does not lift those release guards.
