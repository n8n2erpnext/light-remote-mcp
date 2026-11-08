# Gold G5 — SCP Upload/Download Wall Progress Pilot (2026-10-19)

## Status and scope
- Owner asked to test whether upload/download **percentages are displayed on Wall**, saying it had been done in a prior session.
- Starting HEAD: `1f859a3`, branch `feature/light-remote-gold-rebuild-20261018`.
- The Master Plan explicitly said G5 progress was **proposed, not implemented**; only `lib/light-scp-file.mjs::_view()` counters existed. No SCP transfer progress view was found in Gold Wall prior to this slice.
- This checkpoint implements an **isolated, reversible Gold-only G5 UI pilot** while G2 is still in progress. **Do not mark all of G5 complete**; no public production change, no new authority, storage engine, SCP transfer backend, JSON snapshot, or bypass of controls.

## Source
1. `lib/light-scp-registry.mjs`: preserve existing owner-bound upload/download API, add bounded in-memory transfer summaries sourced from real `progressBytes/totalBytes/progressChunks/totalChunks`. Latest 48 transfer summaries retained for up to ten minutes; source paths, data, owner credentials and raw SHA values omitted. Phases: preparing, transferring, verifying (100% received upload but not committed), completed (SHA verified + committed), served (all download bytes served; NOT receiver persistence), failed/cancelled.
2. `device-agent/operator-agent.mjs`: expose `getLocalScpTransfers` callback into authenticated local Wall from the same Device Agent's `LIGHT_SCP` registry. Agent-local transfers only; Operator-only registry unsupported, deliberately not invented.
3. `device-agent/local-wall.mjs`: add authenticated read-only GET `/api/scp/transfers`, with `scope=device_agent_local`, bounded to 48 rows, 401 when not signed in (403 for deployments with Wall login disabled); add SCP Transfers cards above Live Operator Stream with real percentage and byte/chunk counts. Browser polls every 2.5s only when visible. Session tabs filter by owning session; no transfer data in HTML/SSE stream, no exposed paths/hashes/credentials. No privilege/CSRF mutation endpoints added.
4. New `deploy/scripts/selftest-g5-scp-wall-progress.mjs`: real file registry upload 4×64 KiB with 25/50/75/100% progression, SHA-256 commit, download progress, cancel and semantics; Chromium authenticated local Wall card/render/auth/privacy/reload tests.

## Real Gold MCP evidence, before patch
- Test input: 262,144 bytes of ASCII `A`, SHA-256 `97a2fc5541dcc9c06b99b2a84c34961fa0c3af20dba3968df2f96a56c6bc00c9`.
- First destination inside `/opt/light-remote-gold-uat` rejected with **EACCES**, because Gold Agent runs as `gold-uat` and cannot write to deployment directory. Retried with the legitimately writable and allowed `/tmp` test-only destination; **no chmod, sudo or policy bypass**.
- Gold signed MCP upload, four 65,536-byte chunks: status 25→50→75→100%; `upload-commit` passed full-file SHA-256 and atomic rename.
- Gold signed MCP download of same file: 0→25→50→75→100%; all four downloaded chunk base64url bodies matched exact source, per-chunk hash matched; full-file hash matched upload.
- At this point backend counters were proven; **Wall UI percentages had not yet been implemented**.

## Gold-only deployment and post-patch acceptance
- Copied three source files to `light-remote-gold-uat` with `gold-uat` ownership and restarted only `light-remote-gold-wall` (this systemd service runs the Device Agent + Local Wall in one process).
- Initial restart job timed out with exit code 124 while service was deactivating. Follow-up read-only checks confirmed all three files' SHA-256 matched source, and Gold Wall subsequently reached `active/running`. Do not interpret timed-out restart as clean startup without the separate health verification.
- 5/5 services PostgreSQL/Redis/Operator/Plugin/Wall active; NetBird Gold Wall `http://100.94.184.141:5591/` returns 303 login redirect; unauthenticated `/api/scp/transfers` 401; Gold Preview account HTTPS 200; production HTTPS 200.
- **After restart**, Gold MCP upload a new 256 KiB file under `/tmp`, observed true backend status 25/50/75/100, completed SHA-256 commit; Gold MCP download returned 4 matching chunks and status 25/50/75/100. Both are now available as recent summaries in the Gold Wall process until in-memory history expires.
- Tests PASS: `selftest-g5-scp-wall-progress.mjs`, `selftest-v10-light-scp-owner.mjs`, `selftest-v10-light-scp-file.mjs`, `selftest-v10-light-scp-routing.mjs`, `selftest-g2-wall-pty-floating-widget.mjs`, `selftest-v09-local-wall-auth.mjs`, syntax checks and `git diff --check`.
- The **authenticated Chromium UI test was on a local fixture Wall**, not the owner's actual signed-in Gold browser session. Owner manual visual acceptance of the live Gold Wall percentages is still pending. Do not count backend results as browser proof.

## G5 remaining gates
- Current implementation is a bounded 2.5-second authenticated snapshot **polling pilot**, not throttled SSE delta events; extend to event push/fallback only with measured need and security review.
- Cross-host/Operator-local SCP progress remains unsupported on this Device Agent-local Wall. Do not conflate transfers originating in Operator-only registry.
- Still test concurrent transfers, slow/large uploads (10MiB+), out-of-order and duplicate chunks, wrong owner/invalid hash with UI statuses, network reconnect midtransfer, stale detection/restart semantics, browser login owner acceptance and NetBird outage. No automatic retries/unsafe overwrites.
- Keep G1 unknown pre-dispatch refusals in `RDC_G1_UNRESOLVED_REFUSALS_20261019.md` nonblocking. G2 remains IN PROGRESS; follow Gold Master Plan sequentially G3→G4→G5→G6 for full release acceptance.

## Handoff
Read `docs/optimization/RDC_HANDOFF_CURRENT.md`, `RDC_LIGHT_REMOTE_GOLD_MASTER_PLAN.md`, and this checkpoint. Preserve unrelated preexisting untracked UAT files. If testing after history TTL or Agent restart, create a new authorized test-only SCP transfer; do not claim older counters persist across Agent restart.
