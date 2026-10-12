# Light Remote portable state contract — rc.50

The intent is **move the same system, not replace it**. Node.js ESM and the MCP, OAuth, A/B, device and Fleet contracts stay stable. Building the portability foundation is required now; using multiple replicas or k3s is a capacity decision for later.

## Source-backed inventory (no live state scanned)

`legacy-state-contract.json` is a source-derived checklist, **not an automatic backup utility**. `audit_legacy_state_contract.py` examines checked-in source and manifest **only**. It MUST NOT open `/var/lib`, `/etc`, user home credentials, production device directories, Operator state, Paddle/ERPNext records or any Docker volumes. Source-derived paths may be overridden at runtime: the fallback in source is **not proof of the active file path**.

Source inventory currently covers:

- **14** Operator `STATE_DIR` JSON files: devices, enrollments, enrollment signer, host device identity/companion, connections, A/B access grants, agent clients, accounts, usage, Free family benefits, Pro Teams, notifications and license keys.
- **13** external paths/configuration contracts: Operator private key, operation audit log; plugin OAuth secret, legacy OAuth client registry, OpenAI challenge; Google OAuth config; Paddle billing state; site announcements; support outbox and backoffice config; distribution manifest; two systemd environment files.
- **6** transient process state categories: Operator jobs/deduplication/replay maps, Fleet router's per-process commands/leases/completions, Google OAuth pending PKCE flows, public device rate-limit buckets, PTY-backed OS processes, and plugin OAuth replay. These cannot be restored by simply copying JSON or PostgreSQL/Redis.
- **15** restore invariants in the contract: account/device IDs, signing keys, OAuth binding, A/B approval and expiry/revoke state, agent sessions, metering, Team entitlement, billing idempotency, worker fencing, outbox offsets and audit history.

The source audit fails closed if a new `STATE_DIR` JSON registry is added but not registered in the manifest. It also enumerates synchronous/asynchronous `fs.writeFile`/`fs.appendFile`/`fs.rename` call sites in top-level `plugin-server/*.mjs` and compares them against **4 declared durable plugin writers** (Google, Paddle, announcements, support outbox) plus one explicit test-only selftest fixture. Each durable plugin writer must bind to an existing external state entry and source markers. Missing Fleet/Google/rate-limit transient markers, missing identity/revocation rules or changed writer call sites fail closed. **Scope limitation:** this is a syntactic top-level scan of these filesystem APIs only; aliased imports, delegated helpers, nested modules, runtime-generated paths, external services and out-of-process stores still require a separate source review. It is an **early warning**, not proof that all dynamic state is covered. New persistence may exist in modules outside the entrypoint or in external apps; it requires human review and manifest expansion.

## Portable release package contract

The additional `portable-package-contract.json` is an **offline DESIGN-ONLY package specification** for ARM64/AMD64 Node ESM deployments. It binds known source artifacts and systemd service entrypoints to their checked-in source, requires immutable package digests, native-dependency review, explicit config references, separate durable/secret envelopes, single-writer snapshot fencing and independently verified restoration. `../test/test_portable_package_contract.py` has 5 source-only contract tests (2026-10-12: **5/5 PASS**). These tests do not build an image, exercise native binaries or validate a backup. For failure handling and later authorized owner review see [RECOVERY_FAILURE_MATRIX.md](./RECOVERY_FAILURE_MATRIX.md).

## Legacy portable release package contract

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
- `python3 -B platform-v2/test/test_legacy_state_inventory.py`: previous 4/4 PASS; expanded 2026-10-12 source-only test suite **8/8 PASS**, including missing/unbound plugin persistence writer and Fleet transient drift rejection.
- Previous portability/source tests (4/4), immutable UAT migrations (13/13), platform Node regression (34/34).

**NOT proven / not authorized:** creating/destroying the separate source/destination Compose stacks and restoring their state (previously tool-blocked); actual production source state/secret backup; live A/B and PTY continuation; real OAuth DB adapter/roles; replica or k3s cutover. PTY must **never** be used to evade a prior tool security block.

## Owner-approved next work
1. Audit any *new* persistence module (plugin extensions, Fleet runtime, support and downloads). Update this manifest and tests when source changes. Avoid reading customer records during design.
2. Review the two-Compose **synthetic** cold-move script and run it only if the earlier tool security block is resolved, not through a different interface as a workaround.
3. Design an encrypted and integrity-checked offline backup manifest with per-file role/group/permissions and SHA256, using fabricated fixtures first. Require explicit authorization before any real snapshot or live secret manipulation.
4. End-to-end client acceptance: signed client updates, Windows/macOS/Linux reconnect, A/B approver proof, worker stop/drain, billing reconciliation, rollback. This is separate from unit tests.


## Synthetic sealed archive prototype (UNVERIFIED RUNTIME — 2026-10-11)

The proposed files `sealed_synthetic_backup.py` and `../test/test_sealed_synthetic_backup.py` are **deliberately offline test code**. They do not integrate with Operator, plugin-server, Docker volume backups, production or service startup. They accept neither a live state root nor arbitrary paths through a CLI.

Design implemented in source:

- AES-256-GCM authenticated encryption with a **random 32-byte test key supplied only in process memory**. The outer archive contains only a format label, random nonce and ciphertext. The encrypted payload contains the file manifest plus the fake JSON bytes.
- Strict five-file synthetic subset of the source-derived Operator registry manifest: `accounts.json`, `devices.json`, `device-access-grants.json`, `usage.json`, `enrollment-signer.json`. Fake test contents include invented account/device IDs, revoked and active A/B grants, event ID and used quota, and a fake signing reference; **no real credentials**.
- For each synthetic file, the authenticated manifest records SHA-256, byte length, relative name, POSIX mode and numeric UID/GID. Restore requires the original numeric owner/group to match the destination user. A real cross-host migration needs explicit user/group mapping; this prototype does not silently `chown`.
- Rejects unexpected/missing files, file types other than normal files, symlinks and hardlinks, weak modes, changed source files, incorrect key, corrupted ciphertext, manipulated authenticated manifest paths, and restoring over an existing destination.
- Source and target paths must be inside a randomly generated `lr_rc50_sealed_fixture_*` directory under the OS temporary directory owned by the current user with mode 0700. The source must be named `source-uat`, target `restored-uat-*`, both within that scratch workspace. This protects against accidental use on a live state directory.
- Output data and test secret are kept in memory and scratch fixture bytes. Test cleanup uses Python `TemporaryDirectory` only; no Docker, no registry, no `FLUSHDB` or production filesystem operations.

**VERIFICATION STATUS: NOT TESTED.** The remote command to run the AES-GCM unit tests was blocked by the tool security policy. Do not execute the blocked command using PTY or a different tool as a workaround. No PASS, backup correctness, cross-host restore or production readiness is claimed; require normal security review/permission resolution first.

When permitted by the ordinary tooling policy, the intended acceptance is: encrypted in-memory round-trip of fake JSON files; retention of IDs, revoked grants, usage/event ID and file modes/owner; rejection of wrong key, changed ciphertext, forged manifest, missing/extra files, symlink/hardlink, weak mode, arbitrary destination and existing files. Any production backup implementation must be separately designed and authorized, with a sealed key custody plan, rotation, consistent quiesced snapshot, rollback, storage permissions and auditing. The prototype intentionally does **not** store the AES key in its archive, cannot recreate a lost key, is not a streaming large-data backup, and does not implement disaster recovery.
