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
