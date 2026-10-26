# Gold PR #4 continuation — schema 37 and orphan claim guarded release (2026-10-26)

This is an addendum to `RDC_GOLD_MASTER_HANDOFF_20261026_PR4_FINAL_AUDIT.md`, not a declaration of completed cutover.

## Verified live baseline (VPS-ARM, official Light Remote)
- Branch `feature/gold-memory-completion-20261026` was clean at `5c17a1a` before this change. GitHub PR #4 is open, unmerged, base `feature/light-remote-gold-rebuild-20261018`, 105 commits/141 files, no submitted reviews or review threads.
- Container `light-remote-gold-uat` is RUNNING. Four Gold services ACTIVE, each actually running `371f1ce786fa484b86a77a7272ce16e6591e2a99`, not PR #4.
- UAT PostgreSQL migration ledger: min=1, max=37, count=37, distinct=37. Version 035/036/037 files exist in feature source.
- Exactly one shared/running process claim created 2026-10-22: linked launch job `ok`, personal work `finished/ok`, no signed terminal ACK. Original Gold Windows device is revoked. The two currently outbound-ready Fleet leaves are fresh/idle and do NOT match this old claim's device or node identity.
- Ten preserved pre-dispatch UNKNOWN work tombstones (9 QUEUED_AGENT_SLOT, 1 RESOURCE_LOCKED) with `operator_restart_reconcile` and durable job status `interrupted`. Never reclassify or delete.
- Old f4a0607 staged candidate has the incorrect `.git-source-sha` marker `371f1ce7`. It is NOT usable for verified cutover. Existing snapshots remain intact.

## Reviewed source changes on PR branch
1. `deploy/scripts/gold-m6-uat-four-service-cutover.sh` now requires a contiguous schema **1–37** ledger plus candidate migrations 035/036/037; no migration is run by cutover. It requires both candidate dependency links to resolve to the same real installed dependencies as the currently active Wall source. It checks candidate secrets layout against live UAT and never invents or copies secrets. Original all-claims-active SQL gate, two executor-ready leaves, service idleness, backup checks, explicit apply opt-in, and rollback remain strict.
2. `deploy/scripts/gold-m6-owner-orphan-recovery-cli.mjs` is an **interactive, owner-operated UAT-only** private-UNIX-socket client for the *existing* Operator route. It selects exactly one live claim using read-only PostgreSQL, requires the owner's own observed Windows reboot timestamp after the claim, typed `ABANDON_UNKNOWN_RESULT`, interactive account login and second backend password verification. It makes NO SQL UPDATE/DELETE itself. Backend transaction must independently enforce account/device/job scope, fresh-channel denial, and atomic typed audit. The result is explicitly `unknown`, with no signed terminal ACK or fictional DONE.
3. Gold runtime `371f1ce7` already contains the guarded owner recovery route and `GoldDeviceResourceLocks.abandonOwnerAttestedOrphan` implementation. No Gold service was restarted to add the CLI.

## Verification performed
- `bash -n` cutover script and `node --check` owner CLI: PASS.
- `git diff --check`: PASS.
- Focused Gold owner orphan account auth/boot/rollback/no-fake-ACK, terminal replay, process stop, signed telemetry, Memory account delete, Wall no-native-browser-dialogs, and Windows core import closure: PASS on branch source.
- Live read-only PostgreSQL/Fleet inspection: PASS. Schema 37 validated; orphan claim remains **UNRESOLVED**, so current UAT release gate correctly remains BLOCKED.
- CLI has NOT been invoked with owner credentials. **Do not enter account password into ChatGPT or assistant calls.** Invoke only from the owner's own attached terminal inside Gold UAT if consciously approving audited UNKNOWN abandonment.

## Required next gates, in order
1. Commit/push exact reviewed source to PR #4; verify CI at that new SHA. Stage a byte-verified complete candidate at `/opt/light-remote-gold-uat-candidates/<full_SHA>` with a correct `.git-source-sha`, same shared module symlink targets as live UAT and no copied secrets. Take / verify checksum-protected UAT-only backup of four units, persisted PostgreSQL and supervisor journal. Preserve LXD snapshots.
2. Re-run strict **preflight only**. Expected until authenticated reconciliation: `M6_RETAINED_PRE_DISPATCH_UNKNOWN:10` and `M6_PG_WORK_BUSY:1`. Do not mutate SQL or modify the worker gate.
3. Owner-only orphan action: verify old Windows Gold Agent actually absent, boot observation after claim, and no fresh original Gold channel. Use owner-operated interactive CLI on Gold UAT; Operator re-verifies account/password and conditions and audits `processOutcome=unknown`. If it rejects or evidence is uncertain, STOP; do not bypass. Confirm one audit event, zero remaining active claims, zero forged ACKs, 10 UNKNOWN tombstones unchanged.
4. Only when fresh preflight reports zero active claims and two ready/idle leaves, deploy Gold **UAT-only** four services through reviewed opt-in helper; assert exact ExecStart candidate SHA on all four, stability/auth/CSRF/Memory/Codex/Wall dialog and signed ACK tests, and LXD rollback. No production restart, no Windows installation.
5. Recheck PR #4 reviews/checks and ask owner approval for merge into **Gold rebuild**, never main. If any gate incomplete, keep PR open.

**No UAT cutover, owner orphan release, PR merge, Windows installation, or production change is claimed in this checkpoint.**

## Late-session real UAT staging and gated preflight (after code commit b7718bf)
- Code/docs commit `b7718bf8713b441e3e67e0b8a879c502b572dd16` pushed to PR #4. GitHub Gold Native Wall Modules Parity run [40307485543](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40307485543) SUCCESS at the exact code commit. PR remained OPEN, base Gold rebuild, no reviews, no merge.
- Full tracked archive staged into isolated Gold UAT at `/opt/light-remote-gold-uat-candidates/b7718bf8713b441e3e67e0b8a879c502b572dd16`, correct `.git-source-sha` and complete SHA256 manifest verified. Only shared existing `node_modules` and `plugin-server/node_modules` symlinks added. No secrets link/file created. No installed service pointed to this source.
- New checksum-verified UAT-only release backup: `/var/backups/light-remote-gold-uat/pre-g3-b7718bf8713b441e3e67e0b8a879c502b572dd16` (four unit definitions and overrides, online consistent PostgreSQL custom dump, supervisor + Wall terminal journals, entrypoints, SHA256SUMS.txt). Existing snapshot `gold-before-ui-dialogs-f4a0607-20261026` confirmed still available.
- Executed new candidate helper INSIDE UAT with `GOLD_M6_SOURCE_SHA` only; no apply/opt-in flags: `M6_SCHEMA_37_LEDGER=PASS`, `M6_RETAINED_PRE_DISPATCH_UNKNOWN:10`, `M6_PG_WORK_BUSY:1`, exit 4. This is an expected safe refusal, NOT a release failure to bypass.
- Owner CLI non-interactive negative test inside UAT refused without a TTY. No credentials were provided or read; the claim count remained 1 and all four running services remained ACTIVE on 371f1ce7.
- **Actual owner action required before cutover:** from the owner's own SSH interactive terminal on VPS-ARM:
  `lxc exec light-remote-gold-uat -- node /opt/light-remote-gold-uat-candidates/b7718bf8713b441e3e67e0b8a879c502b572dd16/deploy/scripts/gold-m6-owner-orphan-recovery-cli.mjs`
  Verify real old Windows Gold Agent absent and provide a personally verified post-claim Windows boot time in UTC. The CLI prompts for Gold owner email, reason, exact typed acknowledgement and password without echo; it transmits credentials only to local Gold private socket. **Do not run through ChatGPT remote exec, paste password into chat, or call recovery automatically.** It can refuse if owner, exact device scope, boot or channel proof is not accepted.
- After approved owner recovery only: check durable audit event, claim count 0 and zero signed ACKs for the old process; verify pre-dispatch UNKNOWN 10 unchanged, rerun strict preflight. Subsequent UAT-only apply, physical Wall / Memory / Codex acceptance and PR merge are STILL PENDING.
- A later documentation-only commit may change PR HEAD while candidate b7718bf remains byte-verified for code. For any cutover, either pin explicit reviewed b7718bf or re-stage/backup the newest full source SHA; never falsely claim a candidate marker is current HEAD.
