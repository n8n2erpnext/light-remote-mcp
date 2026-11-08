# Security

Light Remote MCP is remote-execution software. Treat the Server/Hub, Local Wall, device identities, update keys, and Vercel configuration as security-sensitive infrastructure.

## Security model

- Client devices connect outbound; the project does not require a general inbound SSH listener on a leaf device.
- Every enrolled device has its own Ed25519 identity and proves requests with signed device-channel messages.
- Agent access uses short-lived owner pairing and explicit device/session context.
- Local Device Policy is always a final deny boundary.
- Main-device effective permissions are `supported ∩ local policy`.
- Fleet-leaf effective permissions are `supported ∩ server-approved ∩ local policy`.
- Exact-device routing is fail-closed; an unavailable target does not silently fall back to another machine.
- Client update manifests are ECDSA P-256 signed and artifacts are SHA-256/size verified before install.
- The independent updater performs a post-install health gate and can roll back a failed Core update.

## Sensitive material

Never commit or upload these materials to the repository, Vercel, CI artifacts, or issue reports:

- update signing private keys;
- operator private keys;
- device private identities;
- Wall passwords/cookie secrets;
- opaque pairing continuations or client capabilities;
- production `.env` files, access tokens, or private infrastructure addresses when they identify a protected deployment.

Public verification keys and public release checksums are safe to distribute.

## Reporting a vulnerability

Do not publish exploit details, credentials, private keys, or live pairing material in a public issue. Prefer GitHub's private vulnerability-reporting/security-advisory channel for this repository when available, or contact the repository owner privately before disclosure.

Include the affected version, platform, minimal reproduction, expected boundary, and whether the issue can cross an owner/device policy boundary. Redact tokens and private infrastructure details.

## Beta note

`0.9.x` release candidates are pre-stable. Use least-privilege device profiles, keep Wall private to localhost/LAN/VPN, and test on non-critical systems before granting terminal, package-manager, service-management, sudo, UAC, registry, or firewall capabilities.
