# RDC → Light Remote Gold G1: Policy Revision Diagnostic Checkpoint — 2026-10-19

## Milestone state
**G0 DONE. G1 IN PROGRESS. G2–G6 NOT STARTED.**
Existing branch `feature/light-remote-gold-rebuild-20261018`. Previous pushed checkpoint `f4471b24b40e923365a5760862d7e2c9d0fa38b8`.
No changes to production. Gold test environment: isolated LXD `light-remote-gold-uat`; authorized management via the official Light Remote plugin on VPS-ARM.

## Root-cause context
The Gold capability admission currently performs `intersection(current authenticated Agent-reported capabilities, enrollment-approved capabilities)`. This is intentionally fail-closed. G1 previously added `agent_not_advertising` vs `enrollment_not_approved`; both still reject a missing capability before a remote job is started.

A specific diagnostic blind spot remained: when enrollment policy revision N has changed but the Agent's last signed heartbeat/duplex frame advertises revision N-1, the diagnostic could label an approved-but-unreported capability merely `agent_not_advertising`, obscuring a genuine **policy synchronization lag**. This is not proof that stale policy is the only cause of a missing capability, and does not justify granting it.

## Minimal source-only behavioral patch
- `operator-host/fleet-router.mjs`: retain bounded numeric `reportedPolicyRevision` in the authenticated channel's ephemeral Fleet node observation. Exposed in Fleet view for trusted Operator diagnostics only; invalid/missing values become `null`. No persisted business-state schema, lease or route changes.
- `operator-host/executor-routes-device-channel.mjs`: carry the signed Agent's reported policy revision through **both** duplex hello/heartbeat and legacy poll paths to Fleet.touch. No change to signed-payload verification or enrollment checks.
- `operator-host/leaf-capability-admission.mjs`: when a required cap is approved but not advertised AND the reported revision is older than current enrollment revision, emit `agent_policy_revision_stale`. If both revisions match (or are unknown), emit `agent_not_advertising`. If the capability is not approved, `enrollment_not_approved` takes priority. **The allowed capabilities remain exactly the existing intersection**, independent of revision.
- `operator-host/executor.mjs`: source the two revisions from Fleet and enrollment when populating the existing `job_admission_denied` event. HTTP refusal and authorization behavior unchanged.
- `plugin-server/operator-adapter.mjs`: allowlist the third diagnostic reason in the account/agent/device scoped activity view, without leaking raw policy or secret material.
- New `deploy/scripts/selftest-gold-policy-revision-diagnostics.mjs`: source-level tests for old/new/unknown revision, absent approvals, already-advertised capability, and fail-closed behavior.

## Tests (all actually run; not substitutes for authenticated Gold command E2E)
1. `node --check` on all six changed modules/test: PASS.
2. `selftest-gold-policy-revision-diagnostics.mjs`: `G1_POLICY_REVISION_PROVENANCE_NO_PRIVILEGE_CHANGE=PASS`.
3. `selftest-gold-leaf-capability-origin.mjs`: `G1_GOLD_CAPABILITY_PROVENANCE_FAIL_CLOSED=PASS`.
4. `selftest-gold-tool-error-origin.mjs`: PASS.
5. `selftest-gold-plugin-tool-contract.mjs`: **80 MCP tool metadata contracts PASS**, no changes to annotations/safety classifications.
6. Fleet Router regression `selftest-v08-fleet-router.mjs`: PASS (signature/replay, lease redelivery, in-flight presence, late receipt, drain).
7. Duplex server regression `selftest-m6b-device-duplex-server.mjs`: PASS.
8. Device policy regression `selftest-v09-device-policy.mjs`: PASS.

Deployed **five runtime files** only to Gold: FleetRouter, device-channel routes, leaf capability helper, Operator executor, Plugin adapter. Restarted only Gold Operator/Plugin, waited for readiness. Gold: PostgreSQL/Redis/Operator/Plugin/Wall **5/5 active**, Gold `/account` and OAuth discovery **HTTP 200**, Wall NetBird **HTTP 303** (login); production **HTTP 200** unchanged.

## Still BLOCKED — do not misrepresent status
Gold end-to-end encrypted commands remain blocked by the previously diagnosed `operator_public_key_unavailable` configuration. Earlier crypto provisioning/write attempts were refused by the OpenAI platform gate; no alternate tool, shell or PTY must be used to bypass that denial. The current checkpoint did NOT attempt that operation or create key material. **G1 cannot close until an independently legitimate maintenance process resolves Gold's envelope-key setup and real authenticated MCP admission is tested.** A separate provider pre-dispatch refusal can occur even when Gold is healthy, and cannot be corrected from Light Remote's server code.

Previous current handoffs: `RDC_GOLD_G1_CAPABILITY_PROVENANCE_CHECKPOINT_20261019.md`, `RDC_GOLD_G1_HANDOFF_20261019.md`, `RDC_GOLD_G0_HANDOFF_20261019.md`. Overall Master Plan and G5 SCP Wall-progress contract remain unchanged.

## Next permitted G1 actions
- Do not start G2.
- With explicitly permitted Gold maintenance/owner approval, restore **Gold-only** X25519 envelope configuration by the ordinary authorized process, without exposing key contents, and verify real MCP exec with valid/invalid `requiredCapabilities`.
- Observe whether policy revision diagnostic is visible in an authenticated denied job event. Missing capability stays denied.
- Audit other MCP error descriptions and provider-vs-Operator attribution on benign calls. Never change metadata to disguise a command, or re-route a refusal through PTY.
- Use isolated synthetic fixtures for any further tests and preserve pre-existing untracked UAT files. Rollback: revert only this commit on Gold branch and restart Gold Operator/Plugin, no schema or production change.
