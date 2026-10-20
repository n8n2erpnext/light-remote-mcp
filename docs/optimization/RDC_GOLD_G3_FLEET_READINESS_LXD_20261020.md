# G3 Gold — Fleet channel freshness versus in-flight dispatch
Date: 2026-10-20 | Branch: `feature/light-remote-gold-rebuild-20261018` | Status: **G3 partial; LXD Linux actual Operator IPC ACCEPTED**

## User objective
Follow `RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md` G3 with Linux Server `light-remote-gold-uat` as an actual test target, not Windows-only. Production `light-remote-direct` and production plugin remain untouched. macOS owner device deferred.

## Root cause and minimal change
- `operator-host/fleet-router.mjs::_state` used `node.inFlight.size>0 || now-lastSeenAt<=channelTtlMs` to mark a leaf `online`.
- An outstanding command does **not** prove that the authenticated device channel is available for a **new** command. After the channel TTL, this caused false `online` and allowed `enqueue` to accept new jobs for an unreachable channel until later timeouts.
- Replace state predicate with bounded freshness of the last authenticated poll / result only; preserve `inFlight` work, result receipts, lease redelivery, queue, owner grants and session model.
- Add `channelFresh`, `dispatchReady`, `readinessReason` to Fleet Router view. `dispatchReady` means **router admission eligible only** (fresh channel and not draining), **not** a proven Agent executor-ready or full end-to-end dispatch/readiness tuple. Later G3 must probe Agent/executor truth separately. Values are derived from existing state; no parallel registry, DB change, JSON snapshot or safety-policy change.
- Expected stale error remains `target_node_offline`; wrong account/device errors and draining remain authoritative. A fresh authorized device poll resumes/redelivers the same in-flight command by lease, never silently discards previous work.

## RED / GREEN on real Linux Server LXD (not only host tests)
- Target: **`light-remote-gold-uat` RUNNING**, Ubuntu ARM64 LXD, IP 10.192.135.61, Node `v22.23.3`, Gold root `/opt/light-remote-gold-uat`.
- Staged fixture and router in **`/tmp/g3-readiness-20261020` inside this container**. Captured RED from the **actual formerly-installed Gold module**: new test expected `offline` after TTL with inFlight, got `online`, assert failed. No device enrollments or production files modified to create the RED.
- Replaced only temporary staged module with proposed source and ran same fixture. GREEN markers: `G3_STALE_INFLIGHT_CHANNEL_NOT_ONLINE`, `G3_STALE_DISPATCH_BLOCKED_NO_QUEUE`, `G3_AUTHENTICATED_REPOLL_REDELIVERY_RECOVERS`, `G3_DRAIN_OWNER_AND_FRESHNESS_GUARDS` all PASS.
- Exact patched module SHA-256 `c78ea161e89e495d2f1f4db587e43bdc58cb492741bb8e77f686e8b9970534f1` on host and in LXD staging.

## Gold live deployment and verification
- **Preflight real Operator IPC:** `GET /v1/fleet` via `/run/light-remote-gold-uat/operator.sock` returned HTTP 200; two outbound nodes, `queued=0`, `inFlight=0`. Gold PostgreSQL/Redis/Operator/Plugin/Wall were 5/5 active.
- Saved pre-G3 router backup **inside isolated LXD** at `/var/backups/light-remote-gold-uat/fleet-router.mjs.pre-g3-20261020`, preserving the original. Gold module only replaced via `install -o gold-uat -g gold-uat`; restarted `light-remote-gold-operator` only, no other Gold services or external production restart.
- Post-deploy real Gold IPC `/v1/fleet` returned HTTP 200 with 2 outbound nodes: `state=online`, `channelFresh=true`, `dispatchReady=true`, `readinessReason=ready`; 5/5 services active; Operator MainPID 33224, `ActiveState=active`, `NRestarts=0`. Live installed router SHA-256 matched staged source (`c78ea161...`). Rollback path remains available.
- Independent read-only real Gold Operator IPC test added: `deploy/scripts/uat-gold-g3-operator-readiness.mjs`, staged and executed **inside this LXD** via `node /tmp/g3-readiness-20261020/deploy/scripts/uat-gold-g3-operator-readiness.mjs`. PASS `G3_GOLD_LXD_OPERATOR_LIVE_IPC` (16 ms measured sample) and `G3_GOLD_LXD_REAL_LEAF_READINESS` (2 real leaves, queued=0, inFlight=0); all 5 Gold services active afterward.
- This real LXD endpoint check proves the new shape is exposed by **the running server** and existing clients reconnected. The stale-heartbeat failure scenario was injected in a **separate real LXD Node fixture**, not by disconnecting actual customer devices.

## Other tests and CI
- `deploy/scripts/selftest-g3-fleet-channel-stale-inflight.mjs` includes stale heartbeat with in-flight, new-dispatch rejection with no queue side effect, same-command lease redelivery on poll, ownership and draining.
- `deploy/scripts/selftest-v08-fleet-router.mjs` updated its old expectation that in-flight work falsely means channel online. Both tests PASS from ARM source. `selftest-v09-fleet-authority`, `selftest-gold-leaf-capability-origin`, `selftest-gold-policy-revision-diagnostics` and `selftest-gold-outbound-exec-capability-parity` PASS.
- Historical `selftest-v08-fleet-execution.mjs` launched from the host initially failed at **executor startup**, due to Gold's required `LIGHT_REMOTE_GOLD_INDEPENDENT=1` + real PG/Redis; it never tested G3. This is an existing standalone fixture/environment mismatch, **not G3 regression PASS/FAIL**. The real Gold Operator IPC check above covers running Linux service compatibility.
- Linux x64/ARM64 CI package smoke now invokes new G3 fixture and updated fleet router tests. Hosted CI pending commit/push confirmation at writing time.

## Boundaries / remaining G3
- **Linux Gold LXD router false-online RED→GREEN + live Gold Operator IPC accepted. G3 NOT CLOSED.**
- Need next: actual Agent executor-unavailable-with-transport-connected readiness, stale/half-open heartbeat probe and reconnect watchdog (channel/Agent/Operator independently), short transport fault/recovery on a disposable Gold node, then controlled resource soak. Do not equate `dispatchReady=true` with end-to-end ability to execute the job.
- Do not cut the owner's Windows or production network. macOS physical later. No production, billing, team, A/B, PostgreSQL/Redis schema, or client installer changes.
- Preserve unrelated pre-existing untracked Gold UAT files and manual backup; never auto-delete.
