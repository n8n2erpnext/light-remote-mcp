# rc50 P0 — Ed25519 fake device proof-of-possession ACK and PG transactional receipt

**2026-10-13 · Linux VPS-ARM · isolated synthetic only · NOT READY FOR PRODUCTION.**

## Verified scope

The prior checkpoint `fc860ae` proved scratch PostgreSQL grant → signing claim → test Ed25519 issuer lease → fake ACK, but PostgreSQL previously trusted an unsigned tuple of ID, digest and nonce. This checkpoint models an actual **Ed25519 signature over an exact device/issuer/lease/challenge binding**, verified in a **separate public-key-only Node process** before a scratch database function transactionally stores receipt evidence and consumes a one-use challenge.

No actual owner or enrolled user device participated. The device-private signing key is throwaway and held only in memory by one long-lived fake device child process. The verifier is a separate process launched in `--verify-only` mode, never generates or receives a device private key.

## Code additions and UAT pipeline

- `synthetic-device-lease-ack.mjs`: canonical domain-separated Ed25519 `uat_fake_device_ack` payload with requestId/grantId/deviceId, enrolled device public fingerprint, issuer public fingerprint, exact SHA256 of the **cryptographically verified issuer-signed lease**, generation/grantRevision/claimSeq, challenge nonce SHA256 and challenge expiry. Verifier binds signature and payload against independently supplied trusted DB expectations: active enrollment/grant/key pin, nonce unused, matching current device generation/revision floor, unexpired signed lease/challenge. Returns `physicalExecutionAuthorized:false`, `productionAckAuthorized:false` on success.
- `synthetic-device-ack-fixture-cli.mjs`: `--synthetic-only` test signer holds Ed25519 private key only in process RAM. `--verify-only` subprocess accepts only public SPKI, ACK packet, signed lease and expected state. Both require `LR_RC50_UAT_ONLY=1`. The verifier cannot sign. No real device commands or RPC access.
- `test_synthetic_device_lease_ack.mjs`: **27/27 PASS**. Rogue device and issuer keys, mutated lease/ACK, wrong grant/nonce/fingerprint/epoch/claim, revoked signer or enrolled device, stale revision, elapsed challenge/lease, consumed nonce, missing trusted DB context, verifier-only cannot sign, opt-in refusal.
- `device_signed_ack_uat.sql`: **scratch PostgreSQL only**, applied after 13 immutable source migrations, `issuer_origin_uat.sql` and `issuer_publisher_uat.sql`. Adds public SPKI fields to synthetic issuer/enrollment pins, a one-time short challenge table and a unique `lr_uat_signed_device_ack_receipt` table. `lr_uat_issue_device_ack_challenge` issues a <=7-second nonce binding only if signed lease, grant, pinned issuer, enrolled key and device epoch are current. `lr_uat_commit_signed_device_ack` locks the challenge, outbox, enrolled key, issuer pin, grant and device floor; checks exact signed digest/grant/generation/revision/claimSeq/nonce before one DB transaction atomically writes the old ACK row, signed proof receipt and consumed challenge. Identical resend is idempotent; changed packet digest is a conflict.
- `verify_signed_device_ack_pg_uat.py`: separate **random private PostgreSQL-only Compose UAT**, no host-published ports, tested 13 source migration checksums. Creates fake device signer process, enrolls only its public key hash, runs 12 prior origin tests including competing issuers, then claims current generation, invokes ephemeral fake issuer signer (public SPKI now included), issues DB challenge, obtains signed device ACK, launches **independent Node verify-only subprocess** with public keys and context queried from DB, tests tampering, revocation, changed floor, atomic commit, exact resend and conflicting replay. Deletes private Compose containers and volumes on exit. No production PG connection.
- `verify_issuer_origin_pg_uat.py`: backward-compatible optional `device_key_sha256` fixture parameter, default remains original fake fingerprint; needed to enroll a *real cryptographic fake device identity* BEFORE its grant is issued.
- `synthetic-outbox-lease-publisher.mjs`: adds public SPKI to fake issuer output; never exports private signer key.
- `test_synthetic_device_signed_ack_source.py`: **9/9 PASS** read-only source guards ensuring fake-only scope, no imports into real Local Wall or Agent, separate verifier process, SQL transaction and no privileged roles.

## Actual results on owner-approved VPS-ARM

```bash
node --test platform-v2/portability/test_synthetic_device_lease_ack.mjs platform-v2/portability/test_synthetic_outbox_lease_publisher.mjs
python3 -B platform-v2/test/test_synthetic_device_signed_ack_source.py
python3 -B platform-v2/portability/verify_signed_device_ack_pg_uat.py --confirm-synthetic-only
```

- **27/27 new device ACK Node tests**, **11/11 prior fake issuer Node tests**, **9/9 source guards** PASS.
- Scratch PostgreSQL: **12/12 prior fake issuer provenance** + **12/12 new signed ACK integration** PASS, including separate verifier subprocess and short DB challenge.
- First new 25-case Node run had a **test assertion typo** (`PINN` instead of `PINNED`), fixed, 25/25 then passed; added verifier separation and 2 CLI negative tests to reach 27/27.
- The UAT scratch PostgreSQL project was torn down with `down --volumes --remove-orphans`, confirmed by program output.
- Does NOT claim all historical combined regressions; a broad combined regression invocation was safety-blocked in an earlier session. All tests named above were actually run in this checkpoint.

## Security limits and remaining P0 blockers

1. **No real owner approval or production device private key.** Actual B-code verified session, device channel and enrolled physical key do not feed this test. The device identity is a disposable key generated only by the UAT process. No evidence from genuine user approval or a real Agent was handled.
2. **PostgreSQL does not verify Ed25519 cryptography.** The independent Node verifier successfully verifies it, then passes a digest and signature string to a scratch SQL function. The SQL function only checks pinned fingerprints, digest/state and signature *syntax*. A caller with direct scratch DB permissions can still fabricate signature-shaped input to the SQL function. A production issuer must enforce restricted roles, an authenticated verifier-to-DB trust boundary, protected public-key provenance, transactional nonce checks, appropriate SQL permissions and independently pinned signer identity. There is **no production cryptographic ACK receiver** here.
3. **Issuer trust bootstrap/rotation still synthetic.** Test harness sets issuer pin after generating a new ephemeral signer; this would be forbidden in production. Real signer must have protected key custody and rotation/revocation policy.
4. **Clock/network/device rollback and offline revoke not proven.** `Date.now()` and scratch SQL timeouts are not trusted monotonic clocks under hostile reboot/time skew. A 7-second challenge does not prove an SLA or delivery on disconnected networks.
5. **Original unsigned ACK primitive remains available inside scratch schema.** The new signed wrapper is an *additional UAT contract*, not security enforcement for callers with direct DB access. Production would revoke all direct calls to the primitive and expose only authenticated, signature-verified procedures.
6. **Real PTY/desktop/Real Remote/SCP/process/file/update side effects not gated**, and Windows/macOS native OS lock adapters, global writer fence and two-host failover remain NOT READY. No actual production files, migrations, roles, jobs, billing, OAuth or network routing were changed.

## Next safe engineering gates

(1) Real owner-authenticated Local Wall approval evidence bound to PostgreSQL; (2) protected issuer/verifier services with separated identities and least-privilege DB roles; (3) immutable enrolled device public identity, signed nonce/challenge and reconnect-proof ACK state; (4) native Windows/macOS lock tests and opt-in Agent canary with per-side-effect checks; (5) real cross-host cold-move/split-brain recovery. Keep Node ESM `.mjs` + Express5 and current production protocol.
