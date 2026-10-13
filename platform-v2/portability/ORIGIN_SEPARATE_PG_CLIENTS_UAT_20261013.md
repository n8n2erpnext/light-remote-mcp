# rc50 P0 — independent network PostgreSQL clients for synthetic Wall/channel verifier

**Date:** 2026-10-13, VPS-ARM, `feature/rc50-mjs-scale-20261011`. Follow `OWNER_CHANNEL_READER_ACL_UAT_20261013.md` and `SCRAM_PUBLIC_ORIGIN_VERIFIER_UAT_20261013.md`.

## Objective and actual boundary
The preceding `593d699` checkpoint created distinct authenticated SCRAM roles, but both connections were opened by `docker exec` *inside the PostgreSQL database container*. This step runs **two separate ephemeral PostgreSQL 17 client containers** on the same isolated project-internal Compose network, one for reader and one for writer. The Node public-only Ed25519 verifier remains a separate host subprocess; **this is NOT yet a full standalone verifier service image, a production deployment or a hardened TLS/mTLS service boundary.**

## Code
- `verify_owner_channel_origin_transaction_pg_uat.py` now starts a random disposable PostgreSQL fixture and two client containers called `<project>-reader-psql` and `<project>-writer-psql`; both are `postgres:17-alpine` (already cached). It strictly checks the fixture network is `<project>_private`, Docker network `Internal=true`, container name scope, read-only filesystem, rootless UID 999, zero published ports, nonprivileged execution, all capabilities dropped, no-new-privileges, bounded resources and a separate tmpfs for each.
- PostgreSQL auth travels over Compose DNS `postgres`, not loopback in the server container. Each client has a different random SCRAM password staged by stdin into **its own** 0600 tmpfs file, with no password in command argv, env metadata or output.
- The SCRAM reader may only call the `SECURITY DEFINER` trusted-context lookup and may not read tables, update A/B requests or `SET ROLE` issuer; the SCRAM writer may only adopt its own restricted verifier principal. Existing SQL `FOR UPDATE` and consumed-nonce replay checks stay unchanged.
- New assertions check a wrong password fails, writer and reader files are absent from each other's container tmpfs, and PostgreSQL reports two distinct, non-loopback `host(inet_client_addr())` identities.
- End-of-UAT fault injection stops only the reader container. Reader query must fail; writer `SELECT current_user` must still succeed using writer identity. No silent fallback is accepted.
- In `finally`, remove only generated `<random project>-reader-psql`/`-writer-psql` containers and down `<random project>` Compose volumes. No legacy UAT or production volumes touched.

## Recorded acceptance

```sh
python3 -B platform-v2/test/test_origin_cross_container_clients_source.py
python3 -B platform-v2/test/test_owner_channel_reader_acl_source.py
python3 -B platform-v2/portability/verify_owner_channel_origin_transaction_pg_uat.py --confirm-synthetic-only
git diff --check
```

The final full synthetic runtime invocation ended **exit 0**, stderr empty, with:
- NETWORK 01: two independent read-only client containers on private project network;
- NETWORK 02: no cross-container password-file visibility;
- NETWORK 04: distinct non-loopback PostgreSQL TCP origin addresses;
- READ 01/02/03: read-only identity, invalid credential and role escalations denied;
- AUTH 01–05: restricted writer SCRAM auth and ACL isolation;
- ORIGIN 01–15, ACL 01–06, VERIFY 01: original fake signer and PostgreSQL replay/atomic grant cases remain passing;
- NETWORK 03: reader stopped; writer continues authenticating;
- `RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_SYNTHETIC_UAT_PASS production=false`
- `RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_PRIVATE_COMPOSE_CLEANED`.

During addition of the DB-observed address assertion, an intermediate test exited 1 because `inet_client_addr()::text` returns a CIDR-formatted string such as `x.x.x.x/32`, which Python `ipaddress.ip_address` does not accept. Switching to `host(inet_client_addr())` corrected the assertion; **the complete end-to-end fixture was rerun and passed.** No failed fixture remained.

## Explicit limitations / do NOT promote

1. Both psql client containers are orchestrated by a privileged synthetic Python supervisor that seeds scratch account/device/session rows and private-key pins. Although their OS namespaces, files and SQL role credentials are separate, the verifier Node process is **not** an independently deployed, authenticated verifier service and receives DB context from the harness.
2. TLS/mTLS, trusted CA/pg_hba route policy, explicit per-caller authorization on context requests and verifier-to-issuer protected signed decision are not proven. A compromised issuer credential can still submit format-valid fake digests to SQL. SQL itself does not validate Ed25519.
3. No real owner B-code, Agent signing key, PTY/RM/SCP OS side effect, actual cross-host writer fence, native ARM64/AMD64 artifact portability, customer JSON consistency or production restore. **GLOBAL_WRITER_FENCE_NOT_READY** and production migration **NOT_READY**.
4. No production/staging/repo main/deploy/billing/ERPNext/customer secrets touched. No old blocked command was rerouted.

## Next P0
Package a real nonproduction verifier **Node process inside its own immutable container image** and make it obtain protected context through a scoped authenticated read service, not through harness-provided JSON. Provide a separately authenticated, narrowly scoped writer service; ensure a compromised reader cannot reach writer credentials or bypass signed approval, test TLS and server route policies, kill/restart and approval revocation. Only then wire the real Local Wall owner-authenticated event and later a canary Agent with zero physical side effects by default.

Preserve Node ESM `.mjs` + Express 5, protocol and A/B rules. Do not rearchitect into TS/React/Fastify.
