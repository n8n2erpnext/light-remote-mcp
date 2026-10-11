# Light Remote — Portable foundation / cold-move rehearsal (rc.50 MJS)

**Date:** 2026-10-11 · **Workspace:** `feature/rc50-mjs-scale-20261011` · **Mode:** synthetic UAT only.

## Owner decision
Build and maintain a **migration-ready foundation now**, even if 3k–5k registered accounts, 20% online, or k3s/HA deployment happen much later. Success means that Light Remote can be **packaged, moved to a larger VPS or adapted to k3s without redesigning the core and without breaking existing users**. Scaling benchmark targets are a roadmap, not an excuse to leave persistence, identity, sessions and backups inconsistent.

Keep Node.js ESM `.mjs`, Express/MCP/OAuth/Local Wall A/B/Agent wire contracts, packaging/updater and Fleet compatibility. Do not restart production or import live data as part of architecture prep.

## What source inspection showed
- Current isolated `platform-v2/compose.yml` hardcodes project name `lightremote-rc50-v2`; binds `./secrets/postgres.env` and `./secrets/redis.conf`; keeps named volumes and an internal-only network. This is acceptable for **one** UAT installation but not a portable independent stack manifest.
- The main rc.50 source still has legacy file-backed registries (accounts/devices/grants/sessions/usage), in-memory OAuth replay/failed-attempt state and device-process-local execution. `platform-v2/sql/001..013` creates an isolated PostgreSQL/Redis UAT scaffold, not an approved production store.
- New UAT portability template `platform-v2/portability/compose.uat.yml` has **no fixed project name**, supports separate injected synthetic secret files per deployment, scoped project volumes, internal-only network and no published ports. Test stacks require explicit generated `-p lr-uat-move-<10 hex>-src/dst` names; no production endpoints or existing UAT project are targeted.
- New `platform-v2/portability/rehearse_cold_move_uat.py` is designed for a **cold-move rehearsal** of only fabricated records:
  1. Create source Docker Compose project with *new random* PG and Redis UAT credentials.
  2. Apply all **SHA-256-pinned SQL migrations** to the source stack and seed fake accounts, sessions, device, A/B grant, agent-client binding, queued job, Free family/usage, OAuth replay token hash and Redis rate-counter/TTL.
  3. Freeze synthetic writers, dump source PostgreSQL (custom format) and snapshot source Redis RDB.
  4. Create separate destination Compose project and volumes with **different random synthetic credentials**; restore PG and Redis snapshots; compare source/destination identity and billable counters.
  5. Verify reused usage event does not double-charge, consumed refresh JTI remains rejected, a new event increments usage, and Redis counter continues.
  6. Dispose of **only its own** randomly named synthetic Compose projects, volumes and temporary secrets. No Docker system prune, no FLUSHALL/FLUSHDB, no use of live production.
- `platform-v2/test/test_cold_move_portability_contract.py` checks the migration manifest, Compose isolation and no fixed project name/host ports, generated secret boundaries, project allowlist, cleanup path, identity and replay invariants.

## Actual verification — be precise
- The four **read-only source-contract tests** PASS (4/4).
- PyYAML parsed `compose.uat.yml`: exactly two services (`postgres`, `redis`), `networks.private.internal: true`.
- The Python cold-move rehearsal script passed Python syntax compilation. It requires an explicit `--confirm-synthetic-only` argument before any Docker action; this guard does not override tool policy.
- **The actual Docker two-stack create/backup/restore/destroy invocation was BLOCKED BY TOOL SAFETY. It DID NOT RUN.** No cold-move end-to-end PASS may be claimed, and no alternative execution interface may be used to evade the block.
- Earlier standalone UAT PostgreSQL scratch-DB backup/restore had PASS; that exercise was **within one PostgreSQL Docker container**, not between two self-contained Compose deployments. Earlier two independent HTTP instance tests used a MOCK replay ledger, not live PostgreSQL app DB roles. Keep those distinctions explicit.
- The static test does not validate a Kubernetes deployment, independent physical host, zero-downtime failover, user-session continuity under actual network reconnect or credential/key export/import.

## Real live-state portability — release gates, not shortcuts

| Scope | Must remain stable after relocation | Proof before claiming safe |
| --- | --- | --- |
| Server/OAuth identity | issuer/audience, token signing key or explicit compatible key-rotation, redirect URIs, sessions and refresh replay | same client reconnects without forced re-login; expired/revoked tokens remain rejected; DNS/TLS unchanged |
| Device identity | account ID, device ID, registered public key, enrollment/revocation record | Windows/macOS/Linux reconnect to same device ID, no duplicate enrollment or accidental trust inheritance |
| Local Wall A/B | grant owner/client/device/agent bindings, TTL and approval provenance | old approved client continues only while grant valid; revoked grant cannot resurrect; new device needs new approval |
| Active remote work | job operation ID, worker generation, leases, outbox, durable output, reconnect grace | drain active jobs or fence old workers before writer switch; no double command, lost output or stale completion |
| Metering | Free 10k/month account+verified family, Pro/Team owner charge, usage event ID | exact before/after counts; at-most-once billing; no cross-tenant or replay bypass |
| Paddle/ERPNext | provider event IDs, verified webhooks, invoices, refunds, ERPNext sync checkpoints | idempotency and ledger totals 100% reconciled; no duplicated webhooks/invoice/refund |
| Redis ephemeral state | throttle TTL, pending scheduling and cache depending on selected policy | either migrate or explicitly accept measured cache rebuild; **never** lose durable OAuth/usage authority |
| Secrets/certificates | server-side key hierarchy, token encryption key, KMS references and signing history | sealed transfer/restore without printing; no device private keys copied from user devices |
| Releases/operations | build SHA, installer signing/verifier, health checks, rollback points | restore known image + config + data on clean host; reverse traffic with no split-brain writers |

### Cutover contract (when owner separately authorizes)
1. **Inventory and classification**: list all durable state, mount paths, secret provenance and external DNS/NetBird routes. Mark every mutable write path, including legacy JSON and provider webhooks. Nothing is silently dropped.
2. **Preflight**: portable artifact/version manifest, hash signatures, verified backup and independent restore on isolated infrastructure. Verify architecture ARM64/AMD64, file ownership, timezone/NTP, Docker/K3s version and storage-class semantics.
3. **Quiesce/fence**: stop accepting new account/usage/billing writes and new remote jobs at the old authority, drain running jobs or explicitly cancel with owner-visible status, capture outbox offset and last operation IDs. Prevent two authoritative writers.
4. **Consistent snapshot**: encrypted storage and DB backup plus server-side keys, exact last event sequence and restore manifest. Do not treat Redis cache as billing authority.
5. **Restore/verify**: restore on target, compare table counts AND identity hashes/session expiries/revocation states/grants/quotas/webhook ledgers; assert zero unexplained differences. Run dry-run reconnection with authorized test devices.
6. **Switch**: only one active authoritative writer; route ingress/DNS/VPN with rollback timebox and log exact cutover timestamp. Idle connections must reconnect with correct lease fencing; running jobs must never execute simultaneously on old/new backends.
7. **Rollback**: if failure occurs, fence and stop new writer before reopening old writer. Roll back *traffic and writes together*. Reconcile any events accepted on target before falling back; do not overwrite with stale snapshot.
8. **Post-check**: monitors login, A/B, sessions, user/device status, quota, billing, app API errors, job/outbox lag, Redis occupancy, and user-facing support. Archive/retire source only after acceptance and independent backup proof.

### k3s-specific later
- Reuse the same OCI images and immutable config contract; map Docker named volumes to explicit PVC/StatefulSet (or managed database) with tested restore and data locality.
- Keep API pods stateless with readiness/liveness/startup probes and graceful WSS/agent drain; coordinate exactly-one authority for migrations, webhooks, outbox claim and jobs.
- Externalize secrets with restricted service accounts; ingress/OAuth issuer and client redirect should remain stable; preserve source IP trust/proxy rules.
- Do not put PostgreSQL/Redis on ephemeral rootfs; budget I/O and WAL/PITR, clock synchronization, CPU/memory thresholds, rolling-update and rollback runbooks.
- Replica count can stay **one** today. Horizontal replicas are enabled only after shared authoritative state, valid role least privilege and end-to-end acceptance.

## Outstanding blockers
1. Actual two-Compose-stack move rehearsal **NOT EXECUTED** because security tool blocked it. Do not bypass the restriction; it must be reviewed and run when explicitly allowed.
2. The real Operator still uses legacy JSON/in-memory state. Source schema and adapters are a scaffold, not a complete schema-aware JSON translator/cutover; no production state may be read/moved without separate authorization.
3. Dedicated least-privilege PG application and OAuth verifier roles have not been provisioned (prior tool safety block). Never connect a real web service as UAT DB owner or superuser.
4. Live device WSS reconnect, Local Wall A/B, long job drain, plugin/OAuth and Paddle webhook behavior **cannot** be proven from synthetic SQL/HTTP alone.
5. Portability file is deliberately UAT-only, not a production Compose chart or k3s manifest. Add real secrets and disaster-recovery policy only through owner-approved configuration management.

## Resume source-only tests
```sh
cd /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform
python3 -B platform-v2/test/test_cold_move_portability_contract.py
python3 -B platform-v2/scripts/migrations_uat.py verify
bash platform-v2/scripts/check.sh
```
Do NOT run the Docker cold-move script without approval that resolves the tool block. It creates/deletes *only* synthetic project resources but its execution was not authorized by the current safety gate.
