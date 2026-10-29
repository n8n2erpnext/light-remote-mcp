# LIGHT REMOTE GOLD — MASTER HANDOFF 2026-10-26
## PR #4 audit, Wall dialogs, LXD Gold UAT, RM reliability, next Web Distribution/Admin

**READ FIRST.** This is the authoritative continuation note for the work ending on 2026-10-26. Read the old source handoffs as supplements, not as newer live states. The phrase "PR accepted" must never be conflated with "Gold UAT running latest" or "production deployed."

## 1. Owner intent and binding decisions
- The owner explicitly requested a full audit of the Gold PR branch: find genuinely orphaned/dead code, security/reliability bugs, stale UI browser popups, and use the native Light Remote Wall notification/modal style instead of Chrome/system dialogs.
- The owner then asked to finish PR/audit and write a **full cross-session handoff** so the next ChatGPT session can continue without rediscovering context.
- Priority after a safe Gold baseline: RM V2 optimization and reliability tuning; then Web Distribution + Admin. Do NOT expand these features during Gold audit stabilization.
- ChatGPT controls planning/implementation; Codex CLI/Bridge is optional and used for independent reasoning, review or delegated sub-tasks. Do not build a Chrome/ChatGPT Desktop auto-post/auto-resume hook or use Work as a substitute; user declined this.
- Keep Memory and Codex optional/independent. Preserve local-first Memory Home/Replica per-account, per-device Auto/Follow Project/Manual modes, scope-local/account deletion semantics, signed receipts, and original task history. Do not delete or rewrite any real user project memory.
- **Production is out of scope.** Gold UAT LXD and Gold source branches only. Do not merge anything into origin/main or reinstall Windows without owner approval.
- **Fail closed:** no synthetic task DONE, no fabricated terminal success receipt, no manual clearing running PostgreSQL claims, no A/B bypass, and no forced service restart while jobs or locks are unresolved.

## 2. Identifiers, location and repository
- GitHub repo: https://github.com/n8n2erpnext/light-remote-mcp
- PR **#4**: https://github.com/n8n2erpnext/light-remote-mcp/pull/4
- PR HEAD at handoff: **d6b50db4fb52f7bc5a4e74d284dd429a17656f15**; title "Feature/gold memory completion 20261026".
- PR source: feature/gold-memory-completion-20261026
- PR target: feature/light-remote-gold-rebuild-20261018 (**NOT main**).
- PR has 104 commits and 139 changed files (~12.8k insertions, 135 deletions). Review found no Git conflict; GitHub showed mergeable=true, mergeable_state=clean at audit start.
- PR **open, NOT merged** at this handoff. Merge is deliberately held pending physical Gold UAT gate and owner acceptance.
- Workspace on owner's **VPS-ARM**: /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/gold-memory-completion-20261026
- Light Remote official main plugin @light-remote, target VPS-ARM / direct-arm-local. The live session identifier may expire. Next session MUST call light_remote_connection_helper; never reuse an old one-time A code or guess a new session. Local Wall A/B approval is required if helper says so.
- Gold secondary plugin @light-remote-gold targets the isolated light-remote-gold-uat Linux leaf and Windows DESKTOP-VA16D27. Do NOT conflate connectors or silently change target.
- Current Git branch head and clean worktree before this document: d6b50db. This handoff commit is new and will become a later SHA after push.
- Relevant historic commits: 371f1ce7 (Codex review re-open + Windows acceptance), f4a0607 (Gold Wall-owned dialogs), f36490b (audit findings), d6b50db (reviewed byte-pinned parity fix).

## 3. PR/GitHub CI — concrete evidence
- Gold G3 Operator Regression run **40299793792**: SUCCESS 6/6 for feature commit f4a0607. https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40299793792
- Windows Tray Client build/install smoke run **40299793784**: SUCCESS for f4a0607. https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40299793784
- PR-created Gold Native Wall Modules Parity run **40301835007**: FAILED at immutable #486 byte-parity check. The unreviewed mismatch was device-agent/local-process-page.mjs; two other intentional changes were device-agent/update-settings-page.mjs and device-agent/wall-status-cache.mjs.
- Follow-up commit d6b50db pins **only these three reviewed files** to exact SHA-256; guard still rejects changed/unknown files and preserves exact-mode immutability.
- Gold Native Wall Modules Parity run **40303215964** for d6b50db: SUCCESS. https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40303215964
- The source-based full parity command sequence was also executed on VPS-ARM: PASS, including asset/render/HTTP packaged Wall smoke.
- A negative test modified a staged local-process-page.mjs file and recalculated the package manifest. Gold #486 guard correctly rejected it with GOLD_PARITY_REGRESSION; this proves the review pin does not allow arbitrary later changes.
- Note that docs-only handoff commits can advance PR HEAD without re-running unrelated CI. Always check per-commit CI SHA, not only a green badge for a previous SHA.
- GitHub SSH on VPS-ARM is active (git@github.com:n8n2erpnext/light-remote-mcp.git); prior PR creation required owner browser because GitHub connector returns 403 and gh CLI is not installed. PR #4 now exists, so no need to recreate it.

## 4. Code audit scope and limits
- Audited tree: 1,006 tracked files, 551 JavaScript files. Entire JavaScript syntax sweep (node --check) yielded zero syntax errors.
- Gold base comparison initially had 133 changed files, before the Wall-dialog patch; PR now shows 139 changed files.
- A first-pass static import/orphan heuristic identified five apparent orphans: lib/gold-db.mjs, lib/gold-device-resource-locks.mjs, lib/gold-registry-persistence.mjs, device-agent/linux-service-policy.mjs, operator-host/executor.mjs. Manual reference review found real dynamic/entrypoint/packaging/test consumers. **NO deletion** was made based only on grep.
- Five "missing imports" from the naive scan were paths inside test strings/assertions; no actual missing runtime-import closure was established.
- There is **no justification** to claim every runtime path of 139 files is fully fuzzed, formally verified, or bug-free. High-risk work still needs physical load/denial/reconnect acceptance.
- Previously reviewed files and notes: docs/gold/GOLD_BRANCH_PR_AUDIT_AND_WALL_DIALOGS_20261026.md and docs/gold/GOLD_MEMORY_COMPLETION_SOURCE_HANDOFF_20261026.md. Additional historic note docs/optimization/RDC_GOLD_M6_RESUME_INTEGRATED_20261023.md explains the old Windows owner orphan claim.
- This report makes **no assertion** that every remaining portal alert is corrected. Account/Admin portals and landing page are separate Web Distribution/Admin work.

## 5. Confirmed UI issue and fix
- Gold Local Wall previously already had confirmOverlay but 22 Long Memory/Codex handlers used browser-native confirm()/prompt(); owner screenshots captured the inconsistency.
- Commit f4a0607 replaces them with in-Wall confirmAction and wallPrompt, including typed-name confirm, Cancel/Confirm, Escape, keyboard focus control and focus return. Owner verification in backend retained; UI does not substitute for CSRF/auth.
- The Fleet Jobs page, local managed Processes page and Device Update settings page use new lib/wall-dialogs.mjs; client/core-files.json packages it.
- No browser native popup now remains in these Gold Wall/device surfaces.
- Account/Admin Portal still has 21 native-dialog calls and repo root landing page another 4. Do not broaden patch into those while reviewing Gold; address during the requested Web Distribution/Admin phase with explicit regression and consistent in-app dialogs.
- Source regression: deploy/scripts/selftest-gold-no-native-browser-dialogs.mjs (portable static/rendered assertions in Gold G3 and Windows CI).
- Browser fixture: deploy/scripts/selftest-gold-wall-dialogs.mjs (Chromium on ARM, primary Wall and secondary pages, typed text/confirm/cancel/Escape, zero native dialogs). Do not assume Chromium fixture is in GitHub CI; it was run on VPS-ARM.
- Other focused PASS: gold-wall-navigation, gold-memory-scope-management, gold-memory-account-delete, gold-codex-task-management, gold-codex-supervisor, gold-codex-coordinator, gold-client-core-imports (17-file static closure), git diff --check.

## 6. Additional 15 targeted RM/security/concurrency regressions — PASS
The following were run on VPS-ARM against PR source and all returned successful exit codes:
1. selftest-gold-owner-permission-authorization.mjs
2. selftest-g3-duplex-executor-rejection.mjs
3. selftest-g3-duplex-halfopen-watchdog.mjs
4. selftest-g3-duplex-reconnect-inflight.mjs
5. selftest-g3-duplex-ready-timeout-diagnostic.mjs
6. selftest-g3-command-transport-provenance.mjs
7. selftest-g3-agent-state-lock-recovery.mjs
8. selftest-gold-m5-isolated-worker-core.mjs
9. selftest-gold-m5-process-supervisor-agent-restart.mjs
10. selftest-gold-m5-supervisor-restart-journal.mjs
11. selftest-gold-m6-owner-orphan-recovery.mjs
12. selftest-gold-m6-process-stop.mjs
13. selftest-gold-memory-account-relay.mjs
14. selftest-gold-memory-account-delete.mjs
15. selftest-gold-codex-coordinator.mjs

Together they cover test-defined auth, signed dispatch, half-open/reconnect behavior, restart recovery, worker lifecycle, owner orphan handling, Memory relay/deletion and Codex report gating. **These are automated regressions, not physical Windows/macOS concurrency acceptance.**

## 7. Gold UAT LXD current live state — CRITICAL
- Target container: light-remote-gold-uat on VPS-ARM. LXD container is RUNNING.
- **Last verified LIVE effective Gold service source remains 371f1ce786fa484b86a77a7272ce16e6591e2a99**, NOT f4a0607 and NOT d6b50db. This is from systemctl ExecStart of the running Wall service.
- Four services observed active: light-remote-gold-operator, light-remote-gold-plugin, light-remote-gold-wall, light-remote-gold-process-supervisor.
- Gold PostgreSQL schema migration max version observed: **37**.
- Snapshot created safely on the exact LXD: gold-before-ui-dialogs-f4a0607-20261026. Other earlier snapshots exist and must not be deleted.
- Staged candidate: /opt/light-remote-gold-uat-candidates/f4a060798b9f0eceac02b626af17fd02a43e4023
- Seven candidate files were byte-compared against git show f4a0607: all 7 MATCH SHA-256 (client/core-files.json, device-agent/local-wall.mjs, fleet-job-page.mjs, local-process-page.mjs, update-settings-page.mjs, lib/wall-dialogs.mjs, static browser-dialog test).
- Isolated test execution in candidate LXD passed: no-native-browser-dialogs; client core import closure; Wall navigation; scoped Memory; Codex coordinator. This does NOT prove all live services run the candidate.
- **Candidate marker error:** staged candidate's .git-source-sha still contains OLD 371f1ce7 because it was cloned from an older candidate. Do not pass it as a verified f4a0607 candidate until re-stage and correct its provenance with full file verification.
- The LXD candidate has node_modules + plugin-server/node_modules symlinks, but no candidate secrets symlink; current deployed previous candidate also does NOT have one. Do NOT invent or copy secrets.
- Existing strict deploy helper: deploy/scripts/gold-m6-uat-four-service-cutover.sh, invoked INSIDE UAT with GOLD_M6_SOURCE_SHA. It demands proper source marker, checksum-verified backup, symlinks, running schema 35/36, idle PG/worker/fleet, and validated unit overrides.
- This script is outdated relative to schema37 and current secret layout, and MUST NOT be called with bypassed gates or weakened worker checks. No UAT service cutover occurred in this session.
- Two prior direct-style service override attempts were refused by tool safety policy. Do not disguise/bypass policy; prefer updated reviewed UAT release helper and positive preflight.

## 8. Blocking PostgreSQL orphan worker claim — DO NOT CLEAR
Read-only SQL inspection of Gold UAT found:
- Exactly **one** row in lr_gold_device_resource_claims, resource_mode=shared, worker_state=running, process_id present, approximately 5883 minutes since claimed (age at inspection, not a fixed duration).
- Its linked lr_gold_personal_agent_work was state=finished, disposition=ok; linked lr_gold_job_records status=ok. The claim nevertheless remains. **This mismatch is a real release/reconcile concern**, not proof a worker is alive or that process exit was signed.
- Ten historical work rows are state=unknown, disposition=operator_restart_reconcile (nine QUEUED_AGENT_SLOT, one RESOURCE_LOCKED), their job record status=interrupted. They correspond to retained pre-dispatch UNKNOWN and should remain as tombstones, not be "cleaned" for green dashboards.
- The single running claim relates to the old Windows Gold process started 2026-10-22. Historic owner handoff notes explicitly say the old Gold Windows Agent was uninstalled, production Agent reinstalled/rebooted, and old process outcome is **UNKNOWN** without signed terminal ACK.
- No signed terminal ACK was verified during this latest session for the claim. Do not reinterpret job status ok as terminal success.
- Owner-attested administrative recovery code DOES exist: lib/gold-device-resource-locks.mjs → abandonOwnerAttestedOrphan(); routed by operator-host/executor-routes-account.mjs; tests in deploy/scripts/selftest-gold-m6-owner-orphan-recovery.mjs.
- Recovery code requires actual owner auth and confirmation, reason gold_agent_uninstalled/reinstalled, observed boot **after** claim, channelFresh=false, exact account/device/job scope, no prior terminal receipt; it records audited processOutcome=unknown and no forged terminal ACK.
- That path was explicitly documented as *source-only, not deployed/invoked* in docs/optimization/RDC_GOLD_M6_RESUME_INTEGRATED_20261023.md. It is NOT permission to DELETE SQL manually. New Windows online channel may make the safe route ineligible, requiring a different owner-reviewed reconcile proposal.
- The UAT cutover worker gate properly blocks when ANY active claim is present. Do not force a 4-service restart, discard claim, or fake ownership/boot evidence.
- First safe next task: collect read-only job/claim/device boot and signed terminal receipt evidence; identify actual original device identity and current channel; if eligible use the authenticated owner workflow, with owner approval, else keep gate blocked and define audited remediation.

## 9. Codex acceptance and limits
- Windows owner-installed build at earlier commit 371f1ce7 passed actual Codex app-server ChatGPT Plus sign-in and 3-step synthetic task review test; 3/3 accepted and 7 receipts, including CONTINUE, WAIT_OWNER, DONE; fail-closed timeout was observed. Receipt data and scripts under C:\Users\Admin\Documents\GoldCodexReviewUAT on Windows.
- Separate real-chat demonstration: Codex assigned task 1 and task 2; ChatGPT performed using Light Remote in that active chat; Codex returned CONTINUE then DONE. This did **not** grant Codex automatic ability to read/submit new messages to chatgpt.com after conversation stops.
- Owner decided to keep existing Codex CLI/Bridge as optional reasoning reviewer/subtask developer (core vs UI), NOT develop browser injection or Work-driven quota-consuming loop.
- Security/operational caveat: Codex reviews submitted report/evidence but is not automatically an independent filesystem observer unless explicitly wired; avoid claiming standalone audit of FS.
- Windows install test is tied to previous client SHA; new Windows CI PASS does not mean current f4a0607 client has been installed physically.

## 10. Mandatory next-session continuation workflow
1. Connect @light-remote to VPS-ARM using official light_remote_connection_helper. If need_a_code, ask owner for a NEW A code generated at the same Local Wall, follow approval_required B path, then resume. Never reuse historic A or B, never enumerate before pairing.
2. Start by reading THIS handoff at /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/gold-memory-completion-20261026/docs/gold/RDC_GOLD_MASTER_HANDOFF_20261026_PR4_FINAL_AUDIT.md. Then read docs/optimization/RDC_GOLD_M6_RESUME_INTEGRATED_20261023.md and docs/gold/GOLD_BRANCH_PR_AUDIT_AND_WALL_DIALOGS_20261026.md, plus docs/gold/GOLD_MEMORY_COMPLETION_SOURCE_HANDOFF_20261026.md as needed.
3. Confirm git status and HEAD on Gold source branch. This handoff commit should be pushed to origin; do not assume old hashes remain HEAD.
4. Inspect PR #4 with GitHub connector: target must remain Gold rebuild; source Gold memory completion; verify current checks/reviews and no regression; **do not merge into main**.
5. Read-only inspect Gold UAT 4 services, source ExecStart, schema37, the 1 running stale Windows claim, 10 pre-dispatch UNKNOWN work rows and any newly arrived signed terminal ACKs. Never clear direct SQL.
6. Do not proceed to physical cutover until an owner-authenticated, auditable solution releases/reconciles the claim or worker-safe preflight passes. Prepare a fully verified candidate with accurate SHA provenance, proper package/dependency and secrets policy for schema37 and a cutover rollback plan. Keep the existing LXD snapshot.
7. If preflight passes, perform **Gold UAT-only** 4-service staged cutover through a reviewed guarded helper, check service stability, Wall auth/CSRF/interactive dialogs on /long-memory /codex-cli /processes, no native popup, and Memory/Codex regressions. Record actual ExecStart source after promotion. Roll back on failed health.
8. Windows client: provide CI artifact for owner manual install only when UAT passes; do not force install, alter Chrome, or touch production.
9. Only then review/merge PR #4 into the **Gold rebuild branch** if owner wants it and every required gate is green. Otherwise keep PR open and accurately list the blockers; do not call full acceptance PASS.
10. After Gold baseline acceptance, plan RM V2 optimization: explicit deny-reason error codes/logs, reconnect/transient drain recovery, PTY/ConPTY lifecycle, native FS allowed roots, durable jobs, signed terminal ACK and claim consistency, resource locks/worker budget, Real Remote V2 input/reporting. Then Web Distribution (signed release channels, downloads, update/rollback), then Admin (account/roles, device/team, release management, notices, portal dialogs and security).
11. Continue keeping support-ticket self-service guest links, Gold Memory and remote policy, Windows/macOS/Linux compatibility distinct from this PR; avoid scope creep.

## 11. Read-only commands and acceptance gates for next session
~~~bash
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/gold-memory-completion-20261026
git status --short --branch
git log -3 --oneline
git remote -v
node deploy/scripts/selftest-gold-no-native-browser-dialogs.mjs
node deploy/scripts/selftest-gold-client-core-imports.mjs
node deploy/scripts/selftest-gold-codex-coordinator.mjs
lxc list
lxc exec light-remote-gold-uat -- systemctl is-active light-remote-gold-wall
lxc exec light-remote-gold-uat -- systemctl show light-remote-gold-wall -p ExecStart --value
lxc exec light-remote-gold-uat -- runuser -u postgres -- psql -d light_remote_gold_dev -AtX -c "SELECT max(version) FROM lr_schema_migrations"
lxc exec light-remote-gold-uat -- runuser -u postgres -- psql -d light_remote_gold_dev -AtX -c "SELECT resource_mode,worker_state,count(*) FROM lr_gold_device_resource_claims GROUP BY resource_mode,worker_state"
~~~
- Treat any tool error target_node_draining as transient reconnect/draining; check job before retrying, stay on the same device/session and don't bypass A/B.
- The RM V2 and Gold connectors may each have independent authorization. One ready session does not authorize the other.
- Primary evidence for old Windows owner orphan process and safe owner recovery: docs/optimization/RDC_GOLD_M6_RESUME_INTEGRATED_20261023.md.
- PR parity immutable guard: deploy/scripts/verify-gold-core-parity.mjs, frozen baseline 30766940ac18e55cb735354b40a3af9ba37eddb8. Exact SHA pins are not a general wildcard allowlist.

## 12. Release-gate matrix at session handoff
| Gate | Status | Reason |
|---|---|---|
| Git worktree and handoff | PASS after this handoff is committed/pushed | Verify new SHA |
| PR #4 open, correct Gold base | PASS | No merge to main |
| Node syntax 551 JS | PASS | Static only |
| Gold Local Wall in-app dialogs | PASS source/Chromium fixture | Live UAT candidate not cutover |
| Gold G3 CI at f4a0607 | PASS | 6/6 |
| Windows CI at f4a0607 | PASS | Install on owner Windows not repeated |
| Native Gold Parity at d6b50db | PASS | Frozen hashes pinned; negative test PASS |
| Authorization/reconnect/concurrency 15 tests | PASS fixture/source | Physical multi-device remains |
| UAT candidate copied + seven runtime file hashes | PASS staging checks | .git-source-sha still old, secrets symlink missing |
| Gold UAT live service 4/4 | PASS *old* version | Running 371f1ce7, not latest |
| PostgreSQL orphan claim reconciliation | BLOCKED | 1 claim still running in PG, no signed terminal ACK; 10 retained UNKNOWN |
| UAT schema37 release script | BLOCKED | Existing M6 helper expects 35/36 and secrets symlink |
| Gold UAT new release cutover and browser live acceptance | NOT DONE | Worker safety gate and candidate provenance |
| PR #4 merge into Gold rebuild | HELD | Requires UAT physical gate/owner acceptance |
| RM optimization / Web Distribution / Admin | NOT STARTED | Intentionally deferred |

## 13. Avoid false continuity
- Never claim "audit complete, no bugs" based only on syntax + static tests.
- Never claim PR #4 merged unless GitHub confirms merged state.
- Never claim current Gold UAT runtime on d6b50db/f4a0607 until systemctl ExecStart and HTTP are observed.
- Never clear the old Windows process claim just to make the release gate green.
- Never replace or drop old handoffs/snapshots; append newer factual checkpoints.
- Preserve explicit authorization, owner security decisions, state machine semantics, signed receipts and local-first history.

**Resume priority: FIRST resolve the UAT owner orphan-claim and schema37 safe cutover, THEN review PR merge, THEN RM optimization and Web Distribution/Admin.**
