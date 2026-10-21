# Gold M4 — Download/build resource intent and authentic multi-Agent gate

Date: 2026-10-21. Baseline: [M4 background worker lease, Gold UAT](./RDC_GOLD_M4_BACKGROUND_WORKER_RESOURCE_LEASE_20261021.md). Plan: [Pro personal vs Pro Team](./RDC_GOLD_MULTI_AGENT_PRO_TEAM_COMPATIBILITY_20261021.md).

## Source defect and fix
Previously `curl` and `wget` could be assigned a shared `download:<cwd>` key, which did not conflict with the exclusive `project:<cwd>` keys held by builds or `file-dir:<cwd>` keys held by filesystem edits. Because M4.1 retains resource locks across running managed processes, such a mismatch can cause concurrent writers despite long worker leases.

The new intent classifier conservatively uses **exclusive** `project:<cwd>` for a simple `curl/wget` write to its current workspace. Recognizable absolute `-o/--output/-O/--output-document` destinations instead take exclusive `file-dir:<destination-parent>`; path ancestry makes them conflict with builds touching that destination. Ambiguous output flags, pipelines, redirection, embedded command chains or unknown workspace take a **device-wide filesystem unknown** exclusive intent; no privilege is inferred. Distinct known workspace projects are still independently schedulable subject to the device worker budget. Workload classification is advisory; it does not grant filesystem rights or validate downloaded artifacts.

The schema and plan quotas remain unchanged (PG migration 034; Free 1 active Agent, Pro 3; M4 worker admission default 2/device). Owner controls `stop`, `cancel`, `status`, and `output` remain outside Agent execution admission. No cross-account Pro Team enablement.

**Limit:** lexical shell text does not reliably reveal all filesystem effects, symlink/junction real paths, environment substitutions, or shell aliases. This fix prevents the demonstrated key-class collision for straightforward download commands but is **not** full OS path isolation or sandboxing. Device-local trusted canonical path checks and resource enforcement remain future M4 gates.

## Actual four independent Pro Agent identities
Official `light-remote-gold` `open_session` called repeatedly on the already A/B-approved Linux Gold device returns/reuses the **same signed MCP session**; four calls are not four independent Agent identities. We **must not** forge `agentId` on the Wire or count four manually labeled sessions as an end-to-end concurrency PASS.

Use the dedicated PostgreSQL fixture to verify four distinct *synthetic* verified-format identities under Pro 3+fourth queued; separately obtain four truly independent OAuth MCP clients with owner-approved A/B grants, then test 3 active foreground bounded jobs on three distinct workspaces and a fourth queued with `QUEUED_AGENT_SLOT` (avoid worker-budget=2 confound by using zero-worker read jobs or 3 distinct devices). Verify fourth promotes after slot release, stable principal/Agent IDs in PG, complete receipt and no false `drain`. Only the second step qualifies for real multi-Agent acceptance. RM may be used to launch the clients but cannot create legitimate extra identities simply by opening sessions of one connector.

## Gates
Source policy and CI tests, isolated Gold UAT multi-account PostgreSQL contention fixture for download-vs-build with no network downloads, immutable staged candidate and verified backup before guarded cutover; then a bounded owner-authorized real MCP process+exec test without fetching large external files. Pro Team owner metering remains unchanged. Never run on production.

## Actual source / PostgreSQL / Gold MCP UAT results — 2026-10-21

- Source commit [`371a39d5f6a0de67c59d98271acc521f865ba947`](https://github.com/n8n2erpnext/light-remote-mcp/commit/371a39d5f6a0de67c59d98271acc521f865ba947): download resource-classifier fix, CLI-only tests. The second commit [`4934fa54c05efebf9a329956f763d34d96d4b486`](https://github.com/n8n2erpnext/light-remote-mcp/commit/4934fa54c05efebf9a329956f763d34d96d4b486) adds the isolated Pro-3+1-with-M4 fixture. Gold Operator CI runs [39633770605](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39633770605) and [39634176828](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39634176828) both **SUCCESS**. No database schema migration beyond 034 and no Windows/macOS installed-client changes.
- Immutable Gold candidate `4934fa5` staged with package-lock parity PASS and independent pre-G3 backup code/systemd/local-state/`pg_dump` verified at `/var/backups/light-remote-gold-uat/pre-g3-4934fa54c05efebf9a329956f763d34d96d4b486/`. Guarded cutover PASS, 10/10 health samples PASS, strict ON. Final Operator active exact source `4934fa5`. Two Gold UAT leaves ready, no queued/in-flight/drain; 6/6 services active, all test sessions closed.
- Physical PostgreSQL fixture `selftest-gold-m4-download-resource-pg.mjs` run as unprivileged `gold-uat` against real schema034 with app-only DB credentials **4/4 PASS**:
  - `M4_WGET_BUILD_SAME_PROJECT_RESOURCE_LOCKED`
  - `M4_CURL_ABSOLUTE_OUTPUT_CONFLICTS_WITH_WORKSPACE`
  - `M4_DOWNLOAD_AND_UNRELATED_BUILD_PARALLEL`
  - `M4_DOWNLOAD_RESOURCE_LOCK_RELEASE_QUEUE_PROMOTION`.
  Synthetic fixture accounts/device IDs were randomized and cleaned; no network transfers were performed by this test.
- Physical PostgreSQL fixture `selftest-gold-m3-pro-3plus1-device.mjs` run against the *M4-enabled* schema (workerWeight=0 to isolate Agent entitlement from the device worker budget) **3/3 PASS**:
  - `M3_PRO_THREE_DISTINCT_FIXTURE_AGENTS_ACTIVE_FOURTH_QUEUED`
  - `M3_PRO_FOURTH_PROMOTED_AFTER_AGENT_RELEASE_NO_DRAIN`
  - `M3_PRO_3PLUS1_RESOURCE_CLAIMS_CLEAN`.
  **These are synthetic IDs in a real database, not four actual independently approved MCP clients.** Opening four Gold `open_session` calls with the same connected plugin reused the same signed session; do not count as real multi-client acceptance.
- Gold MCP physical `curl` download from a short-lived 127.0.0.1 fixture could **NOT** be accepted: Device Agent denied `network` capability (`local capability denied: network`, surfaced as 500/`operation_failed`). The agent's local policy was **not relaxed**, and we did not drop the network capability to evade it. The lock-collision fix is proven by real PG, but a physical network download under Gold UAT remains unproven until a separately authorized network-capable test device is used.
- OS namespace observation: Gold Wall and M5 Supervisor both have `PrivateTmp=yes`; they do **not** necessarily share file fixtures under `/tmp`. A managed process start pointing to a directory created from the Wall's private `/tmp` failed with `ENOENT`. A privately owned fixture directory under `/var/lib/light-remote-gold-uat` was created without changing systemd isolation; loopback HTTP server was started and then stopped cleanly. Shared directory and both private `/tmp` fixtures were deleted after confirmation; no real user directories altered.
- **Permission / block taxonomy findings:** `local capability denied: network` is a correct policy decision but the `HTTP 500 operation_failed` wrapper is misleading; it should map to an explicit policy-denied status (normally 403) and proper originating layer. `ENOENT` from cross-service `PrivateTmp` is an OS namespace/path mismatch, not random Agent blocking. Do not merge these with earlier transient tool-layer refusals.
- Production, Gold billing, Pro Team cross-account, Windows/macOS installed client, device capability allowlists and owner A/B approvals remain unchanged.

## Remaining acceptance steps

The actual 3-Pro + fourth queued requires four independent MCP client principals, each owner A/B-approved for the same explicitly allowed Gold UAT device. The same plugin's repeated sessions cannot manufacture four identities. Once clients are available, use short read-only/workerWeight=0 jobs to isolate Pro slot 3 from M4 device budget 2; inspect signed actor/Agent IDs, PG `QUEUED_AGENT_SLOT`, no false `drain`, fourth promotion and cancellation. Avoid testing using a live production owner Team seat or silently borrowing Team member entitlement. The separate device-local `realpath`/symlink/junction, file CAS, desktop input lock, and OS resource budget remain open.
