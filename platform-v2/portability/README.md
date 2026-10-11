# Light Remote portable state contract — rc.50

The intent is **move the same system, not replace it**. Node.js ESM and the MCP, OAuth, A/B, device and Fleet contracts stay stable. Building the portability foundation is required now; using multiple replicas or k3s is a capacity decision for later.

## Source-backed inventory (no live state scanned)

`legacy-state-contract.json` is a source-derived checklist, **not an automatic backup utility**. `audit_legacy_state_contract.py` examines checked-in source and manifest **only**. It MUST NOT open `/var/lib`, `/etc`, user home credentials, production device directories, Operator state, Paddle/ERPNext records or any Docker volumes. Source-derived paths may be overridden at runtime: the fallback in source is **not proof of the active file path**.

Source inventory currently covers:

- **14** Operator `STATE_DIR` JSON files: devices, enrollments, enrollment signer, host device identity/companion, connections, A/B access grants, agent clients, accounts, usage, Free family benefits, Pro Teams, notifications and license keys.
- **13** external paths/configuration contracts: Operator private key, operation audit log; plugin OAuth secret, legacy OAuth client registry, OpenAI challenge; Google OAuth config; Paddle billing state; site announcements; support outbox and backoffice config; distribution manifest; two systemd environment files.
- **3** transient process state categories: running jobs/deduplication/replay/maps, PTY-backed OS processes, process-local OAuth replay. These cannot be restored by simply copying JSON or PostgreSQL/Redis.
- **15** restore invariants in the contract: account/device IDs, signing keys, OAuth binding, A/B approval and expiry/revoke state, agent sessions, metering, Team entitlement, billing idempotency, worker fencing, outbox offsets and audit history.

The source audit fails closed if a new `STATE_DIR` JSON registry is added but not registered in the manifest. It also fails when a contracted source marker disappears or the contract removes the identity/revocation preservation requirement. This is an **early warning**, not proof that all dynamic state is covered. New persistence may exist in modules outside the entrypoint or in external apps; it requires human review and manifest expansion.

## Portable release package contract

A future signed OCI or server bundle is separated into four independent envelopes. Never bake secrets or customer state into release images.

1. **Application artifact:** immutable source revision, Node runtime, build dependencies, web assets and signed release manifests/checksums. Support ARM64 and AMD64 reproducibly. A compatible client must see unchanged MCP/OAuth/Wall/Agent wire contracts after moving.
2. **Infrastructure/configuration:** versioned Compose/k3s topology and secret *references*, environment variable names/targets, ports/proxy/DNS/TLS/NetBird routes, user IDs/file permissions, storage mount layout, reverse-proxy trust boundaries and health checks.
3. **Durable data:** versioned Operator/Plugin registry snapshots, immutable migration ledger, database backup, usage/billing/outbox/audit checkpoints. Explicitly identify the single authoritative writer before/after move. Redis cache/TTL state must have a per-domain rebuild or persistence policy.
4. **Sensitive identity:** OAuth and enrollment signing keys, server-side private key, encryption-key hierarchy, provider/webhook keys and other secrets. Transfer only under a separately authorized sealed, auditable procedure. **Never log, print, upload into ChatGPT, or include in Git/Git bundle. Never copy device-side private keys off their devices.**

### Minimal switch-over acceptance (all mandatory before claiming "safe move")

- Source app paused for **new writes**; all webhook and account mutations either drained or journaled with unique sequence; active remote jobs drained or stopped/fenced with explicit result tracking.
- Restored account+device IDs identical and both valid and revoked A/B grants retain their original state/expiry and owner/client/agent binding.
- Server signing keys and OAuth issuer/audience compatibility preserved or safely rotated; valid sessions are retained; revoked/expired tokens never regain validity; Local Wall cannot be bypassed.
- Free 10k family and account caps, Team owner-billed usage, Paddle/ERPNext idempotency and invoice/refund reconciliations have **zero unexplained differences**. Reject duplicate tool usage events.
- Running PTY and in-memory job handles are **not portable** as live OS processes; old runtime must complete/stop work and prevent stale completions before new runtime accepts it. Reconnection may require a new process with a clear user-facing status.
- One authority at a time for API writes, job dispatch, billing and webhook processing. If restore fails, **fence target writer first** before reverting traffic and source writes.
- Verify exact version manifest and all restored checksums; test snapshots on an independently initialized target, not simply reading files on the source system.
- For k3s later, map named volumes to persistent PVC or managed PG/Redis, use resource/secret policies, readiness/startup checks, worker draining and single migration leader. **Changing Compose into Kubernetes YAML alone is not a migration.**

## Tested vs pending

Verified:
- **PTY** Light Remote terminal executed a **read-only** `docker compose ps` command on the approved VPS-ARM: UAT PostgreSQL 17 and Redis 8 healthy. PTY is a suitable interactive channel when genuinely authorized.
- `python3 -B platform-v2/portability/audit_legacy_state_contract.py`: source inventory PASS.
- `python3 -B platform-v2/test/test_legacy_state_inventory.py`: 4/4 PASS with source drift, unknown external state and missing revocation guard rejection.
- Previous portability/source tests (4/4), immutable UAT migrations (13/13), platform Node regression (34/34).

**NOT proven / not authorized:** creating/destroying the separate source/destination Compose stacks and restoring their state (previously tool-blocked); actual production source state/secret backup; live A/B and PTY continuation; real OAuth DB adapter/roles; replica or k3s cutover. PTY must **never** be used to evade a prior tool security block.

## Owner-approved next work
1. Audit any *new* persistence module (plugin extensions, Fleet runtime, support and downloads). Update this manifest and tests when source changes. Avoid reading customer records during design.
2. Review the two-Compose **synthetic** cold-move script and run it only if the earlier tool security block is resolved, not through a different interface as a workaround.
3. Design an encrypted and integrity-checked offline backup manifest with per-file role/group/permissions and SHA256, using fabricated fixtures first. Require explicit authorization before any real snapshot or live secret manipulation.
4. End-to-end client acceptance: signed client updates, Windows/macOS/Linux reconnect, A/B approver proof, worker stop/drain, billing reconciliation, rollback. This is separate from unit tests.
