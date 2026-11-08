# Gold M6 — Signed per-device CPU/RAM/I/O telemetry (2026-10-22)

## Owner directive and scope

Continue M6 after `13f48ed`. Owner paused physical Pro 3+1 and Pro Team/multi-user tests until real devices and participants are prepared. **Do not resume Team/3+1 tests.** This slice modifies only Gold feature-branch source + CI and handoff; no installed Gold UAT/production deployment, billing, A/B grants or PostgreSQL migrations.

## Architecture implemented

- New `lib/device-resource-telemetry.mjs` `DeviceResourceSampler` collects bounded process-local measurements using Node OS/process APIs once per signed outbound Device heartbeat:
  * **Host:** CPU utilization percentage from delta of OS `os.cpus().times`; RAM used and total from `os.totalmem()/freemem()`.
  * **Light Remote Agent process ONLY:** CPU utilization (per one logical core, clamped 0–100%), RSS, filesystem `fsRead/fsWrite` **operation counts per sample interval** from `process.resourceUsage()`, not whole-host disk throughput.
  * **Linux Agent process ONLY (when present):** actual disk read/write bytes delta from `/proc/self/io`; unsupported OS or unavailable counters are NULL, never invented zero.
  * First/too-short measurement interval gives unknown delta metrics, no fabricated CPU/I/O.
- Telemetry attaches to already signed **duplex heartbeat / poll / pulse** envelopes as `resourceSample`, and to no new unauthenticated endpoint. `Operator` binds samples to `ctx.binding.accountId + ctx.device.deviceId` AFTER signed enrollment/channel verification; payload cannot choose its account/device identity.
- `DeviceResourceSampleCache` is bounded, strictly range/age validated, max 250 identities, ephemeral observation cache; never substitutes for canonical PostgreSQL17/Redis8 state. Samples age out of live display at 90 seconds; after Operator restart status correctly resets to `UNKNOWN` rather than treating stale values as live. No raw command, environment, path, network address or secret leaves the device.
- Existing Fleet authority and main-device signed `fleet-jobs` API return telemetry **only for owner-enrolled/nonrevoked devices**. Each device's `metricsState` is `fresh|stale|unknown`; stale metrics fields are withheld from GUI (last-seen time retained). The Fleet Wall `/jobs` table adds Host CPU%, Host RAM used/total, Agent CPU%/RSS, Agent I/O read/write operations per collection window and sample health. Labels explicitly prevent confusing Agent-only I/O with device-wide disk I/O. Existing lease warnings and `UNKNOWN` never release a worker claim.
- New module included in signed cross-platform client manifest `client/core-files.json`, so Windows/macOS/Linux Agent packaging can resolve it.

## Verification

- `node --check` touched JS modules, `git diff --check` PASS.
- `node deploy/scripts/selftest-gold-m6-device-telemetry.mjs` PASS:
  1. Host vs Agent measurement semantics and per-window CPU/I/O deltas.
  2. Signed per-account/device cache scoping; stale after 90 seconds, rejected future/invalid samples.
  3. All three signed transport integration anchors and Core Client package manifest.
  4. Fleet Wall browser JavaScript parsing, scope labeling and stale status UI.
- On real VPS-ARM OS, `DeviceResourceSampler` returned non-null host CPU%, memory, Agent CPU/RSS and safe I/O counters after a measured 1202ms window. This only demonstrates the sampler, **not** full Gold UAT signed transport or browser acceptance.
- Regression suites `selftest-gold-fleet-jobs-m6.mjs`, `selftest-gold-m6-resource-metrics.mjs`, `selftest-gold-m6-native-terminal-spool.mjs`, and signed Fleet component tests PASS.
- Gold G3 Operator GitHub workflow includes new telemetry test. Post-push CI status needs explicit verification; do not claim CI green without receipt.

## Remaining gates

1. Deploy matched new Gold Agent + Operator candidate on Gold UAT with backup/rollback, then verify signed telemetry on two genuinely enrolled devices and Owner Fleet Wall in real browser. No Team/3+1 concurrency tests until owner says ready.
2. Windows/macOS native host telemetry requires actual runtime observation. RAM/CPU APIs are cross-platform, but Linux-specific disk-byte counters deliberately display unsupported rather than lying.
3. If full **host-wide** disk/network I/O (rather than Agent process I/O) is desired, implement separate platform-verified collectors with exact privileges, counters and timing; don't relabel process operations as host-wide throughput.
4. No automatic release of `UNKNOWN`/stale resource claims. Supervisor terminal receipt ACK/replay migration 035 remains unapplied pending controlled UAT cutover.

Rollback: revert this source commit; no DB schema/state changes in this slice.

Links: `docs/optimization/RDC_GOLD_M6_DURABLE_TERMINAL_ACK_REPLAY_20261022.md`, `docs/optimization/RDC_GOLD_M6_NATIVE_TERMINAL_REPLAY_20261022.md`, `docs/optimization/RDC_HANDOFF_CURRENT.md`.
