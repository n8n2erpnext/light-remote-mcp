# Gold PR #4 / Audit: RESUME FIRST (2026-10-26)

Read [the full current master handoff](./RDC_GOLD_MASTER_HANDOFF_20261026_PR4_FINAL_AUDIT.md) **before any remote operation**. This short pointer is not a substitute for the 22 KB master handoff.

- Work in `feature/gold-memory-completion-20261026` on VPS-ARM only, through official `@light-remote` pairing.
- PR #4 is open against `feature/light-remote-gold-rebuild-20261018`, not production.
- G3, Windows and Gold Native Wall Parity CI passed for audited code, but live Gold UAT is still running earlier `371f1ce7`.
- Preserve the LXD `gold-before-ui-dialogs-f4a0607-20261026` snapshot.
- Blocker: one old Windows Gold resource claim remains `running` in PostgreSQL, despite its job `finished/ok`; **no signed terminal ACK**. Ten never-dispatched UNKNOWN tombstones are intentionally retained. Do not release by hand, invent ACK, or restart four services with active claim.
- Candidate `f4a0607` seven files match Git SHA-256, but its `.git-source-sha` marker is stale. UAT schema is 37; older M6 helper expects 35/36 and candidate secrets symlink. Correct these only through a reviewed guarded staging/cutover path after worker gate is legitimately clear.
- After UAT acceptance, review Gold-only PR merge, then tackle RM reliability, Web Distribution and Admin.
