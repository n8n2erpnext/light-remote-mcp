# G1 — Linux systemctl newline capability regression (RED / provider-blocked)
Date: 2026-10-19 | Branch: `feature/light-remote-gold-rebuild-20261018`
Previous pushed HEAD: `1b681c6623ccc3fc017426b6047716480fed7b79`

## State
**G1 IN PROGRESS, regression REPRODUCED; patch NOT APPLIED.**
G2–G6 NOT STARTED. Gold LXD runtime and production remain UNCHANGED in this checkpoint.

## Finding
The Linux Agent's `device-agent/platform-adapters/linux.mjs::classificationInput` contains a narrow `systemctl` readonly-unit exception, but uses JavaScript regex whitespace class `\s` for the *whole-command* matcher. JavaScript `\s` includes LF/CR and more than shell argument separators. In Bash, LF separates commands. A script containing `systemctl is-active\ndocker` is thus two shell commands but can incorrectly be treated as the readonly systemctl service query for capability classification; the `docker` portion is replaced with a placeholder only **for inference**, not for actual execution.

This is a source-level **under-classification of Docker capability** in a limited bare-executable newline case; do NOT assume this proves arbitrary privileged commands can run or that this is an OpenAI platform-safety bypass. Agent local final deny / signed policy still apply, but capability inference must be consistent with the shell.

## Reproduction evidence
Wrote **RED fixture** `deploy/scripts/selftest-gold-linux-systemctl-whitespace-boundary.mjs`: compares leaf and Operator inference for 5 safe single-status cases and 17 variants containing newline, CR, shell separators and substitution. The test classifies strings only; it NEVER executes Docker/systemctl.
Actual command: `node deploy/scripts/selftest-gold-linux-systemctl-whitespace-boundary.mjs`.
Actual result: **exit 1**; assertion message:
`must retain Docker when shell separators/expansions appear: "systemctl is-active\\ndocker"`.
Old scoped service/journal unit tests were not modified or reinterpreted.

## Safe remediation specification (UNIMPLEMENTED)
In the **same existing whole-command `systemctl` readonly-unit matcher only**, use SP/TAB separators and boundary anchoring, not general `\s` whitespace. Preserve simple literal `systemctl is-active docker` / `sudo -n systemctl status docker` as readonly, but any LF, CR or shell syntax must bypass the narrow exemption and retain conservative Docker inference. Do not modify executed script, hard-deny, Agent authorization, A/B, enrollment or Fleet intersection.

## Blocker and safety boundary
The direct `light_remote_edit_file` call to apply this narrow patch was **refused by the OpenAI pre-dispatch safety layer** before creating a device write/job. The patch was **not applied**, and no attempt was made via alternate write_file/exec/PTy/GitHub or other tool to bypass this refusal. This checkpoint merely preserves the RED test, source analysis, and required acceptance. Only a subsequent independently authorized maintenance process should apply and re-test the change.

No claim that G1 is green/complete. Re-test on Gold after a legitimately applied code patch:
- RED fixture must turn GREEN.
- Existing `selftest-gold-linux-service-command-inference.mjs` (36 cases), `selftest-gold-journalctl-unit-capability.mjs` (40 cases), `selftest-gold-outbound-exec-capability-parity.mjs` (13 cases) must stay PASS.
- Gold native Linux module import smoke and 5 services ready; real Gold signed MCP E2E remains separately BLOCKED by previous envelope-key configuration until legitimately repaired.

## Source/docs
Existing latest: `docs/optimization/RDC_GOLD_G1_JOURNALCTL_UNIT_CHECKPOINT_20261019.md`. Preserve pre-existing untracked UAT fixtures and production `light-remote-direct` unchanged.

## Next action
Do not repeat the refused patch via another tool or disguise the same action. Report the specific false-positive refusal to the platform using a sanitized repro where appropriate. Keep G1 open, and do not advance to G2 based on source-only tests or a missing Gold public envelope key.
