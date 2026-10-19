# Light Remote Gold — G1 outbound exec capability parity checkpoint
Date: 2026-10-19 | Branch: `feature/light-remote-gold-rebuild-20261018`
Prior HEAD: `8d468606f663dc3e99774c8f081687a1ab21538c`
**State: G1 IN PROGRESS; G2–G6 NOT STARTED; production untouched.**

## Grounded bug
In `operator-host/executor.mjs:startJob()`, for **local** jobs Operator merges declared `requiredCapabilities` with `HOST_PLATFORM_ADAPTER.inferRequiredCapabilities(script)`. For an **outbound remote Agent**, Operator formerly checked *only* declared capabilities (by default `filesystem`) and would create/charge a job even though `device-agent/operator-agent.mjs:executeLeafCommand` independently infers `docker`, `lxd`, `sudo-on-demand`, etc. and can refuse the job later with `local capability denied`. This is a source-proven inconsistency in **when** admission fails and how it is attributed, not proof that OpenAI's pre-dispatch checker treats one MCP better.

## Minimal patch (Gold only)
- New `operator-host/outbound-exec-capabilities.mjs`: pure, side-effect-free helper for `linux`, `darwin`, `win32`, explicitly constructing the **existing shared platform adapter** with `commandExists:()=>false`. It never scans executable paths, runs shell, introspects host OS, auto-grants a capability or substitutes a different device. It computes the **union** of the caller's declared caps with the existing Agent inference rules for that *target device platform*.
- Operator `startJob` invokes the helper only **after** `targetRoute(...)` validates session/account/device and supplies authoritative target platform; it then runs the **existing** Fleet enrollment+Agent advertised intersection check before creating a doomed job. Local host path remains unchanged. Unknown platforms remain declared-only, leaving the Agent local final deny authoritative.
- Crucial: this patch does **not** change OpenAI pre-dispatch checks, OAuth, A/B, signed Agent policy, local final deny or hard-deny rules. Existing Agent versions may infer differently; actual multi-client compatibility requires real Gold MCP E2E before release.

## Regression evidence
- `deploy/scripts/selftest-gold-outbound-exec-capability-parity.mjs`: **13** Linux/macOS/Windows cases compare Operator helper to the actual Agent adapter's `inferRequiredCapabilities`. Cases include Docker, LXD, systemd, `sudo`, Git, Windows cmd vs PowerShell, Get-Service/Get-Process, Homebrew absolute Docker path, simple `printf`, unknown-platform safe fallback, and deny-vs-allow Fleet intersection. PASS.
- `selftest-gold-policy-revision-diagnostics.mjs`: PASS.
- `selftest-gold-leaf-capability-origin.mjs`: PASS.
- `selftest-gold-plugin-tool-contract.mjs`: **80 tool** contracts PASS.
- `selftest-v08-fleet-router.mjs`: PASS.
- A legacy `selftest-v08-fleet-execution.mjs` **did not execute tests** because its IPC fixture requires a Gold independent-mode environment (`gold_independent_mode_required`). Marked **BLOCKED_BY_TEST_ENV**, not a regression failure or E2E success. Do not point it at the canonical Gold database without proving fixture isolation.
- A later combined legacy Agent-test script timed out (**exit 124**) while running `selftest-v09-agent-policy-sync.mjs`. It produced no PASS marker and briefly coincided with `target_node_draining` on the official device. Normal session/inspect later confirmed device `online`, `draining=false`; no test outcome claimed. **Do not endlessly rerun** it.
- After recovery, targeted 13-case parity, leaf provenance and JS syntax checks re-ran PASS.

## Additional real false-positive discovered (OPEN)
Existing Linux Agent regex **over-approximates** `sudo -n systemctl is-active docker` as requiring **both** `systemctl` and `docker`, although `docker` here is a unit-name argument, not a Docker command. Existing Agent policy and new Operator preflight therefore agree, but their common decision can be overly strict. The fixture **documents the behavior**, does not pretend it is fixed.
**Do not weaken/remove the Docker requirement with a simplistic regex negative match:** shell separators, nested commands, wrappers, substitution and arguments can change actual semantics. A future G1 parser/command-position-aware fix requires comprehensive negative/positive adversarial tests, preservation of local final deny, and per-platform compatibility review before patch or release. This is directly relevant to the user's "false permission/safety block" objective; it must be addressed separately from diagnosing which layer refused.

## Actual Gold deployment (not an MCP end-to-end job)
Pushed only `operator-host/executor.mjs` and `operator-host/outbound-exec-capabilities.mjs` to isolated LXD `light-remote-gold-uat`, preserved unprivileged app ownership, `node --check` both, restarted only Gold Operator.
- `Gold /account`: HTTP 200; Gold OAuth discovery: HTTP 200; Gold NetBird Wall: 303 login.
- Gold PostgreSQL, Redis, Operator, Plugin, Wall: **5/5 active**.
- Production HTTPS: HTTP 200; **production unchanged**.
- Gold real MCP outbound command E2E: **BLOCKED**, previously identified `operator_public_key_unavailable`, configuration provisioning denied by upstream platform gate. No new key material or key-path workaround attempted.

## Next G1 decision gate
1. Improve **inference precision** only when tests establish both accuracy and no capability bypass; start with literal command-name-vs-service-argument over-match, but no naive regex patch.
2. Independently authorized Gold-only envelope configuration remains prerequisite to real MCP admission; do not retry a previously refused key write via another tool/PTy.
3. After Gold E2E restored, compare actual remote job count, result codes, and authorized capability denial from the exact same benign Docker/LXD/systemctl workloads. Distinguish pre-dispatch, Operator, Fleet, Agent and OS layers; no preemptive general retry on mutation.
4. Continue G1 only. G5 SCP progress on Wall is still planned and unchanged.

## Rollback
Restore the two Operator files from prior Gold checkpoint `8d46860`, restart only Gold Operator. No database migrations or privilege changes. Preserve existing untracked UAT fixtures.
