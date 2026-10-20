# G3 Gold — In-flight duplex disconnect/reconnect and stale-readiness race

Date: 2026-10-20 | Branch: `feature/light-remote-gold-rebuild-20261018`
Baseline: `83f49f1` (G3 hang-readiness accepted on Gold source; Linux #284, macOS #242, Windows #446 completed SUCCESS).

## Scope and root cause
The next unresolved G3 acceptance was an active command whose Agent executor callback has not settled when the duplex TCP stream drops and reconnects. Heartbeat may be fresh, but Agent is degraded. Operator must never (a) dispatch another command during uncertain execution, (b) replay the same external effect, (c) fabricate completion, or (d) overwrite recent `executorReady=true` with a stale poll snapshot.

Real local HTTP/NDJSON fixture `deploy/scripts/selftest-g3-duplex-reconnect-inflight.mjs` reproduces a held Agent callback, deliberately destroys an open streaming TCP response, then waits for the Agent reconnect and receipt/recovery. The initial source preserved the command and resumed, but **RED** once readiness transition audit was added: `degraded → ready → degraded → ready`. Source trace pinned the stale `false` to `FleetRouter.waitPoll`'s **second** `poll(input)` after an asynchronous wait: it retained the older `authorized.context.touchInput` object even after `onHeartbeat` replaced it with fresh truth.

A premature change to return immediately for every `!dispatchReady` caused a busy command-pump loop and reconnect failure; that change was **reverted** before checkpoint. Do not restore it.

## Minimal correction
- `operator-host/fleet-router.mjs`: `waitPoll(input,waitMs,shouldStop)` supports a lazy provider `()=>latestAuthorizedTouchInput` for duplex only; re-reads input after the wait rather than replaying stale evidence; ignores the post-wait poll if the stream is already closed. Existing long-poll callers still pass plain objects. Add bounded `node_executor_readiness_changed` event only on boolean transition; no command contents and no event on repeated heartbeats.
- `operator-host/device-duplex-session.mjs`: ignore frames after stream closes, pass `()=>closed` into command-pump poll. A replaced stream cannot re-touch Fleet on delayed completion of a pending poll.
- `operator-host/executor-routes-device-channel.mjs`: pass a closure referencing **current** authenticated stream `touchInput` instead of a frozen snapshot.
- `lib/device-duplex-client.mjs`: when previously stalled callback finally settles, publish its *current* Agent heartbeat (where readiness is true) **before** sending the result that unblocks the server command pump. If heartbeat send fails, log a sanitized diagnostic and preserve result delivery; do not mutate policy or claim effect uniqueness.
- New real duplex regression is wired into Linux client x64/arm64, macOS Intel/Apple Silicon, Windows native CI. An isolated Gold-only Operator/Server CI workflow was later added, rather than putting Gold into the legacy Linux Server Bundle workflow; see [Gold G3 CI isolation](./RDC_GOLD_G3_CI_OPERATOR_ISOLATION_20261020.md). No deploy workflow enabled.

## GREEN evidence
1. Source VPS-ARM: **3 consecutive** `selftest-g3-duplex-reconnect-inflight.mjs` passes, each yielding:
   - `G3_TRANSPORT_DROP_RECONNECT_WITH_HELD_EXECUTOR=PASS`
   - `G3_NO_REPLAY_OR_FALSE_FINISH_WHEN_RECONNECT=PASS`
   - `G3_LATE_RESULT_RESUMES_DISPATCH_AFTER_RECONNECT=PASS`
   Test asserts `degraded` and `ready` audit events each occur *once*, and do not include script/payload.
2. Prior G3 hang readiness, executor rejection, half-open receive watchdog, stale channel, and v08/v11 Fleet regressions PASS; no regression to G2 loss of TCP response claimed without separate fixture.
3. Real Ubuntu ARM64 **`light-remote-gold-uat` LXD**, staged path `/tmp/g3-reconnect-race-20261020` (isolated Node TCP server on 127.0.0.1): all 3 new markers PASS. SHA-256 of staged candidate equals source:
   - Client `d8a97308642c36226c936ee1109e878e136f0da43b479ea7babd1c6cc00ffce7`
   - Fleet router `8c8f93d43372d77e46a7ee5b4feadb999eb2d209b61b8fedbcda22c13e5f1be4`
   - Duplex session `b3caabd9d0aa5f1e6c6e92b51131d9ffb0e85af6112bbf916a72a8b6b0e73336`
   Gold Operator real IPC GET /v1/fleet HTTP 200; PostgreSQL17, Redis, Operator, Plugin, Wall units 5/5 active. No service runtime replaced or restarted.
4. Real Gold live /v1/fleet read-only showed 2 outbound leaves with `channelFresh=true`, `dispatchReady=true` and `executorReady=null` (legacy or not reporting self-test). This is **not** proof of executor readiness or full real enrolled-Agent G3 acceptance.
5. Linux Client #285 (x64/arm64) and macOS Client #243 (x64/arm64) completed SUCCESS at source `6b4759a`. Windows #447 was still running at first check. Legacy Linux Server Bundle #310 FAILED from a known installer-source mismatch and legacy audit assumptions; see the linked CI isolation handoff. A new dedicated Gold G3 Operator CI will verify server-side source and artifacts after its next push.

## Boundaries and next steps
- Source/test and LXD staged local fixture only. No production, public plugin/updater, live Gold Operator replacement, installed owner client or enrollment changes.
- G3 **OPEN**: full signed/authenticated real enrolled Agent fault/recovery in disposable Gold UAT, independent Agent executor liveness beyond its self-report; controlled sleep/wake and bounded resource soak. Separate G4 will reconcile unknown external side effects across restarts/operationId leases.
- Preserve unrelated untracked Gold UAT helpers `deploy/gold-uat/`, `deploy/scripts/check-gold-db.mjs`, `deploy/scripts/uat-gold-account-device.mjs`, `deploy/scripts/uat-gold-http-api.mjs`. Mac installed-client E2E remains deferred per owner request.
