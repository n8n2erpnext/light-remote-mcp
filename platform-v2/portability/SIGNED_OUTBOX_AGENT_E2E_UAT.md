# Light Remote rc50 — Signed PG outbox to Fake Agent E2E UAT

**Date:** 2026-10-12 (Asia/Ho_Chi_Minh). **Target:** dev-only VPS-ARM, branch `feature/rc50-mjs-scale-20261011`. **NOT** production or staging.
**Status:** PASS for the described *fake* cross-layer protocol; global writer/real remote execution safety remains **NOT_READY**.

## What ran, and what did not

`verify_signed_outbox_agent_uat.mjs` is a **single controlled Node.js ESM UAT driver**. It executes only bounded, parameter-constrained `docker compose exec -T postgres psql` commands in the already existing internal `lightremote-rc50-v2` project and calls the **unwired** `SyntheticAgentGeneration` and `SyntheticSignedAgentGate` UAT modules in-process. No HTTP/MCP/Agent client, OS commands, PTY, desktop, fleet node, updater, webhook, billing or production data are called; the simulated command's payload is always `{kind:'fake_noop',message:...}`.

The preflight requires:
- worktree path ends in `light-remote-mcp-worktrees/rc50-v2-platform`, exact compose project and the private internal Docker network, PostgreSQL and Redis healthy and **no published host ports**, matching Compose source labels
- DB and role are `light_remote_rc50_uat` / `lr_rc50_uat`, synthetic outbox `lr_rc50_epoch_synthetic.command_outbox` exists, initial writer is **FENCED** and no outbox rows exist
- all fake IDs include one fresh random 14-hex-digit run suffix; only the script's own generated command IDs are cleaned up

The Ed25519 keypair is generated in **process RAM** and never exported or saved to disk. The Fake Agent receipt fixture is a temporary private directory under `os.tmpdir()`, using the previous temp+file fsync+rename+directory fsync helper. The driver needs no additional DB role creation or historic migration.

## Cross-layer acceptance verified

1. **ACK once + idempotency:** A writer generation is acquired with `start_writer_uat`. The runner signs a fake epoch and a fake command envelope, enqueues with the PG generation lock, resubmits identical command ID+payload to receive `duplicate_same_envelope`, claims the row, verifies signed fields and body on the Fake Agent, persists ACCEPTED/STARTED/COMPLETED fake receipts, ACKs in PostgreSQL once and rejects duplicate ACK and duplicate Agent execution.
2. **Lost execution progress / Agent restart:** Claim second fake command and persist STARTED. Simulated restart loads the receipt and turns in-flight state to `UNCERTAIN`; after a newly signed epoch, redelivery is detected as duplicate and cannot invoke fake start again. No assertion that an actual OS action was or was not performed.
3. **Outbox entry signed by a wrong signer:** A separate ephemeral rogue key signs another fake command. PostgreSQL permits the envelope in the test-only outbox, but Fake Agent verification rejects `signature_not_verified`; row remains CLAIMED, has no ACK and leaves no Agent receipt.
4. **Writer fence / stale quarantine:** Keep one queued old-generation fake command. Fencing makes old writer ACK fail. New writer generation may acquire authority, but its claim ignores old queued and CLAIMED rows. Only after the **new signed epoch is delivered to the Fake Agent** does device-side logic reject the stale signed command. This explicitly shows an offline physical device cannot learn of a DB fence immediately.
5. **Completed local receipt, lost PostgreSQL ACK:** New generation enqueues a fake command, Fake Agent persists completion but DB remains CLAIMED. A process restart loads the same durable COMPLETED receipt; redelivery returns `duplicate_no_execution`; the DB ACK can then be reconciled once with the original consumer and claim tag. Duplicate ACK remains rejected.

The final run produced:
```text
RC50_SIGNED_PG_OUTBOX_AGENT_E2E_PASS
acked_once_and_duplicate=true
inflight_restart_quarantined=true
rogue_signed_outbox_command_rejected=true
stale_generations_quarantined=true
completed_no_ack_reconciled=true
commandKind=fake_noop
realDeviceExecuted=false
verifiedSourceWriterGeneration=12
verifiedTargetWriterGeneration=14
globalAuthorityProven=false
productionCutoverAuthorized=false

RC50_SIGNED_PG_OUTBOX_CLEANUP_PASS finalGeneration=15 status=fenced rows=0
```
An earlier valid run (before adding bad-signature scenario) ended fenced at generation 11. One intermediate edit introduced JavaScript syntax quoting in the new negative test; the syntax check detected it before any DB action. That edit was corrected and the final full E2E run passed.

`../test/test_signed_outbox_agent_source.py`: **9/9 PASS** (offline; checks restrictive Docker/DB references, fake no-op scope, ephemeral Ed25519 keys, no OS delivery path, failure cleanup, signed claim and receipt reconciliation). This does not replace a formal security review of SQL privilege isolation or shell invocation.

## Persistence/cleanup facts

The synthetic PG state has changed only because each test explicitly acquires and fences generations. It intentionally stays on a higher monotonically increasing generation; it does **not** reset to an earlier generation. The fake rows were deleted, and temp receipt files removed. The `lr_rc50_epoch_synthetic` UAT schema/table/functions remain installed for future tests. No historical `public.lr_schema_migrations` edits and no product runtime restart/deploy.

A hard kill/power cut can prevent `finally` from fencing or cleaning rows; a future test must refuse to run if the authority isn't already fenced/outbox isn't empty. Do not auto-clean or auto-takeover an ambiguous state without reviewing the source and owner authorization.

## Explicit risks not solved by this PASS

- This test deliberately has a **trusted in-process fake signer**, not authenticated human owner/Local Wall A/B or real authority key custody. Test DB role is owner and can bypass SQL functions; previous real least-privilege role provisioning remains tool-blocked.
- Signed epoch verification at Agent does not prevent an already-dispatched real command from running while disconnected from the global authority. A DB fence only serializes DB transactions; any physical Agent needs *immediate* revocation information or a bounded lease and fail-closed check immediately before actual side effects.
- `UNCERTAIN` cannot be auto marked failed and retried for PTY/desktop/billing; actual effects might already exist. A proper remote receipt needs OS/process evidence, signed device identity, idempotent command semantics and owner-reviewed reconciliation.
- Provider webhooks, JSON writer fsync, OAuth consumed JTI store, Fleet dispatch, native terminals, and the source-census 163 candidate mutation sites are still **unfenced** in production.
- Historical blocked actions (sealed AES runtime suite, 2-stack Docker cold move, app-role provisioning, writer-source combined regression and `HANDOFF_CURRENT.md` update) remain blocked; DO NOT run via PTY, alternate command, shell wrapper or another tool.

## Next recommended P0

1. Build a **read-only action-level route coverage matrix** from the 163 code-site candidates, accounting for dynamic POST/MCP subactions, side-effecting GETs and timer/background writes. No new endpoint gets production approval until every mutation is classified with a reachable mandatory fence and revocation boundary.
2. Add no-op Agent **concurrent process locking / exclusive receipt writer** UAT. Current file-backed state tracks generation but does not yet use a multi-process lock; concurrent device workers could race without a single trusted local gate.
3. Design actual owner-grant/Wall authorization and source of truth for signed epoch issuance, with key rotation and true A/B grant revocation (this experiment has neither).
4. Only after review, connect nonprod ingress, durable OAuth consumed-hash and outbox/PTY/Agent layers to an independent permission-scoped global writer authority. Do not enable actual side effects under an incomplete fence.
5. Independent cross-host backup/restore and native ARM64/AMD64 artifact acceptance remain separate gates; release candidate rc50 foundation has **NOT** reached global production-readiness acceptance.

Node.js ESM `.mjs` + Express5 remains product stack; no Fastify/TS rewrite. Post-rc50 DesktopCommander optimizations remain parked.
