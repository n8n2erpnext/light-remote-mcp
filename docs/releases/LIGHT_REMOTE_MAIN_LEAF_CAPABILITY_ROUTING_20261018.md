# Light Remote Main vs leaf capability-routing mismatch — 2026-10-18

## Reproduced discrepancy

On owner-approved VPS-ARM device `direct-arm-local`, Light Remote inspection reports `role=main`, `routing.mode=local`, and `docker` in both approved and effective capability lists. Yet the same device's recent execution history reports `route=outbound-leaf` (including ordinary `filesystem` jobs). A separate **read-only** Docker inspection explicitly declaring `requiredCapabilities:['docker']` was denied **before execution** as `target_node_capability_missing`. Docker client/daemon version 29.6.2 were seen in prior read-only host inventory; no new Docker infrastructure or container was deployed or changed during this investigation.

This is a route/capability decision discrepancy, not proof the owner failed to enable Docker.

### Source-level cause and correction

The Operator calls `isOutboundTarget({integratedHostEnabled:INTEGRATED_HOST_ENABLED,localNodeId:NODE_ID,targetNodeId:session.nodeId})` to choose local versus outbound-leaf execution. In a separated Operator (`OPERATOR_INTEGRATED_HOST=0`), that helper intentionally returns **outbound-leaf even if node IDs match**.

Before this patch, `targetRoute`, `routingViewForDevice`, and `policyViewForDevice` instead treated `nodeId===NODE_ID` as unconditional local routing/policy. In the separated configuration, this could present the wrong local policy and, for an outbound job, substitute `hostEffectiveCapabilities()` where only Fleet + enrollment-approved target-node capabilities should be used.

Corrected these three paths to use the **same `isOutboundTarget` classification** as `startJob`. The integrated local case still requires local host capability. The outbound-leaf case now always passes through `fleet.assertRoutable` plus enrollment `approvedCapabilities` intersection, even when node IDs happen to be equal. This may cause a previously misrepresented route to be shown as offline or denied until the correct leaf binding is repaired. **Do not use host/Main rights as fallback or change PTY requirements to get a denied Docker job through.**

This source fix does **not** alter ChatGPT's own policy decisions, the host tools' pre-execution safety denials, any capability allowlist, enrollment grant or production service. It corrects routing/policy coherence and fail-closed authorization; it does not assert that a Docker job is now permitted. An operational fix may additionally need properly authorized Fleet target-enrollment mapping.

## Test evidence

`platform-v2/test/gold-main-capability-route-consistency.test.mjs` covers both integrated and separated cases, exact alignment of device inspection, targetRoute and execution classification, and verifies the leaf capability intersection and missing-capability errors remain enforced.

On this source branch: Gold Core **144/144 PASS**, platform-v2 **186/186 PASS**, safety **4/4 PASS**, isolated Operator and Plugin HTTP smoke PASS. No tests ran a Docker job or modified live infrastructure. Production code is not redeployed by a source commit.

## Remaining separate refusal classes

1. Model/host safety rejection: can happen before a Light Remote job is even created. Not a Fleet capability grant and not fixed by source routing patches.
2. Light Remote target capability admission (`target_node_capability_missing`): occurs before a job is scheduled against an outbound-leaf capability intersection; now consistently classified.
3. OS or Docker daemon authorization: occurs after an approved job starts; use the returned exit code/stderr to diagnose instead of treating it as a policy mismatch.

A PTY is an interactive transport, **not** an authorization workaround. Do not recommend retrying blocked actions on a different device, through PTY, or by omitting required capabilities.

## Gold implications

The source-level Gold cutover still requires a legitimate independent PostgreSQL17/Redis8 runtime and canonical business-writer migration across all 23 domains. A displayed `docker` entitlement alone is not proof a job is approved on the actual route. Before provisioning, owner should verify a correctly authorized route and check the **exact** requested capability without circumventing any denial. Current accepted Gold source gate remains `BLOCKED_SOURCE_CUTOVER 0/23`.
