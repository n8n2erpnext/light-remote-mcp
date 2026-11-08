# Light Remote rc50 — Isolated Node Ed25519 verifier with its own PostgreSQL read context

**Date:** 2026-10-13 (Asia/Ho_Chi_Minh). **Scope:** VPS-ARM, disposable synthetic UAT only. Inherits `e8babc6` network-isolated reader/writer UAT; no production/staging code or state.

## Why this checkpoint matters
Previously a host Python supervisor fetched PostgreSQL trusted context and **passed it to a public-only Node verifier subprocess**. Reader and writer client containers existed, but Node had no independent database read. This patch makes a third, separately isolated **Node+psql verifier container** read expected request/session/device/pin/nonce/intent itself over private Docker TCP with only the synthetic read-only SCRAM login.

## Added / changed files
1. `Dockerfile.synthetic-origin-verifier-uat` — offline multi-stage build from **already cached** `ghost:6-alpine` Node v22.22.3 and `postgres:17-alpine` psql, COPY four small frozen UAT-only `.mjs` modules. No `npm install`, `apk add` or remote fetch. The copied modules are 0444 and module directory 0555; accidental inherited source 0600 originally caused non-root EACCES and was fixed, followed by rerun. **Local image** `lr-rc50-origin-verifier-uat:e8babc6` built with `docker build --network none --pull=false ...`; inspected ARM64 image ID `sha256:45906ca96b08a25e3ad4bcdea19973189a143aa8f67400c97378892607e62bb2`. The image tag is a **local UAT artifact**, not a signed release or multiarch distribution.
2. `synthetic-owner-channel-verifier-pg.mjs` — receives a single JSON object containing **only `envelope`**, rejects any caller-provided `trusted` JSON; sanitizes request ID and 64-hex decision nonce, loads isolated SCRAM reader password from a private 0600 tmpfs, calls `public.lr_uat_get_owner_channel_context(request,nonce)` via psql over `-h postgres`, then checks both fake Ed25519 signatures using the earlier `verifySyntheticOwnerChannelEnvelope`. All failures DENY, physical/production authority ALWAYS false. No server secret, raw B code or real device private key is used. Password is never passed in argv, Git, logs, Docker metadata; `PGPASSWORD` is scoped to the local subprocess, with `PGSSLMODE=disable` **only for ephemeral UAT**.
3. `verify_owner_channel_origin_transaction_pg_uat.py` — creates a third throwaway verifier container with the same strict private network, read-only root, UID 999, cap-drop ALL, no-new-privileges, bounded resources and no host-published port; stages a **copy of the read-only reader credential** into its own tmpfs (writer credential not visible). Its `public_verify_fake_origin` now sends only signed packets; the harness **does not fetch trusted context** when EXTERNAL_VERIFIER is active. The verifier's result still enters the separate restricted SCRAM writer SQL transaction, which rechecks relational state and one-time nonce.
4. `platform-v2/test/test_synthetic_verifier_container_source.py` — 12 new static source guards.
5. `platform-v2/test/test_origin_cross_container_clients_source.py` — updates cleanup guard for third container.
6. `portability/README.md` — index.

## Real UAT results on VPS-ARM
```sh
# Image built only from local cache:
docker build --network none --pull=false \
  -f platform-v2/portability/Dockerfile.synthetic-origin-verifier-uat \
  -t lr-rc50-origin-verifier-uat:e8babc6 platform-v2/portability

python3 -B platform-v2/test/test_synthetic_verifier_container_source.py
# 12/12 PASS
python3 -B platform-v2/test/test_origin_cross_container_clients_source.py
# 10/10 PASS
python3 -B platform-v2/test/test_owner_channel_reader_acl_source.py
# 7/7 PASS

python3 -B platform-v2/portability/verify_owner_channel_origin_transaction_pg_uat.py --confirm-synthetic-only
# synthetic UAT exit 0 / stderr empty
# VERIFIER PASS 00 isolated Node image
# VERIFIER PASS 01 reader-only credential, no writer secret
# ORIGIN PASS 01..15
# VERIFY PASS 01 wrong key pin, forged channel, wrong grant intent
# READ PASS 01..03; AUTH PASS 01..05; ACL PASS 01..06
# VERIFIER PASS 02 deleting only verifier's read credential returns DENY,
#                  while separately authenticated SQL writer continues working
# NETWORK PASS 01..04 (nonloopback origin and separate clients)
# RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_SYNTHETIC_UAT_PASS production=false
# RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_PRIVATE_COMPOSE_CLEANED
```
Negative cases now mutate **scratch DB** pin/intent to verify the container's own fresh reads fail, rather than providing an altered JSON object from the Python harness. Extra top-level `trusted` supplied to the Node CLI is rejected before verification. Valid synthetic origin consumes one request/nonce, writes evidence/grant/generation/outbox in one transaction; duplicate/race attempts stay blocked.

All three generated client containers and their random PostgreSQL Compose project/volumes were cleaned; inspected name filter empty. No existing rc50 project, production Operator/Plugin, actual Local Wall, customer data, credentials or billing data touched.

## Limits — NOT production ready
- This is an **isolated Node verifier container with on-demand `docker exec` verifier process**, not a long-running authenticated HTTP verifier service. Its life cycle and synthetic secrets are still provisioned by a privileged disposable Python harness. No endpoint/service-to-service mutual authentication or signed verifier decision proof exists yet.
- Writer's SQL function validates relational state and digest fields, **not Ed25519 cryptography**. A compromised writer-verifier credential may submit digest-shaped values. This patch does not bind verification to commit with a cryptographically authenticated, unforgeable channel or durable attempt ID. The verifier's read credential can query any scoped synthetic request ID, not yet caller/tenant-scoped.
- TLS, CA pinning, isolated process images built and signed for ARM64+AMD64, real `pg_hba.conf` route review, safe producer authentication and key management are NOT PROVEN. `PGSSLMODE=disable` must not be carried into production.
- No actual owner B-code consent, real Wall/Agent signer, physical command, PTY, desktop, SCP, Fleet, native Windows/macOS lock or cross-host global single-writer cutover test. **GLOBAL_WRITER_FENCE_NOT_READY**.
- Earlier synthetic AES/two-Compose PASS does not certify customer-data backup. Never reroute a prior safety-blocked task through PTY or alternate commands.

## Next exact P0
1. Refactor this fixture to a **persistent nonproduction Node verifier service** with a private authenticated transport (not `docker exec`) and mandatory request-scoped reader identity, no verifier ability to authorize itself via caller-provided context. Test compromised reader/writer, request spoof and authenticated transport replay.
2. Implement trusted signed verifier→writer result (bound nonce, request and short TTL) and transactional consumption so a stolen writer credential cannot simply invent approval digests. Review SQL SECURITY DEFINER, per-caller ACL and `pg_hba.conf`.
3. Add TLS/CA/mTLS trust to nonproduction services, rotation/revocation and kill/restart between verification and issuer commit.
4. Only then bridge opted-in authenticated Local Wall owner action and device-channel ACK to a real dev canary with side effects disabled; portability to second host and full consistency remains open.

Maintain Node.js ESM `.mjs` + Express 5; no React/TS/Fastify rewrite.
