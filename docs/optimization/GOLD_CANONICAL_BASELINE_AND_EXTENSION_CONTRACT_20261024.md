# Gold baseline lock — 2026-10-24

The owner requires ONE complete Gold, then optional Long Memory/Codex extensions.
No duplicate Wall, Account, Agent, Project Manager, LXD or new hosted service.

## Immutable accepted client reference
Windows #486 frozen source SHA: 30766940ac18e55cb735354b40a3af9ba37eddb8
Accepted Gold M6 source worktree HEAD ba579f8830a0654e8321204f17270db8d94c5593
contains the frozen client plus a documentation-only commit.
The 90-file Windows #486 Owner/CI acceptance includes filesystem owner
Read/Write roots, SCP permissions, nonblocking Wall, A/B and RM frame.
It does NOT establish full M6/backend/Fleet, all RM input modes or other OS parity.

## Mandatory gate
Stage packages FROM COMMITTED GIT SOURCE, never copy an old running UAT
into the canonical source. Run stage-client-core, --verify and then
verify-gold-core-parity.mjs on the SAME staged package.
Mode exact: all 90 files must match frozen Gold bytes.
Mode extension: only three explicit entrypoints may differ (local-wall,
operator-agent, device-duplex-client); all remaining frozen files must match.
The checker enforces owner roots UI/API, FS policy hookup, SCP policy
revalidation, A/B countdown, bounded Wall latency and cached Windows
capability scans. These are a fail-closed guard, NOT final acceptance.

Never say 90/102-file self-generated manifest hash equals Gold feature parity.
Actual UAT must prove owner permissions, Files/Search/SCP including deny paths,
A/B, RM, PTY, Fleet, Account and PostgreSQL state. Preserve UNKNOWN work
and resource claims without fabricated ACKs. Browser/client proof is required.

## Binding Continuity scope
Long Memory: local CLIENT SQLite, persistent across ChatGPT Web sessions
when the owner enables and authorizes separate read/write; sourced bounded
checkpoints and observed receipts, never capture hidden chat content.
No mandatory Project; no cloud raw Memory persistence.
Codex Bridge: optional read-only observer/coordinator of local Controller
tasks and receipts. It works alone without Memory. It must not execute,
autoapprove, inject ChatGPT turns or bypass platform session limits.
Both OFF means unchanged Gold. Both ON may cooperate subject to consent.
Real ChatGPT session A -> B and real Codex user auth are OPEN, not mocked PASS.
No installer/production rollout until those gates and Gold parity pass.

## Current status
Source-lock/checker only. Gold M6 UAT remains blocked by an unverified
resource claim and 10 historical unfinished records (observed 2026-10-24).
The active Continuity hybrid UAT is NOT a Gold-approved source.

## Evidence obtained in this audit session (2026-10-24)
- Exact frozen Gold package staged from Git on VPS-ARM:
  /tmp/light-remote-gold-486-verified-core-20261024/
  manifest SHA-256 digest fc5f4d1718e8d5061888bdd52d4a7af8f440090680ed2380751bc971a55050d2,
  90 files. stage-client-core verify PASS, immutable parity PASS, packaged
  icons 39/39 and Wall /, /permissions, /approve, /settings PASS.
- 12 focused owner filesystem, nonblocking Wall, permissions, SCP, Native FS,
  package parity, M6 terminal, Device Remove and orphan-recovery source
  regressions PASS on Gold #486 source; packaged Wall was separately checked
  with the required staged-root argument and PASSED. These are tests, not
  a new physical Windows acceptance.
- Exact 90-file Gold package was copied to the SAME Gold UAT LXD without
  activation, at /opt/light-remote-gold-uat-verified-486-20261024/ .
  Inside THAT LXD, all 90 files verified against the pinned digest, and an
  ephemeral loopback Local Wall rendered filesystem read/write UI and /api/status.
  Six ORIGINAL Gold services remained active and untouched. The candidate
  is STAGED, NOT installed as the active Gold device service.
- Continuity feature source 834d498 was separately staged in /tmp as 102
  files, confirmed 90 frozen Gold files intact except three approved additive
  entrypoints, and 9 focused source tests PASS. It still contains a separate
  /projects HTML UI and is NOT accepted as a Gold-native user experience;
  live ChatGPT A/B and Codex are OPEN.
- Actual active LXD candidate's 103 extracted files failed the NEW gate at
  GOLD_PARITY_REGRESSION:device-agent/wall-status-cache.mjs. Prior deep
  source comparison found 8 of 90 Gold files differing, including
  filesystem/SCP/capability-cache regressions. Thus live UAT remains INVALID
  as a canonical Gold candidate even though 102/102 checksums matched its
  own self-produced manifest.
- PostgreSQL schema max 35; 1 unreconciled device resource claim and 10
  unfinished historical items. No SQL writes, fake ACK, claim cleanup,
  credential reset, service switchover, UAT restore or production modification.
- The official M6 four-service preflight requires no active claims, plus two
  fresh ready Gold leaves. Those requirements have NOT been established,
  so four-service cutover and promotion are BLOCKED.

## Next mandatory bounded sequence
1. Keep frozen source Gold package immutable. Do not deploy the active hybrid
   over it. Confirm GitHub CI for baseline lock separately; do not invent PASS.
2. Resolve real Gold M6/PG native claim via signed exit receipt or approved
   owner-attested orphan action, retaining UNKNOWN semantics; ensure healthy
   permitted Gold leaves, then pass actual M6 preflight.
3. Build one coherent Operator/Plugin/Agent/Supervisor deployment from one
   verified Git SHA and prove DB migration/data preservation/permissions,
   Files/Search/SCP, A/B, PTY, RM, Fleet, Account on real Gold UAT.
   Revalidate installed bytes and rollback; never 3-way merge from the running
   old UAT as source.
4. ONLY then add independent Long Memory and Codex Observer to THAT base.
   Remove the separately styled Projects-first page as the module entrypoint,
   preserve all original Gold surfaces, and run actual ChatGPT Session A -> B
   via the newly registered official Gold connector with owner authorization.
5. Codex app-server needs real owner-authorized runtime evidence and cannot
   claim ChatGPT Web auto-continuation without a supported official hook.
6. Keep release BLOCKED until these real acceptance gates are met.
