# rc50 P0 — persistent verifier HTTP source-only checkpoint (2026-10-13)

**Scope:** dev worktree `feature/rc50-mjs-scale-20261011` on VPS-ARM; no production/staging/main branch operations.
**Prior verified runtime baseline:** commit `c7bb17583dc8c81a85ffffdb57f89c680c0f246d`, independent on-demand Node verifier container with PostgreSQL SCRAM context (real synthetic Docker UAT PASS).
**This continuation:** proposed persistent HTTP service is **UNWIRED SOURCE ONLY**. No UAT claim for new service.

## Authored

- `synthetic-origin-verifier-http-service.mjs`: Node.js built-in HTTP `POST /v1/verify`, only under `LR_RC50_UAT_ONLY=1` and explicit `--synthetic-service`; HMAC-SHA256 using a 32-byte random credential intended for a scratch 0600 tmpfs file; timestamp within 30 seconds, 128-bit nonce, constant-time comparison, in-process replay cache (max 1024), 24KB body limit, no caching and no exposed host port in intended future Docker harness. Accepts only one `envelope` field, never caller-supplied trusted context; calls the existing `verifyViaSyntheticDb`, which itself obtains PostgreSQL state through a restricted SCRAM reader and checks two Ed25519 public signatures. Does NOT mint grants, produce device actions or cryptographic owner credentials. Has a private `GET /health` endpoint.
- `synthetic-origin-producer-http-client.mjs`: **fake UAT producer only**, creates HMAC envelope for HTTP, supports `--single`, `--replay`, `--bad-signature`, `--tamper-body`, `--extra-trusted` requests. This HMAC is transport authorization in a simulation, NOT owner Local Wall cryptographic evidence.
- `Dockerfile.synthetic-origin-verifier-uat`: adds `COPY --chmod=0444` for two modules to preexisting cached Alpine ARM64 Node + psql image; `/opt/uat` remains 0555 and image UAT-only.
- `test/test_persistent_verifier_source_only.py`: nine explicit guards for opt-in, HMAC header, replay cache, input shape, error bounds, no signing key, no production API and **unwired runner**.
- Adjusted prior verifier Dockerfile source guard to require at least the original four read-only modules, instead of exactly four modules, because this image now includes two further UAT modules.
- Updated this README and this checkpoint.

## Precisely what happened with integration

Attempted to extend `verify_owner_channel_origin_transaction_pg_uat.py` to run a long-lived Node service in one container, a separate HTTP producer client in another, and then perform real integration and failure-injection tests. The Light Remote structured `edit_file` operation was **blocked on this integration step** with `we couldn't determine the safety status of the request`. We did **NOT** use PTY, a different connector, shell editing or another interface to complete the blocked action. The three partial changes applied earlier to the runner (global `EXTERNAL_PRODUCER`, HTTP client invocation and additional kind label) were **explicitly reverted** using the same structured edit interface. The old on-demand verifier runner remains unchanged from `c7bb175`.

The new HTTP service, producer and image COPY lines are only source artifacts; **no new Docker image was built or run for the HTTP service** and no new private-network producer/issuer integration was verified. In-memory nonce cache is not durable across crashes; TLS/mTLS, caller-bound HMAC identity, producer credential bootstrap/rotation, authenticated verifier→writer result, tenant isolation and PostgreSQL HBA are not validated.

## What was actually tested

```sh
node --check platform-v2/portability/synthetic-origin-verifier-http-service.mjs
node --check platform-v2/portability/synthetic-origin-producer-http-client.mjs
python3 -B platform-v2/test/test_persistent_verifier_source_only.py
# 9/9 PASS (static/source only)
python3 -B platform-v2/test/test_synthetic_verifier_container_source.py
# 12/12 PASS (static/source only; guard updated for extra COPY)
git diff --check
# PASS
```
These tests validate syntax and source invariants, NOT production security or an HTTP runtime. The previous commit `c7bb175` remains the last **runtime-PASS** checkpoint. Do not extrapolate. No production data or credentials were read or changed, and no production services were restarted.

## Risk / next P0 when authorized tooling permits

1. Review ingress protocol and clarify supported security checks, especially replay across service restart and HMAC credential rotation.
2. Integrate persistent service into an explicit disposable synthetic-only private Compose project **only through permitted tools**; never circumvent a denial using PTY/wrapper/alternate tools. Use separate temporary producer/verifier/reader/writer credentials, no host-published ports and default-deny physical action.
3. Verify actual HTTP service authentication (wrong HMAC/body/nonce/replay), kill/restart, lost reader secret, pin and session revocation, writer isolation. Do not grant production issuer control or physical Agent commands.
4. Strongly authenticate verifier→issuer decision and bind request ID, signed proof and nonce to one atomic PG commit; bare digest-shaped SQL input is not sufficient. Then TLS/HBA/CA and multi-host portability assessment.

Keep Node ESM `.mjs` + Express 5 production design, no TS rewrite, no global production cutover; `GLOBAL_WRITER_FENCE_NOT_READY`.
