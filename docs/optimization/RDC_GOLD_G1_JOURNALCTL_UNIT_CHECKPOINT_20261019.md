# Gold G1 — journalctl unit-name false Docker capability (2026-10-19)

**G0 DONE · G1 IN PROGRESS · G2–G6 NOT STARTED.** Existing branch: `feature/light-remote-gold-rebuild-20261018`.
Starting HEAD `325ad5f114c1333ad8773a8b053d22b3d2b7f284`. This is a narrow inference-precision fix, not a general shell parser.

## Reproduced original problem (RED)
`node deploy/scripts/selftest-gold-journalctl-unit-capability.mjs` exited **1**, asserting `journalctl -u docker` incorrectly required Docker authority. Original Linux Agent `RULES` checks whether the literal word `docker` follows any whitespace, including `journalctl -u docker` where it is a **service unit argument**. The user-reported false capability denials stem partly from these argument-vs-executable ambiguities.

Before GREEN, adversarial test fixture revealed two incorrectly assumed "unsafe" examples:
- `journalctl --unit=docker | cat`
- `journalctl --unit=docker --since=now`
Neither runs Docker. The original regex does **not** require Docker for these because the unit follows `=`; adding a new Docker requirement would cause a regression. They were removed from the `needsDocker` test expectation, rather than altering the product to fit an incorrect test. We retained meaningful negatives with **actual Docker invocation** such as `journalctl --unit=docker | docker ps` and `journalctl --unit=docker$(docker ps)`.

## Minimal source patch
`device-agent/platform-adapters/linux.mjs` extends its existing `classificationInput(script)` with a **whole-command**, literal `journalctl` selector:
- `-u docker[.service]`, `--unit docker[.service]`, `--unit=docker[.service]`; optional `/usr/bin` executable, `sudo -n`, `--no-pager` or bounded integer `-n N` before/after selector.
- Only **space/tab**, anchored entire command, no newline, expansion, quoting, chaining, redirects, additional options or arbitrary flags. The unit name is normalized only for capability inference, **not command execution**.
- `systemctl` capability remains required for `journalctl` and an explicit caller-declared `docker` capability is never removed.
- Any non-matching shell remains under the existing conservative Agent rules; separate Agent `hardDeny`, A/B, OAuth, Agent signed policy and local final deny unchanged.
- Existing Gold Operator outbound preflight uses the **same Linux adapter**; no duplicated allowlist or privilege expansion.

## Tests — real outcomes
- `selftest-gold-journalctl-unit-capability.mjs`: **GREEN PASS 40 cases** (12 literal status selectors, 28 conservative or real-Docker cases). Captures explicit capability preservation, Fleet denied/accepted intersection, and Agent/Operator parity.
- Updated previous `selftest-gold-linux-service-command-inference.mjs`: **PASS 36 cases** with `journalctl -u docker` now classified as read-only unit selection rather than "Docker executable".
- `selftest-gold-outbound-exec-capability-parity.mjs`: **PASS 13 Linux/macOS/Windows cases**.
- `selftest-v09-platform-adapters.mjs`: Linux, Windows, macOS and protected default deny **PASS**.
- `selftest-gold-plugin-tool-contract.mjs`: MCP 80-tool contract **PASS**.
- `selftest-gold-leaf-capability-origin.mjs`: **PASS**.
- Node syntax and `git diff --check`: **PASS**.

## Deployed only on Gold LXD (NOT production)
- Replaced `/opt/light-remote-gold-uat/device-agent/platform-adapters/linux.mjs` with modified source and restored `gold-uat` ownership. Live import/check inside Gold LXD returned `GOLD_JOURNALCTL_ADAPTER_SMOKE=PASS` across simple read-only and real Docker/chained cases.
- Restarted **Gold Operator**, started dependent **Gold Wall**.
- Gold PostgreSQL/Redis/Operator/Plugin/Wall **5/5 active**; Gold `/account` and OAuth discovery **HTTP 200**, Gold Wall over NetBird **HTTP 303 to login**, production HTTP 200 unchanged.
- No database migration, key provisioning, secret exposure, capability-grant mutation or production deployment.

## Known limitations / next G1 gate
- This is a narrow static inference correction. `journalctl -u docker --since=now`, quoted unit names and other non-whitelisted forms can still cause **conservative false positives**; no general shell lexer/AST was introduced.
- Gold real MCP `light_remote_exec` and SCP E2E still require legitimate remediation of previously documented `operator_public_key_unavailable`; attempts to provision Gold envelope keys were blocked before. **Do not retry refused operations by PTY/shell/alternative tool to evade that safety decision**. This direct Gold module test is not a signed remote command E2E.
- Follow-up: G1 only, continue source-grounded conservative triage and diagnose capability/correlation once Gold authenticated dispatch is legitimately available. G5 SCP Wall progress remains planned, not started.

## Rollback / checkpoint
Restore `device-agent/platform-adapters/linux.mjs` from Gold commit `325ad5f` and restart Gold Operator/Wall. No schema/data changes. Preserve pre-existing untracked UAT fixtures.
Read `docs/optimization/RDC_HANDOFF_CURRENT.md` then this checkpoint first in next session.
