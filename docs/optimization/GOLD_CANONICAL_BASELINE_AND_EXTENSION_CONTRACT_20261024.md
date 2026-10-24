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
