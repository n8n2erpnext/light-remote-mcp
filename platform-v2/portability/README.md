# Light Remote portable state contract — rc.50

The intent is **move the same system, not replace it**. Node.js ESM and the MCP, OAuth, A/B, device and Fleet contracts stay stable. Building the portability foundation is required now; using multiple replicas or k3s is a capacity decision for later.

## Source-backed inventory (no live state scanned)

`legacy-state-contract.json` is a source-derived checklist, **not an automatic backup utility**. `audit_legacy_state_contract.py` examines checked-in source and manifest **only**. It MUST NOT open `/var/lib`, `/etc`, user home credentials, production device directories, Operator state, Paddle/ERPNext records or any Docker volumes. Source-derived paths may be overridden at runtime: the fallback in source is **not proof of the active file path**.

Source inventory currently covers:

- **14** Operator `STATE_DIR` JSON files: devices, enrollments, enrollment signer, host device identity/companion, connections, A/B access grants, agent clients, accounts, usage, Free family benefits, Pro Teams, notifications and license keys.
- **17** external paths/configuration contracts: the earlier 13 Operator/plugin/systemd entries plus source references for Wall authentication config, sensitive bootstrap password, Operator public-key manifest and signed client-update feed. These are source markers, **not live path/secret discovery**. The bootstrap password is a sensitive optional recovery artifact, not a mandatory prerequisite for preserving an existing Wall identity.
- **6** transient process state categories: Operator jobs/deduplication/replay maps, Fleet router's per-process commands/leases/completions, Google OAuth pending PKCE flows, public device rate-limit buckets, PTY-backed OS processes, and plugin OAuth replay. These cannot be restored by simply copying JSON or PostgreSQL/Redis.
- **15** restore invariants in the contract: account/device IDs, signing keys, OAuth binding, A/B approval and expiry/revoke state, agent sessions, metering, Team entitlement, billing idempotency, worker fencing, outbox offsets and audit history.

The source audit fails closed if a new `STATE_DIR` JSON registry is added but not registered in the manifest. It also enumerates synchronous/asynchronous `fs.writeFile`/`fs.appendFile`/`fs.rename` call sites in top-level `plugin-server/*.mjs` and compares them against **4 declared durable plugin writers** (Google, Paddle, announcements, support outbox) plus one explicit test-only selftest fixture. Each durable plugin writer must bind to an existing external state entry and source markers. Missing Fleet/Google/rate-limit transient markers, missing identity/revocation rules or changed writer call sites fail closed. **Scope limitation:** this is a syntactic top-level scan of these filesystem APIs only; aliased imports, delegated helpers, nested modules, runtime-generated paths, external services and out-of-process stores still require a separate source review. It is an **early warning**, not proof that all dynamic state is covered. New persistence may exist in modules outside the entrypoint or in external apps; it requires human review and manifest expansion.

## Portable release package contract

The additional `portable-package-contract.json` is an **offline DESIGN-ONLY package specification** for ARM64/AMD64 Node ESM deployments. It binds known source artifacts and systemd service entrypoints to their checked-in source, requires immutable package digests, native-dependency review, explicit config references, separate durable/secret envelopes, single-writer snapshot fencing and independently verified restoration. `../test/test_portable_package_contract.py` has 5 source-only contract tests (2026-10-12: **5/5 PASS**). These tests do not build an image, exercise native binaries or validate a backup. For failure handling and later authorized owner review see [RECOVERY_FAILURE_MATRIX.md](./RECOVERY_FAILURE_MATRIX.md).

## Deploy writer & native ABI boundary (2026-10-12 P0)

`deployment-state-boundaries.json` and `audit_deployment_state_boundaries.py` distinguish **six** source-visible `deploy/scripts/*.mjs` writer modules (excluding explicitly named `selftest-*` fixtures): source release-manifest builder, Operator key generation, Wall authentication provisioner, signed channel promotion, client-core staging, and terminal-native staging. Four new external state references are tied to the source-derived state contract. This protects against assuming a source release package is equivalent to a complete backup of Wall authentication or verified updater state. **Never run generation/promotion scripts during an audit or migrate by regenerating identity.**

The source also confirms a linux terminal package referencing `@homebridge/node-pty-prebuilt-multiarch` with a native filename `node.abi127.node` under architecture-specific `prebuilds/linux-arm64` or `linux-x64`; root `package.json` specifies Node `22.x`. These are *source expectations only*. A production release still requires independently verified Node module ABI, ELF machine type, native symbol compatibility, executable permissions, dependency/license inventory and clean ARM64/AMD64 installation checks. Neither compiled native binary was loaded or verified at this checkpoint.

Explicitly excluded from **server authority backup** are device-local client announcement seen-state, `operator-host/team-durable-dispatch-uat.mjs` preview SQLite/WAL simulator, and user-invoked `lib/native-fs.mjs` file operations. These are not necessarily disposable to the individual device/user; they simply do **not** become authoritative Operator/Plugin server state by association.

**Verification:** both read-only audits succeeded: legacy inventory 14 Operator files / 17 external contracts / 6 transient groups; deployment audit 6 writer modules / 4 host links / 3 exclusions / 2 Linux architectures. Existing 8/8 legacy negative tests PASS. The attempted creation of a new deployment negative-test file was blocked by safety policy; it was not created or rerouted. Therefore this new deployment audit currently has a verified nominal PASS, **not** a negative-test suite PASS.

## P0 consistency / authoritative writer-fencing contract

See [BACKUP_CONSISTENCY_DESIGN.md](./BACKUP_CONSISTENCY_DESIGN.md) and `backup-consistency-contract.json`. The new `validate_backup_consistency.py` validates only checked-in source markers and synthetic in-memory freeze/restore attestations, **not** a real filesystem, Docker, database or billing backup. It requires the same source fence epoch on Operator, Plugin and PostgreSQL evidence, no in-flight jobs/PTY, independently reconciled identity/grants/usage/OAuth/billing/outbox digests, denied authentication while Redis rate coordination rebuilds, and one higher-generation target writer after explicit activation. `../test/test_backup_consistency_contract.py` has **16/16 PASS** including targeted fail-closed mutations (2026-10-12). The verifier always marks `real_backup_proven=false` and `production_cutover_authorized=false`. Existing AES-GCM and two-stack Docker rehearsals remain blocked; there is no alternate PTY route around that.

## P0 real writer-source gap audit and synthetic epoch fence (2026-10-12)

See [WRITER_FREEZE_GAP_AUDIT.md](./WRITER_FREEZE_GAP_AUDIT.md). The audited `writer-freeze-readiness.json` and `audit_writer_freeze_readiness.py` match **14 Operator plus 4 Plugin writer files**, classify **5 still-unmitigated async/transient writers**, and explicitly return **NOT_READY**: no cross-plane fsync, durable epoch lease or multi-process fence is proven in active code. `../test/test_writer_freeze_readiness.py` has **10/10 negative/coverage PASS**.

The isolated `freeze-epoch-guard.mjs` is **only an in-memory synthetic UAT prototype**, not wired into the production Operator/Plugin. It enforces a one-way freeze/drain/checkpoint lifecycle, with an explicit work report and six acknowledgements; `../test/test-freeze-epoch-guard.mjs` has **12/12 PASS**. These tests do **not** provide actual backup, distributed authorization or cold-move readiness, and retain all prior blocked-operation boundaries.

## P0 synthetic durable JSON & dev audit-log error latch

`durable-json-synthetic.mjs` is an **unwired synthetic-fixture-only** atomic replace helper: exclusive temporary file, restrictive mode, complete write, file fsync, atomic rename, then parent directory fsync. `../test/test-durable-json-synthetic.mjs` demonstrated **14/14 PASS** including short write, I/O failure before rename, ambiguous failure after rename, symlink parent/target, traversal and mode rejection. A directory-fsync failure can leave a newly visible target and **must not be called a certified checkpoint**. This does not wire the helper into any live registry or prove crash durability on production filesystems.

Separately, this rc50 **dev source branch only** updates `operator-host/executor.mjs` with `operator-host/audit-append-barrier.mjs`. Append errors become latched and propagate to `await flushDiskRecords()` rather than being swallowed; shutdown flush failure requests a nonzero exit. `../test/test-audit-append-barrier.mjs` demonstrated **8/8 PASS**, and `node --check operator-host/executor.mjs` succeeded **before** later modifications to the writer-audit manifest. The log append is still **not fsynced**; no durable journal watermark, full persistence guarantee, rollout or production update has occurred.

The subsequent **combined regression execution was tool-blocked**; no equivalent retries were made using PTY or alternate commands. Accordingly the post-manifest audit regression status is **NOT VERIFIED**, despite earlier source audit and prior 10/10 tests having passed before this patch. See [WRITER_FREEZE_GAP_AUDIT.md](./WRITER_FREEZE_GAP_AUDIT.md) for current gaps.

## P0 first registry opt-in + fsynced journal UAT (2026-10-12)

[FREE_BENEFIT_JOURNAL_UAT.md](./FREE_BENEFIT_JOURNAL_UAT.md) documents a strict temporary-fixture-only `FreeBenefitRegistry` shadow-mode writer injection using the earlier file+directory fsync helper, with **6/6 new tests PASS** and a poison-on-failure guard. Default Operator/Plugin production-source paths remain unchanged. The separate `synthetic-journal-watermark.mjs` proves a test-only serialized SHA-256 / sequence / byte-offset acknowledgment after fsync, with **11/11 new tests PASS**. This journal is **not** wired into live Operator log paths. Real cross-plane consistency, authoritative writer fencing, remote proof and restore remain **NOT_READY**. A previous writer-source regression remains tool-blocked, and was not rerun.

## P0 PostgreSQL writer generation — isolated multi-process UAT

See [PG_WRITER_EPOCH_UAT.md](./PG_WRITER_EPOCH_UAT.md). Under the owner's dev-Docker approval and after verifying exact Compose project, internal network, healthy unexposed PG17, database and username, a **new independent synthetic-only** PostgreSQL schema `lr_rc50_epoch_synthetic` was installed in `light_remote_rc50_uat`. No production database/role/public table, history 001–013, Docker service, OAuth or billing was modified. Transaction-local SQL proves explicit fence A→B/lease expiry FAIL-CLOSED, while a **two-independent-psql-process concurrency UAT PASS** demonstrates exactly one writer winner and that a fence waits for an admitted DB transaction holding `FOR SHARE`. Offline source guards **6/6 PASS**. Schema remains with the one synthetic singleton **fenced** at the checkpoint.

This is **NOT global writer authority**: nobody has yet wired the guard into Operator/Plugin mutating requests, native PTY/Fleet commands, JSON state, webhooks or independent storage. The SQL's `fence_writer_uat` has no owner-authenticated administrative policy; least-privilege roles were previously blocked. No expired-lease auto-takeover or production promotion. Global cutover and cross-host restore remain `NOT_READY`.

## P0 generation-scoped synthetic PostgreSQL command outbox (2026-10-12)

See [GENERATION_OUTBOX_UAT.md](./GENERATION_OUTBOX_UAT.md). Inside the isolated `lightremote-rc50-v2` PostgreSQL17 UAT schema, a new synthetic `command_outbox` and three functions bind **enqueue, claim and ACK** to the currently authorized writer generation. The SQL `test_generation_outbox_uat.sql` passed with transactional `ROLLBACK`, including idempotency, conflict, fence A→B, quarantined old-generation queued/claimed rows and expired claim ACK rejection. Two independent real `psql` processes raced for one fake command: **exactly one claimed it and duplicate ACK was denied**; script removed the synthetic row and fenced the authority. `../test/test_generation_outbox_source.py` has **8/8 PASS** and the 10 critical source-backed integration boundaries remain `NOT_READY`.

This does **not** dispatch Fleet, PTY, webhook, OAuth or billing work, does not grant any production role and does not fence OS side effects. A database claim is not actual remote execution; Agent-side monotonic generation rejection, durable receipt and owner-authorized drain are still mandatory. No other migrations, production runtime or Docker services were changed.

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
