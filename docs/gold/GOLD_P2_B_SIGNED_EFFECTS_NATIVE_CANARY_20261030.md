# Gold P2-B — Signed effects, historical claims, native Windows canary
2026-10-30 (Asia/Ho_Chi_Minh)

**Status: READ-ONLY RECEIPT; LIVE CUTOVER HOLD.**

## Source and query
- `deploy/scripts/gold-p2b-unknown-claim-audit.sql` runs
  `BEGIN READ ONLY`, aggregates by evidence category and exposes no
  account, device, job, process or signed receipt values.
- `lib/gold-p2b-signed-quiescence.mjs` checks the aggregate accounting
  and returns a conservative blocked state, `modifiedRows=0`,
  `signedQuiescenceProven=false`, `releaseAllowed=false`.
- `deploy/scripts/selftest-gold-p2b-signed-quiescence.mjs` tests
  missing/inconsistent evidence, no auto-release even for zero rows,
  ack-not-equal-to-signed-proof, privacy of output and read-only SQL.
- These are **auditing tools**, not claim release, SQL041 activation,
  a signature verifier, or owner approval.

## Real Gold UAT read-only SQL observations
Ran the SQL on LXD `light-remote-gold-uat` with
`psql -qAtX -v ON_ERROR_STOP=1`. Results:

| Evidence key | Observed |
| --- | ---: |
| unknownTotal | 27 |
| retainedPreDispatch | 26 |
| unresolvedUnknown | 1 |
| startedUnknown | 1 |
| unknownWithClaims | 0 |
| foreignClaims | 1 |
| runningClaims | 1 |
| claimsWithoutTerminalAck | 1 |
| claimsWithProcessId | 1 |
| terminalAckMatches | 0 |

The 26 retained pre-dispatch records satisfy **all** these conditions:
`started_at IS NULL`, queue reason in
`QUEUED_AGENT_SLOT/RESOURCE_LOCKED`, disposition
`operator_restart_reconcile`, durable job `interrupted`,
and **no matching M4 resource claim**. They are historic tombstones, not
proofs of no activity and **must not be silently deleted**.

The 27th unknown row has a nonnull `started_at`, lacks valid
pre-dispatch criteria, and requires exact job-level signed terminal
evidence or owner-reviewed recovery. The independent single resource
claim has a process identity and `worker_state=running` with zero
matching terminal acknowledgments. Its age and the absence of currently
queued/running jobs do **not** authorize release. No claim or work row
was modified.

## Cryptographic and migration boundary
`lib/gold-reconnect-proof.mjs` explicitly says initial reconnect
contract is source-only unless wired to a real Agent/server path. Its
`classifyReconnectFence` deliberately returns
`await_exact_terminal_receipt` for terminal inventory states without
the corresponding exact signed terminal ACK. Missing processes in an
incomplete inventory never prove termination.

Gold UAT currently runs schema039. SQL041's execution-epoch /
device-inventory tables are not part of the live schema; the existing
source tests and the isolated schema042 rehearsal are **not live
signature evidence**. Preserve M4 claim and unknown rows until valid
device-authenticated, challenge-bound inventory + matching terminal
receipt, or explicitly approved owner recovery proves the effect is
over. No fabricated ACK, force-kill or forced claim deletion.

## Windows 10 native read-only inspection
Official connected Light Remote Gold device `DESKTOP-VA16D27`:
- Windows 10 Home Single Language 19045.
- Installed program: Light Remote MCP `0.9.0-rc.49`.
- Scheduled task `LightRemoteDeviceAgent` is Running and invokes
  `GptOperator.Client.exe`; `LightRemoteUpdater` is Ready and its
  last task result was 0 at the observation time.
- Both executable files existed; file version 0.9.0.0. Windows
  Authenticode status for both was **NotSigned**.
- **Authenticode** checks executable publisher signatures. It is
  not the Gold protocol's device key, execution epoch, challenge-bound
  reconnect inventory or signed terminal receipt. Do not conflate them.
- No reboot, installer upgrade, signed OS-effect probe, job launch or
  device policy change was made to this Windows machine.
- A separately confirmed, authorized Windows 11 canary has **not**
  been tested during this task.

## Current HOLD and next steps
1. Implement or audit live Gold native signed execution inventory and
   exact terminal receipt pathway against real authorized Win10/Win11
   Agent, with non-privileged canary jobs and idempotent replay testing.
2. Prove device scope, challenge, signature, monotonic execution epoch
   and matching process/finishedAt; leave unknown/claim unresolved
   until exact signed proof exists.
3. Verify installer signature policy and decide whether Authenticode
   signing is a release requirement. This read-only finding does not
   itself prove the updater or executable is malicious.
4. Review native Agent log/source and Fleet Wall 5492 separately;
   do not infer complete end-to-end acceptance from a Running task.
5. Continue to require fresh backup/snapshot, explicit device
   allowlist and owner approval **before any live** Gold UAT 039→042,
   four-service restart, GC activation or production promotion.

The isolated P2-B success- and failure-path cutover/rollback rehearsals
remain PASS, but these **signed effects and native canary gates are
still HOLD**.

## Reproducible safe receipt

The source-only CLI `deploy/scripts/gold-p2b-audit-report.mjs` accepts
only bounded, anonymous JSON aggregates on stdin. It outputs an
allowlist of numeric counts and blockers without echoing unknown input,
and returns exit status **4 intentionally** for HOLD (5 for invalid
input). It has no network/DB connection and never authorizes release.

The aggregate query ran successfully against actual live Gold UAT:
`BEGIN READ ONLY` / `COMMIT`, zero data changes. The combined
SQL → CLI result was `classification=HOLD`,
`retainedPreDispatch=26`, `unresolvedUnknown=1`,
`foreignClaims=1`, `claimsWithoutTerminalAck=1`,
`releaseAllowed=false`, `modifiedRows=0`. Source regression:
`GOLD_P2B_SIGNED_QUIESCENCE_HOLD_AND_PRIVACY=PASS`.

The read-only SQL is deliberately separate from `apply-gold-db.mjs`;
never call the migration runner to obtain evidence. A known schema039
database cannot produce a schema041 execution epoch by inference.
