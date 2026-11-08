# G1 — Linux Docker service-name inference: false positive + substitution coverage
**Checkpoint:** 2026-10-19 | **Branch:** `feature/light-remote-gold-rebuild-20261018`
**Starting commit:** `2a80bb5588e879d27456407bc5be9b3ce6b0892e`
**Status:** G1 PARTIAL, this scoped change TESTED/DEPLOYED TO GOLD; **G1 E2E still BLOCKED**, do not start G2.

## Root cause and patch decision
The Linux Agent's `device-agent/platform-adapters/linux.mjs` uses regex-based conservative capability inference. It previously treated `docker` in a simple service query `systemctl is-active docker` as a Docker executable, so an Agent authorized for `systemctl` but not `docker` could reject a harmless service-status query. The G1 outbound Operator preflight introduced in `2a80bb5` intentionally mirrored this false positive, revealing rather than creating it.

The red/green adversarial suite additionally exposed a missed **real** command: the previous Docker regex did NOT require Docker for `systemctl is-active docker$(docker ps)`, because `(` had not been recognized as a command boundary for nested substitution. This is a source regression, and patching only the false positive without the negative case would risk a policy bypass.

The narrowly scoped patch:
1. Introduced `classificationInput(script)` in the **shared Linux Agent adapter**, which recognizes only an ENTIRE literal single `systemctl is-active|is-enabled|status docker[.service]` query; optionally `sudo -n` and standard `/usr/bin` paths, without any shell metacharacter, interpolation, extra arguments, chaining or redirection. Only for capability inference, replace the final unit-name argument with a neutral placeholder. **Never modify the actual executed script.**
2. Added the `(` and `)` boundaries in the Docker executable rule, covering `$(docker ps)` / `$(/usr/bin/docker ...)` and command substitutions previously missed.
3. No change to Agent `hardDeny`, signed envelope, local final deny, enrollment, policy revision, Fleet intersection, OAuth, A/B, user-supplied declared capabilities or permissions. The Operator outbound preflight **automatically picks up the updated shared Linux adapter**; no new parser or independent second policy list. Any explicitly declared `docker` requirement is **never removed**.

## Red/green and compatibility verification — actually run
- `deploy/scripts/selftest-gold-linux-service-command-inference.mjs` — **36/36 PASS**: 8 narrowly allowed whole-query cases plus 28 conservative Docker-required examples (Docker CLI, absolute paths, shell operators `&&`, `||`, `;`, `|`, newline, command substitutions, backticks, comments, redirections, extra arguments and service mutation commands); validates Operator and Agent inference parity.
- `deploy/scripts/selftest-gold-outbound-exec-capability-parity.mjs` — **13/13 PASS** across Linux, Windows and macOS.
- `selftest-gold-leaf-capability-origin.mjs` — PASS, denied real Docker if not reported/approved.
- `selftest-gold-policy-revision-diagnostics.mjs` — PASS.
- `selftest-v09-platform-adapters.mjs` — Linux, Windows, macOS discovery/inference/shell PASS.
- `selftest-v09-linux-service-policy.mjs` — sudo grantability and Linux systemd hardening PASS.
- `selftest-v10-cross-platform-policy-shell-helper.mjs` — profile/PowerShell/cmd/Linux/macOS helper PASS.
- `selftest-gold-plugin-tool-contract.mjs` — all 80 MCP registration contracts PASS.
- `git diff --check` and `node --check` — PASS.

## Deployment — only isolated Gold, no production
Pushed ONLY `device-agent/platform-adapters/linux.mjs` into `light-remote-gold-uat` at `/opt/light-remote-gold-uat/device-agent/platform-adapters/linux.mjs`, restored `gold-uat` ownership, verified Node syntax. A direct import inside Gold LXD checked four representative permissions and printed `GOLD_AGENT_REAL_DEPLOYED_ADAPTER=PASS`. Restarted only Gold Operator and started Gold Wall to ensure dependent readers load the updated adapter. Gold PostgreSQL, Redis, Operator, Plugin, Wall **5/5 active**; Gold `/account` and OAuth discovery HTTPS **200**, Gold NetBird Wall **303** login, production HTTPS **200**, unchanged.

## Remaining G1 gaps and non-claims
- Gold `light_remote_exec` end-to-end remains blocked by **`operator_public_key_unavailable`**, previously investigated and provisioning restricted. This release DID NOT touch Gold envelope keys or retry previously refused operations by alternate tool, shell, PTY or device.
- This is a **scoped literal service-status fix**, NOT a general-purpose shell AST parser. Other false positives such as `journalctl -u docker`, aliases, shell-specific functions and quoted service names may remain. More broadly, static inference is deliberately conservative.
- This fix may change the outcome of an existing legitimate status-only command for an Agent without Docker permission; that's the intended narrow policy-precision improvement. It does not grant permission to execute actual Docker.
- No synthetic legacy Agent integrated tests were rerun indefinitely (past timeout `exit 124` and missing `gold_independent_mode` environment are documented). All successful tests above are bounded pure or direct isolated Gold-module tests, not remote command E2E.
- Future policy changes must have adversarial parser-negative tests *before* broadening any exception.

## Next checkpoint (remain G1)
1. Add cases for other source-confirmed service arguments only after demonstrating safe, nonexpanding command-position semantics; avoid ungrounded regex relaxations.
2. Audit reported `requiredCapabilities` on the actual authorized remote Agent once the independently permitted Gold envelope key problem is resolved.
3. Keep source/regression vs true MCP dispatch separate and preserve all Gold/production boundaries.
4. Next session read `docs/optimization/RDC_HANDOFF_CURRENT.md`; this document supersedes only the service-name OPEN note in `RDC_GOLD_G1_OUTBOUND_EXEC_PARITY_CHECKPOINT_20261019.md`.

**Rollback:** restore the prior `device-agent/platform-adapters/linux.mjs` from commit `2a80bb5` on Gold LXD and restart Gold Operator/Wall. No schema/data changes, no production changes, no secrets changed.
