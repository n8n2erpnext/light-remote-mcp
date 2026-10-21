# GOLD G3 — 2026-10-21 physical Duplex live RCA / compatibility readiness patch

Branch: `feature/light-remote-gold-rebuild-20261018`.
Starting local HEAD: `baca9c0934c83048d03cbfd35b29b2a5a7dfc793` (ahead of origin by 1 before this checkpoint).
Isolated Gold LXD installed source: `15eed24fa400feccfb6156df7959c78a8aa437af`. Do **not** conflate source checkout with installed runtime.
Production `light-remote-direct`, billing, site and clients NOT changed.

## Verified physical Windows and Gold runtime baseline

- Existing official VPS-ARM and Gold Windows pairing resumed normally, no A/B bypass. Gold Windows test Agent is installed CI Windows #453 with independent Executor probe; no re-install or process restart performed here.
- Gold UAT PostgreSQL 17, Redis 8, Operator, Plugin, Wall **5/5 active**. Fleet **2/2 outbound fresh, 2/2 explicit ExecutorReady=true**, zero queued/inFlight at baseline. An authorized Gold session counted as **1 active**, so strict maintenance preflight cannot PASS until closed. Strict remains **OFF**.
- Earlier ordinary Gold remote execution PASS is **signed HTTP poll transport**, not persistent TCP Duplex acceptance. Source `device-agent/operator-agent.mjs::ensureDeviceDuplex` is only called upon `desktop live-open`; routine `exec` never forces Duplex.
- A single **read-only Gold Windows RM V2 live-open** with `windows-uia` limited depth/nodes was admitted and returned an actual `DeviceDuplexClient`: `active=true`, `ready=false`, `connects=1`, `lastReadyAt=0`, `bytesReceived=0`, `transport=semantic-push-cache`. This is a fallback (not successful Duplex). The live lane was closed cleanly by official `light_remote_desktop_live_close`, no mouse/keyboard events.
- Windows installed `logs/agent.log` (sanitized error-code extraction only) contains **four** `device_duplex_connection_lost` with `device_duplex_ready_timeout`, one `device_duplex_frame_failed:device_duplex_not_ready`, one `device_duplex_idle_closed`. Gold Operator's last 240 activity events, including eight ordinary queued/dispatched/completed jobs, contained **0 `device_duplex_opened` events**. This is strong evidence handshake not accepted/acknowledged by installed Operator.
- Read source confirms signed live Duplex uses indefinite POST NDJSON `/device-channel/stream` via Gold plugin `plugin-server/device-public.mjs` -> `plugin-server/operator-client.mjs::proxyOperatorDuplex` -> `/v1/device-channel/stream` (Operator Unix IPC) and waits ~10s for `hello-ack`; the client request remains open after hello because Duplex needs bidirectional streaming. At this earlier checkpoint the buffering location was not yet isolated. Subsequent live acceptance pinpointed Gold Preview Nginx request buffering; see [the validated correction](./RDC_GOLD_G3_NGINX_DUPLEX_PHYSICAL_RECONNECT_20261021.md).

## Actual RED -> GREEN source change

**Bug 1 (Fleet readiness, reproduced RED):** In compatibility mode `FleetRouter.touch()` preserved prior `executorReady=true` if the next authenticated hello/heartbeat/poll omitted Executor readiness, so a downgraded legacy Agent could still appear *proven ready* without current independent evidence. Regression `G3_COMPAT_FRAME_WITHOUT_PROBE_REVOKES_OLD_PROOF` RED with `true !== null` (exit 1), then GREEN after `fleet-router.mjs` change: missing field ALWAYS becomes `null`. Legacy compatibility may still route if no other denial; `executorReadinessProven=false` and `readinessReason=executor_unknown_compat`, strict mode rejects. Do not hot-copy patch into running Operator; immutable Gold-only promotion with backup is required later.

**Change 2 (diagnostic only):** `lib/device-duplex-client.mjs` now keeps bounded safe `lastConnectionErrorCode`, `lastConnectionErrorAt`, and `readyTimeouts` counters in its existing `status()` view; redacts arbitrary raw error details to `transport_error` or a stable code. This closes the observability gap where live-open fallback showed `ready=false` without a usable failure code. No retry policy, protocol, signed envelope, capability, or fallback behavior changed.

**New deterministic fixture:** `deploy/scripts/selftest-g3-duplex-ready-timeout-diagnostic.mjs` creates a localhost intermediary that consumes the streaming hello but deliberately withholds reply; the client must report `device_duplex_ready_timeout` and `readyTimeouts>=1`. It is a loopback fixture, **not proof of which ingress component buffered the request**. PASS on VPS-ARM. Wired to Gold Operator CI, Windows CI, macOS CI and Linux Desktop CI with path triggers where needed.

## Targeted checks achieved

- VPS-ARM `selftest-g3-strict-executor-admission.mjs`: **7/7** markers PASS including new RED->GREEN downgraded-probe scenario.
- VPS-ARM `selftest-g3-live-readiness-evidence.mjs`: **10/10** markers PASS (prior checkpoint).
- VPS-ARM `selftest-g3-duplex-reconnect-inflight.mjs`: **3/3** markers PASS; `selftest-g3-signed-enrollment-executor-duplex.mjs`: **6/6** markers PASS (source fixtures, not physical live).
- VPS-ARM `selftest-g3-duplex-ready-timeout-diagnostic.mjs`: **1/1** PASS with actual local TCP.
- `node --check` and `git diff --check`: PASS.
- No Gold LXD service cutover in this checkpoint, **no physical TCP reconnect acceptance**, no strict feature flip, no claimed p50/p95 or sustained RSS soak.

## Next actions in strict order

1. Keep physical Windows #453 / Gold Operator as they are. Diagnose **Gold public Duplex transport** along the deployed NetBird / Traefik / Nginx Gold Preview / Plugin / Operator IPC route. Read-only observations were followed by a Gold-only Nginx request-buffering correction and physical acceptance: [validated source and live runbook](./RDC_GOLD_G3_NGINX_DUPLEX_PHYSICAL_RECONNECT_20261021.md). This earlier RCA remains an evidence snapshot, not an instruction to introduce a new edge provider. Never expose enrollment keys or change production routing.
2. After causal proof, implement smallest production-compatible transport remedy (evaluate WebSocket bidirectional framing or signed split-channel/SSE if streaming POST truly buffered) with interoperable Windows/macOS/Linux Agent and server regression, and stage immutable Gold candidate under protected backup/rollback.
3. Owner-authorized **real live Duplex hello/ack**, fresh signed proof/nonces, physical fault/reconnect and late receipt with no duplicate effects, measured N/p50/p95 and RSS. Only then Gold-only strict admission `OPERATOR_REQUIRE_EXECUTOR_READY=1` zero-active-work and 10-sample health/rollback. G3 stays IN PROGRESS until these pass, G4 not open.
4. Preserve four unrelated preexisting untracked UAT paths. Master Plan and earlier CI fixtures remain historical; don't re-run all G2 suites or replace Windows #453 just for diagnostics. New source is not the installed binary.

Code paths: `operator-host/fleet-router.mjs`, `lib/device-duplex-client.mjs`, `deploy/scripts/selftest-g3-strict-executor-admission.mjs`, `deploy/scripts/selftest-g3-duplex-ready-timeout-diagnostic.mjs`, four CI workflows, Current/Master Handoff.
