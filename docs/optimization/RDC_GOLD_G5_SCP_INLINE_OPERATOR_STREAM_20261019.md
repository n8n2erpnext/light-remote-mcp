# Gold G5 — SCP inline progress in Live Operator Stream (2026-10-19)

**Current Gold UI implementation; supersedes the standalone G5 SCP Transfers panel introduced in commit `83ab3da`. G5 NOT fully accepted. Production unchanged.**

## Explicit owner UX decision
Owner screenshot: standalone `SCP Transfers · Device Agent` bar/cards above `LIVE OPERATOR STREAM` cluttered the Wall. Instead show a minimal terminal-style string *in the same SCP job row*, directly next to `scp.download-chunk ... chunk 3`. No dashboard box, no colored progress bar, and no separate progress polling. Desired form: `[############----] 75% · 192 KB / 256 KB · 3/4 chunks`.

## Implementation
- `device-agent/local-wall.mjs`: removed the SCP panel HTML, CSS, status row renderer, client polling, and its `/api/scp/transfers` endpoint. Preserved and did not modify the separate authenticated PTY Viewer.
- `lib/light-scp-registry.mjs`: reverted pilot-only bounded in-memory Wall snapshot cache. Canonical transfer owner authorization/byte/hash/commit APIs are unchanged.
- `device-agent/operator-agent.mjs`: removed G5 Wall snapshot callback, both daemon paths. For each successful `download-chunk`, return an **additive** `transfer` metadata object alongside original `chunk` data using the existing owner-scoped `LIGHT_SCP.status()`. This makes its per-job `resultSummary` include **actual accumulated** bytes/chunks; upload-chunk and upload-begin already had counters.
- `operator-host/executor.mjs`: the matching local/integrated-host `download-chunk` result also includes additive `transfer` status for consistency.
- `device-agent/local-wall.mjs::scpInlineProgress(j)`: parses **the exact job's** sanitized, bounded `resultSummary` for `progressBytes/totalBytes` and chunk count, requires integers and valid bounds, renders inline ASCII `[################]` width 16 and `NN%` in existing monospaced Wall style. No UI state/transfer snapshot polling, no background SCP data requests.
- Upload 100% before commit labeled `awaiting commit`; verified successful `upload-commit` labeled `SHA-256 verified`. Download 100% labeled `served · receiver unconfirmed` (never claims receiver disk persistence). Missing counter metadata on pre-patch job/history displays original summary instead of guessed percent. Error/timeout rows never get a misleading successful progress string.
- Existing agent/fleet authorization, SHA-256 integrity, PostgreSQL/Redis business stores, session filtering and copy/log semantics unchanged.

## Test evidence
1. Previous real Gold SCP backend on 256 KiB ASCII-A test data: upload and download both passed 4×64 KiB/25→50→75→100%, atomic upload SHA-256 commit and byte/hash equality.
2. New `deploy/scripts/selftest-g5-scp-inline-progress.mjs`: authenticated Chromium fixture Wall exercising actual `operator-host/executor-native-activity.mjs` formatting into job_started/job_finished events, inline 0/50/75/100 and commit label, download 75/100 actual summary, no separate panel/polling, historical row remains own percent after later operations, old uninstrumented download row left unguessed, failed event not falsely marked 100%, page reload retains activity. PASS.
3. `selftest-v10-light-scp-owner.mjs`, `selftest-v10-light-scp-file.mjs`, `selftest-v10-light-scp-routing.mjs`, `selftest-g2-wall-pty-floating-widget.mjs`, `selftest-v09-local-wall-auth.mjs`: PASS; syntax checks and `git diff --check` PASS.
4. Gold-only LXD: four updated source files (`local-wall.mjs`, `operator-agent.mjs`, `executor.mjs`, `light-scp-registry.mjs`) pushed to the separate `light-remote-gold-uat`; per-file SHA-256 matched; Gold Wall and Operator restart requested. Health 5/5 PostgreSQL/Redis/Operator/Plugin/Wall ACTIVE, NetBird Wall redirects to login 303, Gold Preview 200, production 200.
5. **Post-deployment real Gold MCP test:** created new 256 KiB SCP upload to an allowed writable `/tmp` fixture, four 64 KiB upload chunks returned 25/50/75/100%, SHA-256 commit verified; download from new file returned 4 matching binary chunks and each `download-chunk` response carried `transfer.progressBytes` 65536/131072/196608/262144 and `totalBytes=262144`, proving actual metadata for inline renderer. This does not replace logged-in owner browser acceptance.

## Remaining and risks
- This is a **per-job terminal-style progress line** displayed on job_finished. It is not a standalone continuous global progress bar. For large transfers users can see each chunk/status job as it finishes; a long single chunk itself does not expose fractional intra-chunk %.
- Pre-patch download history may lack accumulated bytes, so no fabricated percentage. Out-of-order or duplicate chunks use server-returned actual progress, **never** index-derived percentage.
- Owner visual check on authenticated Gold Wall remains pending. Hard-refresh `http://100.94.184.141:5591/`; no SCP panel at top. New SCP row output should appear next to chunk N.
- G5 acceptance still needs slow transfers, concurrent transfers, expiry/reconnect, failure/cancel, cross-host/OS coverage and long soak; keep master sequence G2→G3→G4→G5→G6.
- Keep G1 unexplained tool refusals `UNRESOLVED` without guessing upstream cause. Preserve unrelated untracked UAT fixtures, do not touch production.

## Resume
Read `docs/optimization/RDC_HANDOFF_CURRENT.md` and `docs/optimization/RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md`. This checkpoint **supersedes** `RDC_GOLD_G5_SCP_WALL_PROGRESS_PILOT_20261019.md` for UI. Do not reintroduce its standalone SCP Transfers panel.
