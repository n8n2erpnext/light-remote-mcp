# T04b8-A2 — GoldABV2 Lab mTLS certificate lifecycle and real Traefik reload acceptance
**Date:** 2026-11-04 ICT
**Status:** ISOLATED REAL TRANSPORT RELOAD PASS; OFFLINE CERTIFICATE AUDIT SOURCE PASS; PERMANENT RELEASE/ISSUER NOT APPROVED
**Scope:** GoldABV2 isolated LXD Lab; keep Owner/Token/SSO flags OFF, no Gold UAT/production or SQL changes.

## Verified runtime evidence

A temporary LXD Node service imported the exact committed `72b87fb9` mTLS edge module and started *two* loopback TLS 1.3 listeners: :5585 accepted only the two precise OLD+NEXT SHA-256 client certificate pins; :5586 accepted NEXT only. Direct in-container verification: old/new to :5585 each HTTP200; old to :5586 HTTP403; NEXT to :5586 HTTP200. Neither listener was the running public Plugin service.

The host created temporary LXD proxies :15585 and :15586 and an isolated Traefik:v3.6 sidecar listening only at **127.0.0.1:19445**. It used the same NetBird Docker network but its file provider and TLS identities were separate from the production/public Traefik config. A firewall INPUT rule allowed only that sidecar's exact Docker IP to both test proxy ports. On the *same running Traefik PID*, with file-provider watch enabled:

1. Traefik OLD client leaf -> overlapping :15585 backend: HTTPS200/TLS verify0.
2. Repoint only its temporary backend to NEXT-only :15586, still using OLD client: HTTP403/TLS verify0. Negative authorization proof.
3. Change its dynamic serverTransport certificate/key path to NEXT, preserving the NEXT-only backend; **without restarting Traefik**: HTTPS200/TLS verify0. This proves actual client certificate reload, not only configuration text acceptance.
4. Restore OLD client identity and overlapping :15585 backend: HTTPS200/TLS verify0 without a Traefik restart.

The test finished with exit0. Its scoped cleanup removed temporary Docker sidecar, exact-IP firewall accepts, both LXD proxy devices and client certificates copied to a temporary 0700 host directory. An independent **host systemd-run** auto-cleanup timer, with script stored under /home/ubuntu (not installed under host /etc), had been armed before sidecar mutation and was stopped after successful explicit cleanup. The bounded LXD Node service was stopped, its private signing CA and all test leaf keys removed. Public HTTPS200/TLS0, original public HTTP LXD proxy :15583 present, four Lab services active, Owner/Token/SSO OFF.

**Evidence / reproducibility, no private keys retained:**
- /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/CERTRELOAD_20261104/run.sh
- /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/CERTRELOAD_20261104/cleanup.sh
- /home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/DUALPIN_REAL_LXD_ROTATION_ACCEPTANCE_20261104.json

## New read-only release gate

`deploy/scripts/gold-abv2-mtls-certificate-gate.mjs` exports `auditGoldMtlsCertificateBundle`. CLI example:

```sh
node deploy/scripts/gold-abv2-mtls-certificate-gate.mjs --dir /absolute/private/staged-bundle --name goldabv2.lab --min-days 30
```

Expected private bundle names: ca.crt, server.crt/server.key, old.crt/old.key, next.crt/next.key. The CA signing private key **must NOT** be in the runtime bundle. The gate does not sign, mint, publish or alter a certificate. It rejects a symlink/missing/insecure key, insecure bundle directory, wrong CA signature, wrong server SAN, wrong EKU, mismatched private key, duplicate OLD/NEXT pin, bad/not-yet-valid/near-expiry dates and CA earlier expiry than leaf. It prints only public SHA-256 certificate fingerprints, validity dates and statuses; never private key bytes. It validates exact overlapping rotation identities, not the final NEXT-only release by itself.

`deploy/scripts/gold-abv2-mtls-certificate-gate.test.mjs` uses an **offline CA located in a separate temporary signer directory** to generate disposable 90-day test leaf certificates, with 11/11 assertions including 10 subordinate checks. The existing Gold Connection Lifecycle source gate now runs this test on every relevant path modification. No persistent private signing key has been generated or retained for production or Lab release.

## Proposed certificate release policy — not yet live

- **Issuance:** establish an owner-controlled offline CA and documented trust root; issue serverAuth leaf with exact backend SAN and clientAuth leaves with unique keys. Keep the CA signing key off Plugin, Operator, Traefik and CI. The production key custody, recovery and revocation method requires separate approval.
- **Storage:** private service keys only on the device running the corresponding service, directory mode0700, key mode0600. No secrets in Git, checkpoint, logs, shared handoffs or Agent-visible tool output. Traefik stores only its necessary client leaf/key and CA public cert; Plugin stores only server leaf/key, CA public cert and exact OLD/NEXT SHA256 pins.
- **Validity/renewal:** recommended leaf validity <=90 days with renew-at-30-days threshold; deny unsafe/expired material using the offline certificate gate. Issue NEXT separately and stage it without overwriting OLD.
- **Overlap:** Plugin starts OLD+NEXT exact pins with a bounded rollback timer; confirm both secure clients. Change Traefik serverTransport to NEXT via watched dynamic provider and verify the same PID now reaches a NEXT-only validation endpoint. Only after this proof promote NEXT to sole primary and deny OLD (403), then retire OLD private key. Never broaden pinning to arbitrary CA-issued client leaves.
- **Revocation:** fail closed by removing compromised pin from Plugin and disabling/replacing corresponding Traefik client credential. This proves *pin revocation* only; a scalable CA CRL/OCSP strategy, certificate audit trail and incident procedure remain OPEN.
- **Public transport:** replace old plaintext :15583 with pinned mTLS only under new independent Lab rollback guards and no open direct bypass; test web Account/MCP/A-B paths and direct spoof negative cases. The previous public mTLS-only cutover was bounded and rolled back.
- **Owner SSO:** leave ALL Owner/Token/SSO issuer/operator flags OFF until separate real Redis/device-Ed25519/Windows Desktop-to-Wall E2E acceptance. No canonical Git migration lock042 or Gold UAT/production release approval is implied.

**Next action:** obtain an approved, recoverable CA-key custody/revocation design, implement offline CSR/issuance plus validated certificate installation and renewal scheduling, and repeat the real guarded public Lab mTLS deployment with long-lived credentials and rollback. Only then advance Owner signed SSO E2E.

## 2026-11-04 ~21:20 ICT — Offline CSR/issuance workflow [SOURCE ONLY; OWNER CONTROL]

A new split issuance module is committed only after source/Docs/Project Truth checks: `deploy/scripts/gold-abv2-mtls-offline-issuance.mjs`, with real OpenSSL tests in `deploy/scripts/gold-abv2-mtls-offline-issuance.test.mjs`. Its **request** operation runs on the certificate identity's controlled machine and generates RSA-3072 private key (0600) + signed CSR in a pre-existing private directory (0700). It does not read the CA signing key. Its **sign** operation is a separate explicit Owner offline action and requires an existing private CA directory with ca.crt and ca.key (0700 directory, 0600 key). No CA is created by the helper. It verifies CA certificate and signing-key match, self-signed CA trust, CSR signature and exact CN, >=3072 RSA key, assigns random 128-bit serial, sets CA:FALSE and role-specific EKU and server DNS SAN, limits certificates to <=90 days and refuses CA expiry before leaf expiry. No signer private key, runtime private key, PEM or secret is printed. It never deploys, reloads, restarts or changes live configuration.

Example request on the separate machine owning each leaf key:

```sh
# Each leaf belongs in a dedicated private directory (chmod 700).
node deploy/scripts/gold-abv2-mtls-offline-issuance.mjs request --role server --name goldabv2.lab --dir /absolute/private/server-identity
node deploy/scripts/gold-abv2-mtls-offline-issuance.mjs request --role client --name GoldLab-next-client --dir /absolute/private/client-identity
```

Owner manually transfers only CSR to the separately controlled signer. An example **explicit offline signing operation** on that authorized offline signer:

```sh
node deploy/scripts/gold-abv2-mtls-offline-issuance.mjs sign --role server --name goldabv2.lab --csr /absolute/offline-inbox/goldabv2.lab.csr --ca-dir /absolute/offline-signer --out /absolute/offline-out/server.crt --days 90
node deploy/scripts/gold-abv2-mtls-offline-issuance.mjs sign --role client --name GoldLab-next-client --csr /absolute/offline-inbox/GoldLab-next-client.csr --ca-dir /absolute/offline-signer --out /absolute/offline-out/next.crt --days 90
```

The signer and key-owning machine are intentionally separate trust roles: copy back **only the signed certificate**, never ca.key or the leaf private key. The runtime bundle's ca.crt is public. Stage server.crt/server.key, old.crt/old.key, next.crt/next.key and ca.crt in a 0700 directory, then run the **existing read-only gate** with --min-days 30 before considering a new bounded Lab release. No copying to production, no automatic rollout, and no CA signing key in the runtime bundle.

**Acceptance:** the new real-OpenSSL CSR/offline-sign module tests **9/9 PASS** (including nested tests): existing exact-two-pin certificate gate accepts three newly issued leafs, distinct OLD/NEXT fingerprints, renewal issues a *fresh* leaf without overwriting OLD, no duplicate overwrite, CSR CN spoofing rejected, role validity capped at 90 days, incorrect CA key denied, RSA2048 CSR denied, insecure signer permissions denied. The new two files and tests have been added to Gold Source Gate. **No long-term CA private key was created**; tests generated and destroyed a disposable private CA in an isolated system temp directory.

**Remaining gate:** Owner key custody and actual runtime CA selection, certificate backups/recovery, audit logging, optional CRL strategy and approval for offline signing. Automated monitoring via the existing read-only certificate gate may alert on <=30-day remaining validity; **automatic CA signing is deliberately NOT provided**. Permanent public Lab mTLS and signed Desktop V4→Local Wall SSO still require their own isolated acceptance.

## 2026-11-04 ~21:30 ICT — Public-certificate-only expiration alert, safe key backup and revocation review

**New code (source-only):** `deploy/scripts/gold-abv2-mtls-expiry-watch.mjs` and `.test.mjs`. This **does not read any private key**. It requires a 0700 runtime certificate directory containing public `ca.crt`, `server.crt`, and certificates for the chosen mode: `old.crt` + `next.crt` for `overlap`, or `next.crt` alone for `new-only`. Any `ca.key` in that directory is rejected. It verifies X.509 signatures, trusted issuer, clientAuth/serverAuth, server hostname, distinct two-pin fingerprints during overlap, validity, CA expiry and unsafe directory/symlink conditions. It does not perform requests over the network, create, sign, install, renew, change flags or reload Traefik.

Manual, read-only status checks against an **already-approved staging directory**:

```sh
node deploy/scripts/gold-abv2-mtls-expiry-watch.mjs --dir /absolute/private/public-certs-staged --mode overlap --name goldabv2.lab --renew-days 30 --critical-days 7
node deploy/scripts/gold-abv2-mtls-expiry-watch.mjs --dir /absolute/private/public-certs-staged --mode new-only --name goldabv2.lab --renew-days 30 --critical-days 7
```

The CLI emits only JSON metadata (certificate SHA-256 and validity, no private paths/PEM). Exit **0 healthy**, **2 renew soon (30 days)**, **3 critical (7 days), invalid/expired or a blocking validation error**. A future Owner-approved timer can run this command daily **only when an approved runtime certificate bundle exists**; notifications may be generated from exit status. No unattended checker or external notification was installed in this task.

**Real OpenSSL tests:** 14/14 PASS (13 nested): trusted bundle, 30-day warning, 7-day critical, expiry, NEW-only mode ignoring OLD, duplicate pin, wrong server hostname, signer key accidentally included, tampering, wrong EKU, symlink/insecure mode, CLI0/JSON privacy and invalid CLI mode exit3. Added test paths and commands to Gold Connection Lifecycle Source Gate.

**Offline Owner CA key custody / backup checklist (policy draft; not an automated secret copy):**

- The Owner selects an offline signer/CA, documents a non-secret CA public certificate SHA-256 fingerprint and approval/rotation record. Never store `ca.key` on GoldABV2 LXD, VPS-ARM runtime, public Traefik, GitHub, CI, ChatGPT, shared handoffs or Long Memory.
- Back up the **signer key only on the Owner-authorized offline signer** to encrypted media under Owner-held credentials, with a separate encrypted recovery copy. Avoid pasting passwords or exposing backup ciphertext in project logs. Restrict both key copies and document recovery custody off-device.
- Test recovery on a separate isolated/offline machine: validate that the restored key matches the **public CA certificate** and can sign one disposable CSR with the explicit offline signer. Destroy disposable test material and record only the public fingerprint, date, PASS/FAIL and accountable approver.
- For suspected **client key compromise**, remove that exact SHA-256 pin from Plugin and switch Traefik to an uncompromised client credential under a guarded rollback plan. Require the old client to receive HTTP403; preserve no plaintext backend bypass. This is *pin-level revocation*, not CRL/OCSP.
- For **CA key compromise**, treat every issued leaf as untrusted; rotate the trust root, reissue server/client identities and disable the compromised CA. No automatic root rotation or CRL/OCSP is implemented; a separate incident/approval procedure must precede any permanent rollout.
- Renewal: before the 30-day threshold generate a fresh per-identity key/CSR, obtain explicit offline signature (90-day leaf max), validate its expiry and exact pin, overlap OLD+NEXT, reload Traefik (live sidecar PASS previously), prove NEXT-only behavior and retire OLD after acceptance. Always retain independent rollback and confirm public HTTPS/MCP/Account A/B contracts.

**Open release gates:** Owner-approved offline CA key custody and actual backup recovery, root-change/revocation incident policy, daily schedule/notification destination, persistent certificate installation/rotation on GoldABV2 Lab, public pinned mTLS-only release and full signed Desktop V4-to-Wall SSO E2E. Do not claim these are complete or enable SSO. Canonical Git lock042 Gold UAT/prod release remains HOLD.
