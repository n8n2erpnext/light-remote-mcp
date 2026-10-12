# Light Remote rc50 P0 — Generation-scoped synthetic outbox UAT
Date: 2026-10-12, Asia/Ho_Chi_Minh. Device: VPS-ARM. Strictly isolated `lightremote-rc50-v2` PostgreSQL17 dev project.

## Why this exists

A PostgreSQL singleton writer epoch (prior checkpoint `a97f493`) prevents concurrent *database* writers that call `assert_writer_uat` in the same transaction. It does NOT by itself fence remote Fleet/PTY commands, signed OAuth flows, filesystem state or outbound Paddle/ERPNext requests. This test-only outbox verifies **generation-bound enqueue, claim and ACK semantics** without executing any real side effects.

## Precise schema/data scope

- New file `uat_generation_outbox.sql` installs **only** `lr_rc50_epoch_synthetic.command_outbox`, its private index and three SECURITY INVOKER functions within the existing private synthetic UAT schema:
  - `enqueue_command_uat(holder,generation,commandId,kind,payload)` checks `assert_writer_uat` *under the same PG transaction* as the INSERT (writer row's FOR SHARE lock persists until COMMIT), only admits fake kinds `fake_fleet`, `fake_webhook`, `fake_pty`. Exactly matching command ID/payload/generation/holder is idempotent, mismatches fail closed.
  - `claim_command_uat(holder,generation,consumer,claimTag,leaseSeconds)` checks writer under the same PG transaction, then SELECTs current-generation queued command `FOR UPDATE SKIP LOCKED`. Older-generation envelopes are **never auto-claimed or reissued** by a new writer. This is a *claim receipt simulation*, not real dispatch.
  - `ack_command_uat(holder,generation,commandId,consumer,claimTag)` requires active writer, exact source generation and claimant/tag and unexpired claim lease. Repeat, foreign, stale, expired ACK fail.
- No public tables, DB roles, historical migration files 001–013 or production code were modified. This UAT relies on the existing `lr_rc50_uat` database owner role; it does **not** enforce real least privilege or authenticated owner-control for fencing.
- Payloads are fake test objects, not real commands or webhook bodies. Outbox has no network transport, Agent consumer, PTY execution path or Paddle integration.

## Actual verification and errors encountered

Initial PostgreSQL preflight: both postgres17/redis8 healthy in exact Compose project, no published ports, internal network and `light_remote_rc50_uat` DB; authority `fenced`, command table ABSENT. Applied `uat_generation_outbox.sql` => BEGIN/CREATE TABLE/CREATE INDEX/CREATE FUNCTION ×3/COMMIT PASS.

`test_generation_outbox_uat.sql`: first run failed due to an **invalid test fixture transition** (artificially changing an ACKED row to CLAIMED without clearing `acknowledged_at`, correctly rejected by CHECK constraint). Fixed the fixture by clearing the acknowledgement as part of that synthetic expiration injection. Second run => **PASS** `RC50_GENERATION_OUTBOX_UAT_PASS start=5 writer_a=6 fenced=7 writer_b=8 old_quarantined=2`; transaction ends `ROLLBACK` so no durable test payloads or epoch transitions from this fixture.

`verify_generation_outbox_concurrency_uat.py`: after strict Compose/DB/role/synthetic-schema preflight, one uniquely named fake command was inserted into the private outbox; two **independent psql processes** concurrently claimed it. Exactly one process received the row; single ACK PASS; second ACK rejected. Script deleted only its generated fake command and explicitly fenced the UAT singleton. => `RC50_GENERATION_OUTBOX_CONCURRENCY_PASS` with `unique_claim_winner=true`, `duplicate_ack_denied=true`, `cross_plane_cutover_proven=false`.

`../test/test_generation_outbox_source.py` => **8/8 PASS** (private schema, SECURITY INVOKER source, transactional guard, claim race safety, rollback fixture, no real dispatch, no historical migration edits and source markers for integration boundaries). `ingress-fence-integration-boundaries.json` records **ten reviewed critical surfaces** with source markers; it is not an exhaustive route audit and has status NOT_READY.

Final read-only DB verification:
- `writer=7:fenced:NONE`
- `synthetic_outbox_rows=0`
- `migration_max=13`

## Hard remaining limitations

- A claim is NOT execution. If an already dispatched Fleet/PTY command completes *after* a fence, PostgreSQL cannot revoke its OS side effects. The Agent/device must enforce a higher monotonic generation, reject stale commands at execution time, and persist a receipt or compensate; requests before fence need an explicit drain/reconciliation process.
- `SECURITY INVOKER` does not mean owner-authorized. Current synthetic DB owner can call fence, insert directly or bypass the functions; production needs role grants and a verified source of administrative authority. Prior least-privilege role provisioning was tool-blocked and is NOT retried through PTY or alternate commands.
- Payload claim lease timeout does **not** trigger automatic retry: old/expired claims stay quarantined; automatic redelivery risks duplicate side effects. Reissue requires a new, separately authorized operation and idempotent receipt tracking.
- PostgreSQL cannot atomically commit with Operator/Plugin JSON, Redis, filesystem terminal commands, OAuth token signing, or external Paddle/ERPNext APIs. A durable outbox is necessary but not sufficient for cross-plane restoration. No source/target coordinated freeze exists.
- This test does not integrate actual product HTTP routes or execute the blocked Docker two-stack cold-move rehearsal. No production state, credentials, secrets, customer records, live billing data, real clients or signing material were accessed. No container restart, production deployment, role or public table modification.
- Prior blocked AES seven-test runtime, two-stack Docker cold move, DB roles and post-manifest combined writer regression remain **not rerun**.

## Integration boundary follow-up

The source-backed `ingress-fence-integration-boundaries.json` references:
account device/grants/Team, device-channel A/B recover/poll/result, Plugin sessions, direct HTTP exec/terminal/desktop, local Operator jobs and updater commands, Fleet enqueue/poll, OAuth used-code/refresh/resume maps, Paddle webhook, support timer/outbox, native terminal start/input. There are many additional POST routes; this is **not** comprehensive and must never be used to infer full request fencing.

Next P0: plan a **nonproduction agent-side generation-aware envelope and receipt schema**, then an exhaustive mutating-route census and explicit per-route guard. Implement owner-authorized global epoch lease and least-privilege SQL control only after legitimate permission approval. Then test cross-process and cross-host restore under independently reviewed conditions. Do not enable an unfinished fence in production.

No changes to Node.js ESM/Express5 product architecture or existing public protocol.
