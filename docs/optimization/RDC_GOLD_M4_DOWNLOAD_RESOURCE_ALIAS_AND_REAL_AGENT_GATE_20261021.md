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
