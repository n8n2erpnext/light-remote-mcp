# Light Remote Gold — G3 strict ON, physical Windows, bounded soak (2026-10-21)

## Exact scope and durable state

Branch `feature/light-remote-gold-rebuild-20261018`, Gold LXD `light-remote-gold-uat` ONLY. Immutable **installed** Operator/Plugin/Wall source is `84fb09be3460ed3e46681c3322460a57457e2c83` (Gold A/B observer-429 decoupling). Host worktree preceding this handoff HEAD `3ea34f0d4a21950b7937f45dabc76c25a69c59a6`. Production `light-remote-direct`, production Local Wall, Cloudflare, NetBird and non-Gold reverse proxies remain unchanged. Existing R2 release sync not touched.

**Current deployed Gold strict admission is ON:** `OPERATOR_REQUIRE_EXECUTOR_READY=1` set only by
`/etc/systemd/system/light-remote-gold-operator.service.d/95-g3-strict-admission.conf` inside isolated Gold LXD. Exact code SHA unchanged, only Gold systemd override changed. Source-controlled deployment/rollback script `deploy/scripts/gold-g3-uat-strict-admission.sh` introduced in this checkpoint.

## Real owner A/B acceptance after source 84fb09b cutover

Owner supplied a fresh one-time Gold A and approved B from the same Local Wall. Gold helper returned `ready`; returned session was held, then later both official and Gold durable sessions were successfully resumed. Read-only Gold Operator activity ring had `device_pairing_a_redeemed` + `device_access_requested` at `2026-10-21T04:04:14Z`, `device_access_approved` + `device_access_closed` at `2026-10-21T04:04:29Z`, and `agent_client_device_bound` events. These match the owner's fresh approval after installing 84fb09b. **Real owner A/B authorization and connected helper: PASS.** The special stress state `observer=429` at exactly the moment of real owner approval was **not** injected; that particular isolation case remains proven by real Redis synthetic-key tests and loopback Wall B approval fixture only. Never reuse/record the one-time codes.

## Real physical Windows benchmark before strict

Authorized enrolled Gold Windows Agent `DESKTOP-VA16D27` (installed build #453), 8 sequential, independent, bounded read-only PowerShell jobs through actual Gold plugin. All 8 tool jobs `state=ok,exitCode=0`. End-to-end tool request wall-clock ms: `[2485,2308,2424,2504,2495,2230,2225,2244]`. Nearest-rank **p50=2308 ms, p95=2504 ms**, min 2225, max 2504, **N=8**. These are request-to-tool-return latencies, not wire-only Duplex latency and not load/capacity p95 predictions.

One matched Node Agent process had RSS/private/handles:
- Before the eight jobs: **46.69 MB / 71.86 MB / 282 handles**
- Immediately after: **53.71 MB / 77.97 MB / 282 handles**
- Later cooldown, after real strict command: **53.82 MB / 77.44 MB / 282 handles**.
No orphan Agent process observed and handle count unchanged. There is a ~7 MB RSS increase, but three samples and eight calls cannot prove or disprove a sustained memory leak. Do not claim steady-state or stress-load memory acceptance.

## Bounded Gold G3 real TCP fixture soak

Initial `node deploy/scripts/soak-g3-duplex-readiness.mjs --cycles 4` failed cycle 1 in source fixture `selftest-g3-executor-hang-readiness.mjs`: it expected `false` after receiving a **fresh heartbeat without readiness proof**; newer FleetRouter correctly downgrades readiness to **`null`**. This was stale **test expectation**, not a production regression. Updated source fixture to explicitly use `requireExecutorReady:true` and expect `executorReady===null` while asserting strict non-dispatchability; targeted strict/late-result fixtures PASS.

Reran bounded soak: **12/12 processes PASS**, 4 cycles x (Duplex reconnect with in-flight command; hung Executor/readiness and late receipt; half-open stream watchdog), total **83,122 ms** on VPS-ARM Linux arm64 / Node 22.23.1. Source `localhost TCP` with **real** FleetRouter and Duplex client child processes but **NOT the enrolled Windows Agent**. Test duration p50/p95 and sampled child RSS:
- reconnect: 6226/6274 ms, sampled max RSS **64,624 KiB**, 309 RSS samples;
- hung Executor: 6334/6338 ms, sampled max RSS **58,860 KiB**, 312 samples;
- half-open: 8192/8253 ms, sampled max RSS **57,368 KiB**, 406 samples.
12 child processes ended; source fixture soak cannot establish physical installed-Windows in-flight Duplex receipt semantics.

## Gold-only strict switch with fail-safe

Preflight after closing ONLY our own Gold Windows and Gold UAT sessions: 2/2 outbound leaves channelFresh=true + executorReady=true, 0 active sessions, 0 queued, 0 in-flight; Gold strict OFF. Script has exact hostname `light-remote-gold-uat`, opt-in `G3_GOLD_STRICT_OPT_IN=1`, immutable source SHA matching installed Operator command, backup and validate, Gold-only 3-service ordered restart, 10-consecutive-sample health test and automatic rollback of strict drop-in on failure. Script syntax + strict/source regressions PASS before execution.

Executed inside isolated Gold LXD, output:
- `G3_STRICT_PREFLIGHT_TWO_READY_NO_WORK=PASS`
- `G3_STRICT_UNIT_BACKUP_VERIFIED=PASS`
- `G3_GOLD_STRICT_ADMISSION_ENABLED=PASS`
- `G3_GOLD_STRICT_STABLE_10_SAMPLES=PASS`
- `G3_GOLD_STRICT_SOURCE_SHA=84fb09be3460ed3e46681c3322460a57457e2c83`.

Protected pre-strict backup within Gold: `/var/backups/light-remote-gold-uat/pre-strict-84fb09be3460ed3e46681c3322460a57457e2c83`. Prior code, PostgreSQL and config rollback backup from the earlier immutable Gold candidate cutover also retained. To **rollback just strict** if later policy incompatibility: remove ONLY `95-g3-strict-admission.conf` inside Gold LXD, `systemctl daemon-reload`, restart **only** Gold Operator then Plugin then Wall in dependency order, verify 10-sample fleet strict OFF and 5 active services. No production actions required.

Actual post-switch state: PostgreSQL/Redis/Operator/Plugin/Wall **5/5 active**, Fleet 2/2 fresh+ready, `requireExecutorReady=true`, zero queued/inFlight/active immediately after restart. Gold and production public HTTPS returned 200. Then:
- Authorized *real physical Windows* Gold `light_remote_exec`: marker `G3_GOLD_STRICT_WINDOWS_REAL_EXECUTOR_PASS`, correct hostname, exitCode 0. **Real healthy strict dispatch PASS.**
- Authorized *real physical Windows* Gold `light_remote_desktop_live_open` read-only: `transport=device-duplex-v1`, `duplex.active=true`, `duplex.ready=true`, `connects=1`, `reconnects=0`. Closed with Gold `light_remote_desktop_live_close`; related Gold Windows plugin session closed too. **Real Duplex handshake remains usable under strict ON.**
- Offline/unknown/false readiness strict rejection was checked by existing G3 FleetRouter deterministic fixtures, not by degrading a real user's Agent. This remains a deliberate safety distinction.
- Full *in-flight Duplex command with physical stream failure and late receipt* has NOT been independently tied to `deviceTransport=duplex-v1` at real installed Windows. Earlier physical read-only command across Gold Nginx restart observed one job queued/dispatched/completed and no redelivery but did not confirm shell command transport was Duplex. Do not mark this as physical exactly-once proof.

## Next

1. Read final Gold fleet once and ensure strict still ON and healthy. Do not restart other devices or production.
2. Perform real installed-Windows **Duplex-transport-bound command receipt/late-ack** proof if feasible using only authorized read-only work and without rerouting a rejected tool operation; confirm actual transport field. May remain an explicit unproven gate if current job telemetry cannot distinguish Duplex vs signed poll.
3. Incremental physical Windows memory/latency soak with larger N if needed for meaningful sustained stability, not a flood. Record limits clearly.
4. G3 should remain **IN PROGRESS** while that specific physical exactly-once/receipt gate is open; **G4 not started**.
5. Four inherited untracked `deploy/gold-uat/` and three UAT scripts must remain untouched/untracked, not staged.
