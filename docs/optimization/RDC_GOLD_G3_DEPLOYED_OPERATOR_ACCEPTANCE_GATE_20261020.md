# Gold G3 — Deployed Operator parity + guarded live signed enrollment gate

Date: 2026-10-20 | branch `feature/light-remote-gold-rebuild-20261018`
Baseline `66a978a` | **G3 BLOCKED pending installed Operator source alignment and authorized full UAT E2E**.

## What was verified on the real Gold service
- Gold UAT public portal at `https://gold.light-remote.thaiduy.digital/account` HTTP 200; unauthenticated `/account/api?action=me` HTTP 401 (expected).
- Logged in over the **normal public account login endpoint** with an already-existing synthetic test account ending `@example.invalid`: HTTP 200, opaque authorized session cookie returned; no token or cookie printed. This proves test-account authentication works but does not approve/enroll a disposable live Agent.
- The installed Operator and Plugin remain systemd services in isolated `light-remote-gold-uat` LXD; installed FleetRouter SHA256 **c78ea161e89e495d2f1f4db587e43bdc58cb492741bb8e77f686e8b9970534f1** differs from current Gold branch FleetRouter SHA256 **8c8f93d43372d77e46a7ee5b4feadb999eb2d209b61b8fedbcda22c13e5f1be4**. Device channel route installed vs source SHA differs too. **Do not hot-patch only one module or declare G3 complete on an older Operator.**
- Queried the live installed Operator via its real Unix socket `/run/light-remote-gold-uat/operator.sock` GET `/v1/fleet`, HTTP 200. Outbound leaf summary: **2 fresh / 2 outbound, zero with explicit `executorReady` signal, two marked `dispatchReady=true` without executor proof**. Those two live nodes are existing UAT leaves, not synthetic Agent acceptance. No raw IDs/accounts or private capabilities are included in audit output.

## Added reusable acceptance gate
- `deploy/scripts/uat-gold-g3-readiness-audit.mjs` is a **read-only** live Operator audit. When executed *inside the Gold LXD*, it requires `GOLD_G3_EXPECTED_FLEET_SHA` from the Gold source. Reads installed FleetRouter hash and authenticated local IPC response; strips all device IDs/account identifiers. Summarizes outbound freshness vs explicit executor health, detects false admission on known unavailable executor and stale channels, and reports `SOURCE_AND_FLEET_EVIDENCE_PRESENT`, `BLOCKED_OPERATOR_SOURCE_MISMATCH`, `BLOCKED_EXECUTOR_EVIDENCE`, or `FAIL_ROUTING_SAFETY` with explicit semantics. Does **not** alter Fleet state.
- Staged the audit to `/tmp/g3-deployed-readiness-audit-20261020/` inside real Gold LXD with expected hash from current source. Exact result:
  `outboundLeaves=2, freshOutboundChannels=2, explicitExecutorSignals=0, unknownOnFreshChannels=2, optimisticAdmissionWithoutExecutorProof=2, gate=BLOCKED_OPERATOR_SOURCE_MISMATCH`.
- New `deploy/scripts/selftest-g3-live-readiness-evidence.mjs` tests known legacy unknown, false executor admission, stale channel admission, correct explicit readiness; **4/4 PASS** on VPS-ARM. CI runs this source-only test with Node syntax checks for both UAT scripts; it never logs in/deploys.

## Guarded real-service E2E runner prepared but NOT executed
- `deploy/scripts/uat-gold-g3-live-enrolled-agent.mjs` runs only with `GOLD_G3_ENABLE_LIVE=1` and synthetic `GOLD_G3_TEST_EMAIL` ending `@example.invalid` plus a sufficiently long `GOLD_G3_TEST_PASSWORD` supplied in the environment (nothing hardcoded or committed). It uses the canonical public Gold portal for **normal account login**, starts actual Agent CLI enrollment, approves with the account's own authenticated session via `/account/api?action=enrollment-approve`, polls and validates signed certificate, requests a signed connection, starts an isolated real Agent daemon, observes Fleet over real UAT Operator IPC, and tries to remove **only the newly enrolled test device** in `finally`. It dispatches no user shell/filesystem/desktop commands; ephemeral local Agent state is scrubbed after execution.
- Guarded runner syntax PASS, staged script/source SHA matched under existing `/tmp/g3-real-daemon-lifecycle-20261020/` inside LXD.
- **Platform tool safety refused** the attempt to execute the live runner when synthetic password was passed in a remote command. No commands were admitted to the remote runtime and no live disposable Agent was enrolled by that call. Respect this **pre-dispatch denial**: do NOT retry by PTY, hidden file, an alternate tool path, proxy, or any equivalent evasion. No live E2E PASS is claimed, despite normal synthetic login having passed earlier.
- No production or existing Gold runtime modifications, no systemd restart, no database migration. The source stage and audit are read-only except isolated scratch/test files.

## Source / deployment mismatch is a real G3 acceptance prerequisite
1. Create an owner-approved, reversible **Gold UAT only** Operator/Plugin upgrade plan from this branch; verify module closure, package/DB migrations, schema, env, normal login and rollback before replacing installed services. Existing UAT has two active Agent leaves: coordinate a short maintenance window, check in-flight count zero, and do not assume the source can be copied hot.
2. After source parity and authorized synthetic owner approval are available, perform full signed Agent enroll→connect→duplex→Executor fail-closed/recovery on actual Gold API and restart, with Local Wall showing the same evidence. Keep live acceptance separate from synthetic in-memory fixtures.
3. Measure a bounded **long-lived** Agent soak with p50/p95, orphan count and sampled RSS; don't infer a long-lived leak ceiling from the ~10 second lifecycle tests.
4. Do not start G4 by declaring G3 green merely because transport/CI are green. This test and audit provide honest gating, not a policy exception.

Latest other evidence: real dormant Linux/macOS Agent lifecycle plus synthetic enrollment/duplex tests are passing; see master handoff. Keep unrelated preexisting Gold UAT untracked files untouched.


## CI verified after push
- Source [`30b4c6849198414460de6b09bae0156deb5697dc`](https://github.com/n8n2erpnext/light-remote-mcp/commit/30b4c6849198414460de6b09bae0156deb5697dc) triggered [Gold G3 Operator Regression #10](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39437851397): **6/6 SUCCESS** (Operator contract, server bundles x64 + ARM64, real dormant Agent lifecycle, synthetic authenticated CLI enrollment, bounded TCP soak).
- Reviewed Operator job log for `G3_LEGACY_FRESH_CHANNEL_NOT_EXECUTOR_PROOF=PASS`, `G3_FLEET_REJECTS_FALSE_EXECUTOR_ADMISSION=PASS`, `G3_FLEET_REJECTS_STALE_CHANNEL_ADMISSION=PASS`, `G3_FLEET_REQUIRES_EXPLICIT_EXECUTOR_SIGNAL=PASS`, and `gold-g3-operator-contract=PASS`.
- This CI tests source contracts and isolated fixtures. It does **not** use credentials, restart the real Gold Operator, or enroll a live test device. The **live** read-only audit continues to report `BLOCKED_OPERATOR_SOURCE_MISMATCH`. Do not conflate the two.
