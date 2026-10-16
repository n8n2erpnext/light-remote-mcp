# rc50 P0-B prerequisite — actual Local Wall A/B HTTP approval on native CI

**Date:** 2026-10-16 (Asia/Ho_Chi_Minh)
**Branch:** `feature/rc50-mjs-scale-20261011` (no main or production deployment)
**Base:** `47cd044409f2dfb5f07729fb854a08fd09c96af6`

## Problem / impact

The feature-branch GitHub workflow tested real Operator Unix HTTP and Plugin Express runtime but did **not** run the existing real Local Wall `POST /api/approve` route UAT. Worse, its push/PR path filters excluded **`device-agent/**` and `gateway/**`**, even though those directories implement local approval and related transport/auth plumbing. Changes to Local Wall and the device-facing authentication path could therefore land without triggering rc50 native CI at all.

## Actual corrective change

In `.github/workflows/rc50-mjs-scale.yml`:
- Added `device-agent/**` and `gateway/**` to BOTH push and pull-request path filters, in addition to existing Operator/Plugin/lib/platform source.
- After installing pinned dependencies, added **`node --test platform-v2/portability/test_real_wall_owner_approval_http_uat.mjs`** as a standalone step in BOTH `isolated-data-contract` and `native-runtime-parity` jobs. The native matrix runs on actual Linux x64 and actual Linux ARM64 CPUs, not emulation. This test is a prerequisite security regression; it does not mint a real grant.
- Added `test_actual_local_wall_owner_ab_http_is_gated_by_native_ci` in `platform-v2/test/test_p0_release_gate.py` to reject accidental removal of either native job invocation or of the `device-agent/**` / `gateway/**` workflow triggers.
- No changes to actual Wall handler, device Agent runtime, signing keys, local pairing/B code generation, OAuth, account data, Agent policy or production services.

## Evidence and precise scope

The existing source-real UAT imports `device-agent/local-wall.mjs`, launches a real HTTP Local Wall on `127.0.0.1:0`, and exercises **actual `/api/approve` route** with disposable local authentication config, signed cookie, owner-bound CSRF, pending B-code lookup and a mocked approval callback. It validates absent/forged session 401, missing/wrong CSRF 403, B code mismatch 404, invalid decision 400, deny, exactly one approval, consumed-code replay denial, and no owner proof from an auth-disabled Wall. The test creates only disposable fake keypairs/signatures. No real owner, real device, actual account, Agent command, granted capability or production crypto signer participates.

- VPS-ARM: `node --test platform-v2/portability/test_real_wall_owner_approval_http_uat.mjs` **13/13 PASS** (including nested HTTP subtests).
- HOMELAB Linux x64: identical existing source SHA and the same real HTTP test **13/13 PASS** using a no-network, resource-limited `node:22-alpine` Docker container with read-only checkout; no production services touched.
- `python3 -B platform-v2/test/test_p0_release_gate.py` **10/10 PASS** after adding the native coverage guard.
- Workflow YAML parsed and confirmed real Wall HTTP step appears **once in each** job. CI on the **new commit SHA** is required before claiming remote native matrix success.

## P0-B remains NOT_READY

This test's `accessApprove` callback is a **mock** that constructs fake signed channel ACK and Wall owner proof. The real Local Wall product handler is exercised, but an independently authenticated issuer and Agent do not consume the output. The handler also permits an explicitly local-only `auth.enabled=false` mode; this may be a user-authorized local action but MUST NOT be promoted to a cryptographically authenticated owner proof.

Still missing: real owner identity proof generator and custody, independent verifier/issuer auth, true operator device-channel signed ACK, atomic PG nonce consumption and grant issuance, replay-safe revocation and Agent physical-effect authorization. Existing persistent-verifier HTTP integration source was previously tool safety blocked; **do not reroute it via shell, PTY, alternate file edits or another app.** P0-A/C/D/E hard gates likewise stay NOT_READY.

Reference: [REAL_WALL_HTTP_CHANNEL_ORIGIN_UAT_20261013.md](./REAL_WALL_HTTP_CHANNEL_ORIGIN_UAT_20261013.md). No release, deployment, actual grant change or cross-host state transfer is authorized by these native tests.
