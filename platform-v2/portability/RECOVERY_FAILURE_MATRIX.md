# Light Remote rc.50 — portability / recovery failure matrix (DESIGN ONLY)

**Status 2026-10-12:** source documentation and static-contract UAT. NOT a backup, production runbook execution, successful cross-host move, or safe-to-cutover certificate. Keep Node ESM `.mjs`, Express 5, OAuth/PKCE, A/B Local Wall, MCP, device protocol, Fleet and updater unchanged. Source-only inspection; no customer registries, credentials, actual runtime mounts or billing records were accessed.

## Four envelopes to package separately

| Envelope | Expected contents / verification | Explicit exclusion |
| --- | --- | --- |
| Immutable application | source Git commit and lockfile, exact bundled Node runtime hash, signed release provenance, ARM64 + AMD64 native dependency check, image/bundle digest, launcher and client protocol versions | customer JSON, OAuth/signing keys, Paddle keys, unreviewed binary blobs |
| Configuration / infrastructure | systemd unit source, env **variable names and references only**, ingress/TLS/NetBird/DNS mapping, service UID/GID, data mount catalogue, health/readiness probes, explicit architecture-specific paths | effective live env values, TLS private key, state volume contents |
| Durable data | a **separately authorized** consistent snapshot of every required legacy Operator/Plugin registry, PG ledger if authoritative, billing/outbox/audit offsets and data manifest checksums | pretending Redis cache alone is durable authority, silent omission of dynamic writers |
| Secret identity | operator/OAuth signing continuity, server-side private keys, encryption key custody reference, access policy, rotation/escrow and restore provenance | private keys held by end-user devices, secrets inside OCI image, Git, chat logs or Git bundle |

Source contract: `portable-package-contract.json` (DESIGN_ONLY), state contract: `legacy-state-contract.json`. The source writer audit covers declared top-level plugin filesystem calls and **does not certify** all dynamic persistence, external stores, native platform data or future modules.

## Acceptance phases (not execution instructions without approvals)

1. **Artifact freeze / compatibility:** record source HEAD, lockfile SHA, Node ABI, per-architecture OCI digest or bundle checksum, shipped `.mjs` paths and old/new client wire compatibility. Reject unsigned/unknown replacement. Do not accidentally use `compose.uat.yml` as a production deployment.
2. **Independent inventory gate:** source audit PASS; all dynamic writers, effective mounts, secret references, file owner/mode, external billing/support/ERPNext checkpoints inventoried *only after separately approved runtime inspection*. Every record gets an accountable owner and authoritative/non-authoritative classification.
3. **One-writer prepare gate:** authenticated owner approves timebox; fence any new writes/remote commands/webhooks; ensure durable journal/unique operation IDs; stop or drain jobs/PTY with explicit owner-visible status. Capture last acknowledged job generation, A/B grant revision, OAuth consumed JTI checkpoint and billing outbox offset. No unbounded silent retry.
4. **Consistent snapshot gate:** after fencing, collect independently versioned and encrypted durable envelopes with integrity hashes. Treat legacy JSON and PG transaction boundary together: if an atomic snapshot is unavailable, declare the snapshot inconsistent and fail closed. Redis TTL/rate counters require per-key policy, not blind reuse.
5. **Restore rehearsal gate:** independent destination identity with no live upstream routing; verify file modes and UID/GID mapping (do not silently chown), all customer/device/account IDs, grants including revoked/expired records, OAuth signing issuer/audience and used-token replay, usage/Free/Team invoice and webhook/outbox sequence reconciliation. No public dispatch or billing until parity achieved.
6. **Authority switch gate:** one writer only. Prove source fence remains active, target can accept approved client reconnect, device-local policy final-deny persists, and existing live job cannot be duplicated. Record switch generation and rollback deadline. A test result from an isolated synthetic UAT never authorizes a real switch.
7. **Rollback gate:** first fence target, drain or mark target-only operations and reconcile any accepted writes/webhooks; only then reopen source. Reject rollback if divergent target-only billing/usage/approval records are not reconciled. Retain encrypted snapshot and audit trail per approved retention plan.

## Failure matrix: expected fail-closed response and future proof

| Fault injection / observation | Required safe behavior | Proof required before cutover |
| --- | --- | --- |
| Artifact rebuilt with changed Node/native binary, lockfile or installer | reject digest/ABI mismatch, keep existing source authoritative | ARM64/AMD64 clean builds and pinned checksums verified on independently initialized target |
| JSON/PG snapshot partial, corrupted, wrong file owner or missing key | abort restore before any writer activation; preserve source | checksum, mode, owner, secret custody and full-volume consistency evidence |
| Revoked A/B grant restored as active, actor/client/device mismatch, stale Team seat | fail readiness, never grant device access | cross-system invariant comparison including expiry, revocation revision, owner/agent/device binding |
| OAuth code/refresh/resume replay across 2 replicas or lost key | refuse replay; keep old authority while unable to prove continuity | actual PG-backed API replay and verification of key/issuer/audience preservation; current HTTP mock not sufficient |
| Fleet worker dies or command lease expires during migration | fence old worker generation; no job double-execution; owner-visible interrupted/canceled result | durable job ID/lease generation, device-side stale-generation rejection, output checkpoint reconciliation |
| Active PTY/native process exists at snapshot | drain/stop/cancel with explicit result; never clone OS handle via database | E2E reconnect for Windows/macOS/Linux and no phantom live PTY |
| Redis unavailable or cold on target | fail closed for auth abuse controls; restart coordination within policy; no loss of durable usage authority | policy-specific TTL/rate limiter and denied-auth outage UAT (separate from previous Redis rate tests) |
| Paddle/ERPNext webhook arrives during fence or retries after cutover | journal/hold and dedupe provider event; avoid duplicate invoices/refunds | event ID uniqueness, reconciled outbox, ERPNext ledger totals and retry tests |
| Target receives writes then rollback requested | fence target first; reconcile target-only changes before source reopen | single-authority log and deterministic forward/reverse replay under test |
| Partial DNS/TLS/NetBird switch or stale client endpoint | reject wrong identity, permit controlled reconnect only, preserve approval | signed client tests on actual old/new ingress and device policy (not `/healthz` alone) |

## Current gates and mandatory blocks

- **PASS source-only this checkpoint:** inventory source audit + 8 inventory tests; 5 portable-package static-contract tests. The four plugin persistent writer modules and Fleet/Google/rate-limit transient maps were inventoried. These are not new live state backups.
- **Earlier PASS, not rerun here:** immutable SQL 13 migrations, standalone PostgreSQL scratch restore, Redis 2-process checks, signed UAT OAuth with **mock parent Map** replay, 34 Node regressions, 4 cold-move static tests.
- **BLOCKED / NOT EXECUTED:** AES-GCM seven runtime tests, Docker two-Compose-stack cold move, least-privileged app DB role provisioning. Never attempt alternative interfaces/PT​​Y/wrappers to circumvent denial.
- **NOT STARTED:** production state reads/backup, actual secret escrow, service deployments, endpoint/DNS changes, owner-authorized live cutover, k3s migration, real-client reconnect tests.

**Decision rule:** a source artifact, schema or static unit test can be marked PASS only for its verified narrow scope; restoration of authoritative live state requires a separately owner-approved and independently verified operation. No green status by implication.
