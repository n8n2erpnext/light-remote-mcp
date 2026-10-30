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

## P2-B real native Windows 10 offline signed-boundary canary

The additional test `deploy/scripts/selftest-gold-p2b-native-signed-boundary.mjs`
runs against the actual production-source modules, with an ephemeral
Ed25519 test issuer/device key pair and **one disposable OS child**.
There is no Gold UAT HTTP request, no real device enrollment/key,
no claim manipulation, no permanent Agent file change and no fake
terminal ACK inserted into PostgreSQL.

Linux/ARM direct source execution PASS:
- Real OS process reached `finished`; durable journal survived restart
  with exact native start identity.
- Duplicate command returned a previously reserved row without another
  OS side effect.
- Challenge-bound signed inventory verified with device test key;
  wrong challenge, different device and stale execution epoch denied.
- Missing legacy inventory was explicitly `complete=false`.
- Device-spooled terminal receipt persisted through journal reload;
  mismatched `finishedAt` and state refused; exact local ACK was
  idempotent, including duplicate replay.
- Crucially, verified inventory and an acknowledged **local** spool
  still resulted in `await_exact_terminal_receipt` for the resource
  fence, not `released`; no server-side signed ACK was issued.

Windows 10 native canary on already authorized Gold plugin device
`DESKTOP-VA16D27`, Windows build 19045, Node.js v26.7.0:
- Six exact `b4f1d43484009df4337aacefe3ccfebc24db3288` Gold source
  modules were copied into an isolated per-user `%LOCALAPPDATA%\Temp`
  test folder: device proof, reconnect proof, execution epoch, native
  process registry, native terminal spool and execution epoch journal.
  SHA256 of **all six** files matched the ARM repository exactly.
- A standalone disposable Windows harness imported these six actual
  modules. It passed real native child, signed challenge, cross-device
  denial, stale epoch denial, duplicate-effect denial, local durable
  terminal receipt and exact ACK replay. It expressly confirmed
  `serverTerminalAckStillRequired=true`. Console output contained
  only PASS booleans; no keys, account IDs or process IDs were printed.
- Per-user test directory was removed and separately checked absent;
  existing `LightRemoteDeviceAgent` scheduled task remained Running.
  No update, reboot or restart of Gold Windows rc49 Agent.

**Evidence boundary:** Windows test generated **test** Ed25519 keys,
not actual enrolled Windows device signing keys. Neither client had
the schema041-enabled Gold UAT server channel. Thus this verifies
native Windows cryptographic/process-journal *capability*, not a
live end-to-end signed terminal ACK for the historical M4 resource claim.
The one started UNKNOWN and one running historical M4 resource claim
remain unresolved, with `releaseAllowed=false`. Never clear them
or promote live cutover on the strength of these offline tests.

## P2-B real EnrollmentRegistry boundary on isolated signed HTTP fixture

A further disposable no-NIC clone rehearsal now exercises the **actual
`operator-host/enrollment-registry.mjs` EnrollmentRegistry** during
synthetic enrollment begin → code approval → authorized poll and
device-channel signature checks. The synthetic principal/key pair is
created only for the fixture, never via a live owner enrollment.
A small new test-facing helper in
`lib/gold-verified-channel-context.mjs` preserves the validation
sequence used by `executor.mjs`: payload type, enrolled signature and
nonce, registry device account/public key binding, rate limiter, then
authenticated context. It is exercised by the HTTP fixture.
**The actual runtime `executor.mjs` has NOT been refactored to import
the new helper.** A production-path equivalence claim would therefore
be premature; the concrete runtime's current verifiedChannelContext
was inspected separately and left unchanged.

The fixture checks:
- Invalid enrollment code/poll token rejected; approved enrollment
  binds a real synthetic Ed25519 key and account, and consumed device
  code cannot approve again.
- HTTP signed Poll + NDJSON Duplex with PG040–042 and actual
  `GoldExecutionEpochs`, executing two harmless native OS children
  exactly once.
- Authenticated pulse with exact process-state/finishedAt creates
  durable terminal ACK and releases only the exact synthetic M4 claim.
- Tampered signed payload and wrong native process ID rejected.
- Replayed same channel nonce rejected (HTTP 409), without new ACK.
- Synthetic account/public-key mismatch rejected, including when the
  envelope itself is validly signed.
- Revoked enrolled device rejected (HTTP 403), with claim counts
  unchanged.
- Duplicate terminal receipt idempotent, changed finishedAt rejected,
  and independent NULL-process ID claim remains fenced.

Observed actual no-NIC LXD clone output:
`P2B_PHYSICALLY_ISOLATED_CLONE_HTTP_ONLY=PASS`
`GOLD_P2B_FIXTURE_SQL040_041_042=PASS`
`P2B_REAL_ENROLLMENT_APPROVAL_REPLAY_REVOKE_AND_BINDING=PASS`
`P2B_REAL_SIGNED_HTTP_PG_EXACT_TERMINAL_ACK_AND_FENCE=PASS`
`P2B_DUPLICATE_ACK_IDEMPOTENT_MISSING_PID_FENCED=PASS`
`P2B_REAL_LOOPBACK_SIGNED_HTTP_PG042_FIXTURE=PASS`.

This further narrows the enrollment gap but DOES NOT demonstrate
a real A/B authorized client, runtime Operator's exact callback,
real device's enrolled private key, persisted UAT epoch, real
production resource claim release, or live Gold UAT cutover.
Live quiescence gate remains HOLD. No historical M4 claim or 27 UNKNOWN
work rows were changed.
