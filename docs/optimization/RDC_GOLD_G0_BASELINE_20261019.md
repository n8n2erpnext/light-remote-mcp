# Gold G0 read-only baseline and reproducibility log — 2026-10-19
Classification: **READ-ONLY IDLE SAMPLE, NOT A STRESS OR RDC COMPARATIVE BENCHMARK**.
- Branch `feature/light-remote-gold-rebuild-20261018`, baseline Git HEAD `4daccb821adbac38be4b6e954ab5f10d266ccdbe`.
- VPS-ARM owner-authorized session via official **Light Remote**, Gold isolated LXD `light-remote-gold-uat`. Production untouched.
- Source pins RDC `f508e524` (2026-10-14), Light Remote `4daccb8`.
- Pre-existing untracked fixtures intentionally left unchanged: `deploy/gold-uat/`, `deploy/scripts/check-gold-db.mjs`, `deploy/scripts/uat-gold-account-device.mjs`, `deploy/scripts/uat-gold-http-api.mjs`.

## Repeatable read-only measurements
Command from VPS-ARM, six **sequential** requests (not a load test):
```bash
for n in 1 2 3 4 5 6; do
  curl --max-time 8 -sS -o /dev/null -w '%{http_code} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}\n' \
    https://gold.light-remote.thaiduy.digital/account
done
```
Observed total seconds: `0.059497, 0.042663, 0.041652, 0.045748, 0.046251, 0.045374`; all HTTP **200**; observed range **41.652–59.497 ms** (including TLS). Measured from **VPS itself**, not representative end-user/network p95. The sample is too small for statistically meaningful p95; do NOT market it as an SLO.

Single `ps` RSS snapshot inside Gold LXD (KiB; exact point-in-time, not peak):
| Service / process | RSS KiB | Approx MiB |
|---|---:|---:|
| Gold Plugin Node | 111844 | 109.2 |
| Gold Operator Node | 86476 | 84.4 |
| Gold Wall Node | 85380 | 83.4 |
| Redis server | 19544 | 19.1 |

Gold service state during sampling: PostgreSQL, Redis, Operator, Plugin, Wall **active**. Local NetBird Wall `http://100.94.184.141:5591/` returned HTTP **303** (login); production `https://light-remote.thaiduy.digital/` returned HTTP **200**. No production mutation.

## Mechanism inventory verified from GitHub (NOT from performance test)
- Light Remote `lib/native-process.mjs` and `lib/native-terminal.mjs`: ByteRing default 4 MiB, max 16 MiB; explicit `baseOffset` and truncation gap; per-run input bounded. Existing memory mechanism **PRESERVE**, not redesign.
- RDC `src/terminal-manager.ts`: 50 MiB output cap, 1 MiB line split, 2 MiB initial wait limit and process-state wait ceiling; different operating constraints, **not** a Light Remote target.
- LR `lib/native-fs.mjs`: expected-replacements edit already implemented.
- LR `lib/light-scp-file.mjs`: transfer status with actual `progressBytes/totalBytes`; SCP Progress issue is mostly visibility and trust-boundary data flow to Wall, not missing byte counting.
- LR `device-agent/local-wall.mjs`: EventSource `/events`, job render/batching already present; need trace SCP transfer ownership and event propagation.
- RDC `src/remote-device/remote-channel.ts`: transient retry/backoff, stale heartbeat and unready join safeguards. Do not copy times without tests.
- LR tool registration baseline: 66 `add(server,'light_remote_` lines in `plugin-server/tools.mjs`; some are consolidated tool families, so this is **a source count not live plugin tool list**.

## Previously observed incidents carried forward, not re-tested G0
- Official Light Remote read-only shell inspection was refused before a remote job (platform gate); no workaround attempted.
- Official explicit `requiredCapabilities=['docker']` read-only exec returned `target_node_capability_missing`, while an ordinary Docker read exited 0.
- Gold `list_devices` capability-empty vs `inspect_device` nonempty was patched and tested in earlier checkpoint `4daccb8`; only formal admission remains.
- Gold SCP hash compatibility source regressions passed, but full upload/commit still blocked by `operator_public_key_unavailable` in earlier test; do not infer native transfer integrity status from just the source unit tests.

## G1 baseline measurement contract
For each *authorized, benign* test case, record:
`case_id, timestamp, client/plugin version, tool name, schema/annotations, declared requiredCapabilities, device capability advertisement, trace/operation ID if assigned, layer [pre_dispatch|oauth|pairing|operator|fleet|agent|os], remote job-created?, result status/code, elapsed_ms, retry_count, state-after-restart`.
Avoid secrets, raw commands when sensitive, paths outside allowed roots and full stdout in reports. Record an unsupported or prohibited test as SKIPPED/BLOCKED, not a tool failure. Re-test same cases on official RDC and Gold only when each side is authorized. A private platform checker is not instrumentable from the Light Remote repository.

## Safe synthetic load plan for G6, NOT run in G0
Resource-capped LXD/CI fixtures: controlled output (normal and no-newline), 2–20 concurrent bounded jobs, delayed readers, cancellation, reconnect and Wall event loads. Record peak RSS, heap, retained output, 99th read latency, event gap metadata and disk queue size. Only rework ByteRing on a proven limit breach.
