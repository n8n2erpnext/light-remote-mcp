# Current RDC → Light Remote Gold optimization handoff

**Current milestone: G0 DONE. G1 IN PROGRESS; crypto provisioning and MCP E2E BLOCKED.**

Read [G1 Linux service query checkpoint](./RDC_GOLD_G1_LINUX_SERVICE_QUERY_CHECKPOINT_20261019.md) **first**, then [G1 outbound exec parity checkpoint](./RDC_GOLD_G1_OUTBOUND_EXEC_PARITY_CHECKPOINT_20261019.md), then [G1 policy revision checkpoint](./RDC_GOLD_G1_POLICY_REVISION_CHECKPOINT_20261019.md), then [G1 capability provenance checkpoint](./RDC_GOLD_G1_CAPABILITY_PROVENANCE_CHECKPOINT_20261019.md), then [G1 initial error-classifier checkpoint](./RDC_GOLD_G1_HANDOFF_20261019.md), then [G0 checkpoint](./RDC_GOLD_G0_HANDOFF_20261019.md), [Master Plan](./RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md), [Gap Matrix](./RDC_FEATURE_GAP_MATRIX.md), [Execution RCA Map](./RDC_GOLD_EXECUTION_RCA_MAP.md), and [Baseline](./RDC_GOLD_G0_BASELINE_20261019.md).

**Repo:** n8n2erpnext/light-remote-mcp; branch `feature/light-remote-gold-rebuild-20261018`. Do not use another branch or touch production. Refresh Git HEAD before implementation.

**G1 checkpoints:** `34adb0d` error classifier; `b1d7b9d` capability provenance; `8d46860` Agent policy revision. Outbound exec capability parity is now implemented in Gold: source regression 13/13 PASS, Gold runtime healthy, real Gold MCP E2E still BLOCKED by envelope-key config. The *scoped literal* Linux service-name false positive (`systemctl is-active docker`) is now FIXED/Gold tested, while Docker command substitution detection is stricter. More complex service/argument cases still require evidence and conservative tests. Latest G1 source-only MCP metadata audit: `selftest-gold-plugin-tool-contract.mjs` verifies **80 registered tools**, PASS. G1 real MCP execution still BLOCKED on Gold envelope key configuration; no G2 start.

**External research:** RDC pinned `f508e524`; current Light Remote pre-G0 baseline `4daccb8`. No G1/G2/G3/G4/G5/G6 runtime code was changed in G0. Note especially G5 SCP progress on NetBird Wall and pre-dispatch safety vs device-policy distinction.
