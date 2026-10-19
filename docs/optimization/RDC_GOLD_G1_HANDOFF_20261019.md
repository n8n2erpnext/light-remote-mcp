# RDC → Gold G1: Capability Admission & Tool Error Origins — checkpoint 2026-10-19
**Status: PARTIAL IMPLEMENTATION, G1 GATE NOT YET PASS.** Never present this as completed MCP E2E.
**Branch:** `feature/light-remote-gold-rebuild-20261018`; prior G0 checkpoint `0f157feb57e31f289af629c1cb873110a08a1f26`.
**Environment:** official Light Remote for authorized VPS-ARM development, isolated Gold LXD for deployment, Gold MCP for test; production not touched.

## What G1 actually confirmed
1. **Native Gold MCP end-to-end is blocked before capability admission**. From the properly authorized Gold session, benign read-only `lxc --version` with and without declared `lxd`, and `systemctl is-active` with declared `systemctl`, failed `operator_public_key_unavailable`. Do NOT infer Fleet `target_node_capability_missing` from these results.
2. Source confirms **sealOperatorPayload()** reads `OPERATOR_PUBLIC_KEYS_JSON` or `OPERATOR_PUBLIC_KEYS_FILE`; neither was configured in the running Gold Plugin systemd environment. The Operator's configured `OPERATOR_KEY_FILE` points to a **2048-bit RSA PEM** (algorithm checked without exporting material), whereas the envelope handler expects **X25519 JSON**. The Gold Operator can be active/healthy while this command-encryption path is unusable. A functioning HTTP `/account`/OAuth route does not prove remote execution readiness.
3. A read-only source/crypto diagnostic command was refused by the platform gate. An attempt to write **new Gold-only systemd key-path templates** using the normal official filesystem tool was separately refused. **No new key file, private material, systemd key drop-in or runtime crypto configuration was created. Do not retry these refused operations via shell, PTY, or a different channel to evade the refusal.**
4. A Gold real MCP error-origin smoke call after deployment was refused **at platform pre-dispatch**; there was no Gold job. Gold MCP E2E = **BLOCKED**. This is separate from the earlier `operator_public_key_unavailable` result and cannot be fixed through a Plugin error mapper.
5. `FleetRouter.touch()` uses only **Agent-reported** capabilities and `targetRoute()` intersects them with enrollment-approved capabilities. Source `operator-host/executor.mjs:startJob()` rejects missing capabilities *before* `job_started`. This is an intentional fail-closed authorization invariant. **Do not grant based only on `inspect_device`**; differences between configured policy and Agent/Fleet advertisement require diagnosis of Agent reporting and policy revision. The earlier production explicit-Docker mismatch was not re-tested in G1; its prior evidence remains in `docs/releases/LIGHT_REMOTE_TOOL_SAFETY_MULTILAYER_AUDIT_20261019.md`.

## Safe source-only patch applied to Gold Plugin
- `plugin-server/tool-error-classification.mjs`: allowlisted machine-readable error classes, no unrestricted error string echoed as structured data. Classes include `plugin_configuration`, `fleet_admission`, `operator_admission`, `device_local_policy`, `operator_transport`, `canonical_storage`. Known errors return a bounded `nextAction`, optional safe HTTP status and explicit `retryable`. Unrecognized/unstructured messages become `operation_failed` in structured output. **No platform-pre-dispatch category is synthesized inside Plugin**, because a refused call never reaches Plugin.
- `plugin-server/tools.mjs`: leaves legacy redacted MCP error *text* intact for compatibility, attaches `structuredContent: {ok:false,error,layer,retryable,nextAction,...}` and `isError:true` for both guarded and legacy tool invocations. This does **not** change A/B, quota, hard deny, approved capabilities, command execution, retry or process state.
- `deploy/scripts/selftest-gold-tool-error-origin.mjs`: pure source regression for known code mapping, unknown error sanitization, HTTP status bounds, no claim of bypass.
- Deployed these **two Plugin source modules only** to isolated `light-remote-gold-uat` and restarted only the Gold Plugin. No production files changed.

## Tests and observed results
| Evidence | Actual result |
|---|---|
| `node --check plugin-server/tools.mjs` and new classification module | PASS |
| `node deploy/scripts/selftest-gold-tool-error-origin.mjs` | PASS |
| Existing SCP routing and old-client SHA regression | PASS |
| Gold Plugin, Operator, Wall, PostgreSQL, Redis service check after restart | 5/5 active |
| Gold `/account` and OAuth discovery HTTPS after startup | 200, 200 |
| Production HTTPS | 200, untouched |
| Gold `light_remote_exec` benign explicit capability E2E | **BLOCKED: missing public-key config** |
| Post-deployment Gold MCP smoke | **BLOCKED: platform pre-dispatch refusal** |
| Fix/rotation of Operator envelope keys | **NOT EXECUTED: permission gate denied writing configuration** |
| Linux/Windows/macOS device admission reliability comparison | NOT TESTED this iteration |

## Next exact action (do not blindly retry a blocked operation)
1. Through an explicitly permitted, normal maintenance/deployment process, provision **Gold-only** X25519 envelope keypair using the project's documented generator, keeping private key mode 0600 and public metadata readable to Plugin. Correct the independent Operator private JSON path and Plugin public JSON path. **Do not overwrite the existing RSA PEM**; do not log keys. Stop and seek legitimate authorization if this step is refused.
2. Verify the Gold command encryption/decryption round trip using an isolated synthetic test and read-only MCP call. Then test no-cap/valid explicit-cap/missing-cap through Gold, compare actual signed Agent policy + Fleet advertised capability revision and reason without broadening any privilege.
3. If explicit capability mismatch persists, fix the **source of the advertised capability/revision**, preserving the `intersection(Agent reported, enrollment approved)` fail-closed rule; do not fill missing capabilities from operator admin metadata or other devices.
4. Only after G1 authorization E2E passes, compare RDC-vs-Light-Remote benign calls in equivalent authorized environments. Do not speculate about OpenAI private safety classifiers.
5. Keep G1 as **IN PROGRESS**, checkpoint every error and test, do not start G2 as if G1 fully passed.

## Rollback and cleanup
Source patch rollback: restore pre-G1 versions of `plugin-server/tools.mjs`, remove `plugin-server/tool-error-classification.mjs` and restart **only** Gold Plugin, or revert its G1 Git commit in Gold. No schema or credential rotation. Pre-existing untracked `deploy/gold-uat/`, `deploy/scripts/check-gold-db.mjs`, `deploy/scripts/uat-gold-account-device.mjs`, `deploy/scripts/uat-gold-http-api.mjs` remain untouched.
