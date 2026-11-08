# Gold G3 — Legacy Windows Agent readiness migration and compatibility visibility

Date: 2026-10-20 | Gold branch `feature/light-remote-gold-rebuild-20261018`
Starting HEAD `2baf933`. **G3 remains open** for the physical Owner-approved Agent source upgrade and signed dispatch/reconnect. Production unchanged.

## Root cause identified on the actual authorized Gold Agent
Real Gold Operator running source `a74ec1b` in `light-remote-gold-uat`: two same-account outbound leaves with channels fresh and no queued/in-flight work. One is the actual local Linux Wall, `executorReady=true`. Read-only PostgreSQL `lr_devices` metadata joined to the *existing* authenticated Fleet IDs identified the other leaf as **DESKTOP-VA16D27, Windows x64, Agent version `0.9.0-rc.49`**. The other historical Gold UAT registry test device is offline. No account secrets or device IDs need to be copied into output.

The owner's pre-approved `Light_Remote_Gold` connection provided a governed read-only inspection of this Windows test device, **not** an A/B bypass. Its installed Agent process is:
`%LOCALAPPDATA%\Programs\Light Remote MCP\runtime\node.exe` running `...\agent\device-agent\operator-agent.mjs daemon`.
Observed installed Agent source SHA256 `D0B81354D7ED9FD6F826EA547851BFBBC2804C1A1F9F603F80B3A45998722C5A`, reports VERSION `0.9.0-rc.49`, **no** `agent\lib\executor-readiness-probe.mjs`, and **no** G3 `ExecutorReadinessProbe` symbol in the Agent entrypoint.

**Conclusion:** It is an **older rc.49 binary**. Equal semver text is not proof of equal source or capability. There is no indication of a heartbeat permission failure. Never repair by hot-copying `.mjs` into a running installed Agent or enabling global strict mode first.

## Already available newer candidate
At the exact Gold G3 source SHA `a74ec1b2203da16ed2469f137684246e35a76ff5`, [Windows Tray Client #452](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39439603736) **SUCCESS** (installer build, installed client smoke, independent updater and rollback smoke). Its GitHub Actions artifact is named
`light-remote-windows-x64-a74ec1b2203da16ed2469f137684246e35a76ff5`
(artifact id `12275290032`, available until 2026-11-03, archive digest `sha256:36b96ef832c31ea1b4477d23e3631552490ac69a342f9caf4e085fe90dda004d`).
The Windows job log includes `G3_NATIVE_PROCESS_CANARY_REAL_SPAWN=PASS`, `G3_SIGNED_AGENT_RECONNECT_NEW_PROOF_NO_DUPLICATE=PASS`, `G3_WALL_EXPOSES_STALE_EXECUTOR_EVIDENCE=PASS`. The shared `client/core-files.json` includes `lib/executor-readiness-probe.mjs`; macOS and Linux Desktop client package workflows already run G3 canary tests. **Do not treat build success as proof of a new installed binary on the owner's PC**.

## Fixes in this batch
1. `operator-host/fleet-router.mjs` now distinguishes **admission allowed for legacy compatibility** from **independent readiness proven**. When `requireExecutorReady=false` and Agent's `executorReady` is missing, preserve `dispatchReady=true` for continuity but emit `readinessReason='executor_unknown_compat'` and `executorReadinessProven=false`. Explicit true still reports `ready`; false, stale channel and draining still deny dispatch. When strict mode is enabled, unknown proof still denies new commands. Existing Gold strict admission regression was adjusted, including compatibility evidence.
2. `.github/workflows/windows-native-client.yml` now verifies **real installed files after the per-user installer smoke**: `agent\lib\executor-readiness-probe.mjs` exists, installed Agent imports it, and packaged `runtime\node.exe` parses both modules. It emits `windows-installed-g3-executor-probe=PASS` only after verifying installation contents. This closes the loophole where only build-checkout fixtures pass while the installed runtime is stale or incomplete.
3. Gold source selftests for strict, Fleet, signed duplex and YAML parse have passed on VPS-ARM; hosted CI on this exact change must be checked before shipping.

## Safe next-step migration on this Windows test Agent
1. Confirm a *new* Windows installer artifact passes the **installed G3 module** smoke marker (not only Node source fixture). Verify SHA/artifact origin and independent updater rollback. Make sure Windows test device is idle and the user is aware that the Gold remote session can drop during installation.
2. Install using the intended signed helper/installer/update mechanism only, preserving enrollment and existing keys. Do not alter `%LOCALAPPDATA%` Agent modules by hand. Never infer update completion from `rc.49` alone; inspect installed `agent\lib\executor-readiness-probe.mjs` and actual daemon Local Wall status.
3. Confirm `DESKTOP-VA16D27` reconnects to Gold and reports `executorReady=true`, the other Gold Local Wall stays ready, and no jobs are inflight. Test real signed dispatch and reconnect with the owner-authorized UAT device.
4. Only then enable `OPERATOR_REQUIRE_EXECUTOR_READY=1` on **Gold UAT only** using bounded maintenance, recheck Fleet strict=true, explicit 2/2 and no queued/inflight. If one Agent cannot upgrade, leave compatibility ON or coordinate a documented reversible drain, **never disable it silently**.
5. G3 full acceptance requires runtime restart/reconnect, late-result no duplicate effects, bounded real-service soak and measured RSS/latency, not only two successful handshakes. G4 remains gated.

## What was NOT done
No Windows installer was downloaded/installed or updater launched on the owner machine; current Gold Agent on Windows remains rc.49 with no G3 probe. No account/session/keys changed, no A/B and safety bypass, no production deploy, no source hot-reload on running Gold Operator. Source branch improvements require a future controlled Gold UAT code cutover to appear in live Fleet output; running Operator remains pinned to `a74ec1b`.

Use [current handoff](./RDC_HANDOFF_CURRENT.md) for exact latest commit and hosted CI status.


## Hosted CI following visibility/install-source gate patch
- Source [`eca1f98e8be492c34da407dc938fd084f6fb2873`](https://github.com/n8n2erpnext/light-remote-mcp/commit/eca1f98e8be492c34da407dc938fd084f6fb2873): [Gold G3 Operator Regression #13](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39450315399) **6/6 SUCCESS** (both server bundles, source contract, real Agent lifecycle, synthetic enrolled-CLI fixture and bounded soak).
- [Windows Tray Client #453](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39450315433): **SUCCESS** on source `eca1f98e8be492c34da407dc938fd084f6fb2873`. Read full native job log (job `118723071259`): `windows-installed-g3-executor-probe=PASS` and `windows-native-installed-selftest=PASS` are **actual test outputs after installation**, not merely echoed command text. Installer build, updater recovery and rollback smoke also SUCCESS. The resulting artifact is `light-remote-windows-x64-eca1f98e8be492c34da407dc938fd084f6fb2873`, artifact ID `12277742496`, archive SHA-256 `655bc0e891e5a9b7b435f64bb9f04dc85c47b41719fc81890bf8a9c18a03add0` (328,181,397 bytes). Open the CI run's Artifacts section using the authenticated GitHub account to retrieve it; **the archive digest is not the individual installer digest**. Artifact upload SUCCESS. The owner Windows device was **not** upgraded in this session; its active Gold plugin remote session should be expected to disconnect briefly during any future installation.
