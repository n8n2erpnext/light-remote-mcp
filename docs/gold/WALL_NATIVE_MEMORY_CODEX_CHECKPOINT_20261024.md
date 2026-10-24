# Gold Wall optional modules — first native implementation checkpoint (2026-10-24)

The official immutable restore point is
gold-restore-before-memory-codex-20261024 -> ba579f8830a0654e8321204f17270db8d94c5593
(owner Windows build #486 source 30766940ac18e55cb735354b40a3af9ba37eddb8).

This new code is developed in feature/gold-m6-integrated-20261023, the SAME
Gold branch. No special Continuity branch, no second Account, independent
Wall/port, separate Project page or other LXD. It is newly authored from
Gold Core source. Never import the old project-continuity-* code into it.

Added:
- device-agent/gold-wall-modules.mjs: local lazy SQLite for two independent
  optional flags, attributed notes, and deterministic owner task-state ledger.
- Native collapsible controls embedded directly in canonical Wall /
  by modifying local-wall.mjs, using the existing authenticated owner cookie
  and CSRF check. Original /permissions, filesystem roots, PTY, Fleet,
  A/B grant countdown, SCP and Real Remote routes are preserved.
- Embedded same-process Gold Agent wiring in daemon and wall-only modes.
  No additional process, listener, database in Gold cloud, or Project.
- Gold Client Core 91-file manifest; fail-closed immutable #486 byte parity
  gate against frozen Git (allows changes ONLY in original Wall and Agent
  extension entrypoints and requires original sensitive FS/SCP/inventory code).
- End-to-end local UI/API test: existing owner auth and CSRF, rejects
  invalid/stale writes, memory-only, observer-only, both, neither, SQLite
  restart, unattributed notes rejected; existing Gold UI markers retained.

Existing Gold UAT is the owner-authorized sole test instance. The restore
point must remain byte-identical and untouched. Never alter production/Windows.
Use one same-Gold UAT source candidate from a single committed revision and
validate installed source checksum before a guarded UAT cutover.

Remaining OPEN, must never claim functional completion:
1. Remote source-labeled **signed** checkpoint submit and bounded read across
   genuine Gold ChatGPT Web Session A -> B, with per-owner consent and device
   account A/B binding. Hidden Web context cannot be read by Plugin.
2. Actually connect to authorized Codex runtime in observer-only mode;
   current recommendation is local deterministic Task Controller, NOT Codex.
3. Official supported ChatGPT Web auto-continuation is unproven; do not inject
   messages or pretend it works. Owner-directed continuation fallback only.
4. Native Windows #486 physical updater/FS/A-B/RM parity after integrating
   new binary, and macOS/Linux Server/Desktop parity.
5. Full backend M6 reconciliation (one unverified historical resource claim,
   ten unfinished records) and real browser owner acceptance.

Feature flags OFF/OFF must be inert (SQLite unopened/no local write) and
not interrupt Gold operations. This checkpoint is NOT a release approval.
