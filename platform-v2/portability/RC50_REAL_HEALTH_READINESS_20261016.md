# rc50 real Operator + Plugin: separate liveness from readiness

**Date:** 2026-10-16 Asia/Ho_Chi_Minh
**Branch:** `feature/rc50-mjs-scale-20261011` (development only)
**Parent:** `01d62a7bf682088812e9ed54d4e387837f5e378d`
**Scope:** Real Operator Unix socket and Plugin Express HTTP servers running with disposable identities/state, no production process restart.

## Why this runtime change was necessary

Before this fix, the real Operator and Plugin exposed a single GET `/healthz` that intentionally continued returning HTTP **200, `ok:true`** during local freeze, as a liveness endpoint useful for post-failure diagnosis. With the prior real audit append failure fix, Operator could be `freezing`, `sealFailed:true`, rejecting new mutations with 503, yet the same /healthz returned 200. A load balancer, monitoring exporter or orchestration readiness probe configured against `/healthz` would incorrectly report the process READY to accept new work. Nothing about the existing `/healthz` response proves local admission or global writer authority.

## New actual product endpoints, not mock service

- `GET /healthz` **unchanged**: HTTP 200 if process alive, including when local freeze is active or audit append fails. Its `localFreeze` field is diagnostic, not an acceptance signal.
- **NEW `GET /readyz`** on both actual `operator-host/executor.mjs` (Unix HTTP) and `plugin-server/server.mjs` (Express host-validated HTTP). Responds HTTP **200** with `{ok:true,ready:true,service,localFreeze}` when `localFreezeGate.accepting===true`, or HTTP **503** with `ok:false,ready:false` while `freezing`/`frozen` or after an audit seal error. For Operator readiness responses, Cache-Control=no-store is explicit; Plugin already sets no-store in its non-indexable route policy.
- Only an exact `GET /readyz`, like exact `GET /healthz`, can bypass freeze middleware to expose the **read-only** diagnostic state. Other methods/paths are not allowed through; every other request still fails HTTP 503 when local admission is closed. Readiness does not increment work counters or mutate state.
- Plugin status stays subject to the existing MCP SDK host-header validation, with no security bypass. No change to OAuth, owner consent, signing or Client A/B pairing.
- This is a **local readiness definition**, not a global multi-host writer-fence attestation, nor a guarantee that PostgreSQL/Redis or Agent is healthy. It is not an authorization API. Do not configure a global cutover based only on this endpoint.

## Tests against actual spawned child processes

Updated the existing REAL process smoke tests (not mock router):
- `operator-runtime-smoke.test.mjs`: GET /readyz 200 before freeze, 503 after SIGUSR2 freeze while GET /healthz stays 200; new work remains 503, durable marker blocks startup.
- `plugin-runtime-smoke.test.mjs`: exactly the same for actual Express Plugin, plus Paddle webhook 503 during freeze.
- `operator-audit-failure-runtime.test.mjs`: real EISDIR audit fsync fault drives the actual Operator into `freezing`/`sealFailed`; readiness returns 503 with `ready:false` and `sealFailed:true` while liveness returns 200 and fresh mutator requests 503.
- Added `test_p0_release_gate.py` negative source coverage requiring both liveness/readiness routes and real runtime test evidence, while still requiring hard P0 release NOT_READY.

## Remaining P0 blockers

This improves **operational observability and local fail-closed routing only**. It does not make a local process globally authoritative or solve:
- P0-A: authenticated monotonic global writer epoch and remote Agent/PTY/Fleet fencing (prior adapter creation safety-blocked).
- P0-B: authenticated owner A/B → verifier/issuer → Agent end-to-end.
- P0-C: 2/18 registry fsync still unproven, no global consistent PG/Redis/JSON/audit/outbox checkpoint.
- P0-D: no real source-fenced ARM → HOMELAB full-state restore and rollback (prior tool block).
- P0-E: no actual production-like multi-service release/cutover/rollback and signed artifact acceptance.

No user data or production services are changed. Both `/healthz` and `/readyz` are process-local; their presence cannot justify a release claim. The hard release guard must remain `NOT_READY` (exit code 3 when `--require-ready` is requested).
