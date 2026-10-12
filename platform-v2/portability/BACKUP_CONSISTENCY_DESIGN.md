# rc50 MJS — backup consistency and one-writer portability gate

**Status:** source-only design + in-memory synthetic negative tests. NOT production backup tooling, NOT a Docker cold move, NOT a live cutover. Branch `feature/rc50-mjs-scale-20261011`. Do not import these experiments into active Operator/Plugin. The earlier AES seven tests, full two-stack cold-move rehearsal and least-privilege DB roles remain tool-blocked; using PTY or a different invocation does not override those denials.

## Why PostgreSQL/Redis alone is insufficient

The existing rc50 Operator still persists **14** named legacy JSON registries with identity, enrollment, A/B grants, account, usage and Team data; plugin has independent Google OAuth, Paddle billing and support outbox persistence. Source inventory tracks **17** external state/configuration references (including Wall authentication and update channel identity). OAuth single-use maps, Google pending PKCE flows, Fleet commands and OS PTY are partly process-local. PostgreSQL 17 and Redis 8 are an isolated UAT scaffold; they are **not the current authoritative production Operator stores**. Do not treat one `pg_dump` or Redis RDB as a complete restore.

## Machine-readable contracts

- `backup-consistency-contract.json`: frozen lanes, ordered phases, durable/transient planes, negative failure cases. Source references are deliberately limited to reviewed repo code, not any effective live environment.
- `validate_backup_consistency.py`: read-only source-marker audit and **pure in-memory** synthetic attestation validator. No filesystem read beyond its own contract and six checked-in source modules; no DB, Docker, secrets, network or production state. It rejects un-fenced source, active jobs or PTY, premature destination writes, mismatched freeze IDs/generations, missing flush acknowledgements, incomplete reconciliation, replay loss, or Redis rate fail-open. A fake SHA digest is not cryptographic evidence that any real record was copied.
- `../test/test_backup_consistency_contract.py`: offline 16-case suite (one happy-path fixture, one source audit, 14 fail-closed mutations). The happy-path result *explicitly* returns `real_backup_proven: false` and `production_cutover_authorized: false`.

## Proposed real-world sequence — design gates, not implemented commands

| Gate | Preconditions | Fail-closed policy |
| --- | --- | --- |
| 1. Identify | Inventory all actual writer paths, environment overrides, external billing channels and key custody under **separate live-data approval** | Unknown writer/mount => no move |
| 2. Fence | Owner-approved epoch/generation, source blocks all new mutations; target **disabled**; webhooks are durably queued or explicitly paused | Two live writers, missing webhook journal => stop |
| 3. Drain | Wait for current jobs/outbox flush; terminate/fence still-live PTY/process work with user-visible terminal status; reject stale Agent execution generations | Active OS process is *not* restored through JSON |
| 4. Checkpoint | Capture same freeze ID + generation and durable flush acknowledgement from Operator JSON, Plugin ledger/outbox, PostgreSQL (if authoritative), signing/Wall references | Different freeze epoch or unflushed file => reject |
| 5. Snapshot | Versioned, encrypted and independently verified durable dataset; freeze remains effective; Redis risk policy declared separately | Mixed epoch, missing manifest, key unavailable => reject |
| 6. Independent restore | Isolated target with no upstream routing or enabled writer; preserve file mode/UID and identity references; never regenerate server keys on restore | Mismatched original identity or insecure permissions => reject |
| 7. Reconcile | Compare account/device IDs, signer identity, active AND revoked A/B grants, Team budget, event-based usage ledger, OAuth consumed hashes, Paddle provider IDs and support outbox checkpoints | Any mismatch or unrecognized watermark => reject |
| 8. Activate | Target generation strictly higher than source, source fenced, target health and wire compatibility checked, then **one** writer authorized | Split-brain or stale generation => abort and fence target first |

No automatic rollback on disagreement: target-only provider or usage events must be reconciled before old writes reopen.

### Redis and OAuth specifics

- Redis may be rebuilt only with explicitly fail-closed authentication/rate-limit behavior. It is not the sole durable replay store or billing ledger. A restart must not reset security-sensitive consumed OAuth hashes or quota.
- In-memory OAuth used-code/refresh/resume maps cannot be carried across replicas by copying RAM. The existing PostgreSQL consumed-hash SQL fixture is a separate UAT test, not integrated HTTP production behavior. A real release needs a least-privilege DB-connected API with verifier/authored token claims and revocation policy.
- Google OAuth pending PKCE state should expire and require a new authorization after relocation; do not resurrect half-finished requests.

### Platform-native artifact gate

Source `package.json` expects Node `22.x`, and `deploy/scripts/stage-terminal-runtime.mjs` references `@homebridge/node-pty-prebuilt-multiarch` with `node.abi127.node` for `linux-arm64` and `linux-x64`. This session's dev shell reports **Node v22.23.1, modules ABI 127, linux/arm64**. The worktree did **not** contain either of the two expected `node_modules/@homebridge/node-pty-prebuilt-multiarch/prebuilds/linux-*/node.abi127.node` paths at inspection time. This does not establish a broken shipped package; it does mean **NO native binary acceptance evidence from this worktree**. Require per-architecture artifact archive inspection, ELF machine check, ABI/loader verification and independent clean UAT install before claiming portable ARM64/AMD64 runtime.

## Current verification boundaries

- Docker read-only inspection: existing `lightremote-rc50-v2` PG17/Redis8 both healthy, Compose label matches worktree, `lightremote-rc50-v2_private` internal=true and no published host ports. This does **not** imply two-stack restore PASS.
- New source consistency audit PASS; new synthetic logic tests **16/16 PASS**.
- Existing prior static inventory/deployment/package tests preserved. No repeat of previously passed unrelated suites.
- **Not run:** blocked AES runtime tests, blocked Docker two-stack cold move, provisioned least-privilege app roles, live cross-host restore or reconnection, security-key export, customer billing copy, production deployment.
