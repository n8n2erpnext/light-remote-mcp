# GPT Remote Operator — Device Enrollment v0.7

Updated: 2026-09-09
Status: implementation candidate on `codex/v0.7-device-enrollment`
Production baseline while this branch is under test: v0.6 production-test candidate

## Goal
A device can be enrolled once without SSH keys or a long-lived shared bearer secret. The device creates an Ed25519 private key locally; only the public identity is bound by ARM after explicit owner approval.

## First-time flow
1. Run `node device-agent/operator-agent.mjs login`.
2. The agent generates/loads its local Ed25519 identity and discovers capabilities.
3. Vercel relays `enrollment-begin` to ARM over Vercel OIDC.
4. Terminal prints an activation URL plus a separate 8-character one-time code.
5. The activation URL carries only `enrollmentId`; the code is never placed in the URL.
6. Owner signs in to Wall and opens `/enroll?id=<enrollmentId>`.
7. Wall shows fingerprint, public-key hash, platform, requested policy and requested capabilities.
8. Owner selects the approved capability subset and enters the one-time code.
9. ARM binds the public key, issues an Ed25519-signed device certificate and creates the device as `offline`.
10. The device polls using a 256-bit poll token, verifies the server certificate, then sends a signed heartbeat.
11. Only a valid heartbeat changes the device to `online`.
12. `operator-agent daemon` keeps presence alive; Linux can install `gpt-operator-device-agent.service` so the terminal may close.

## Security invariants
- Device private key stays in `~/.config/gpt-operator-agent/device.json`, mode `0600`.
- ARM stores enrollment state and public bindings in `/var/lib/gpt-vps-operator`; signer/private server material is mode `0600`.
- Device code is short-lived (10 minutes), one-time and never stored in plaintext on ARM.
- Poll token is 256-bit; ARM stores only its SHA-256 digest.
- Activation URL contains enrollment ID, not the device code or poll token.
- Owner approval capabilities must be a subset of device-requested capabilities.
- Device-local deny policy can only reduce effective capabilities; heartbeat cannot widen them.
- Signed heartbeat uses Ed25519, a 60-second timestamp window and nonce replay rejection.
- Approved device remains offline until proof-of-possession succeeds.
- Owner revoke invalidates future heartbeats while retaining audit state.
- Public enrollment begin is bounded by global pending capacity plus 3 pending requests per Vercel-derived source hash; raw client IP is not stored on ARM.
- Vercel function budget remains 12/12; enrollment reuses `/api/operator`.

## Transitional account approval
The current self-hosted test lane uses the existing local owner identity for approval. Vercel OIDC authenticates Vercel -> ARM. The public hosted product later replaces the local owner-login/Wall approval identity with account/device OAuth and ChatGPT permission semantics without changing local device key ownership or signed heartbeat proof.

## Agent commands
- `operator-agent login` — begin enrollment and wait for approval.
- `operator-agent login --no-wait` — print URL/code and return immediately.
- `operator-agent poll` — finish a pending enrollment.
- `operator-agent heartbeat` — send one signed presence proof.
- `operator-agent daemon` — keep signed presence alive with reconnect/backoff.
- `operator-agent status` — safe status view; does not print private key or poll token.
- `device-agent/install-linux-service.sh` — install the daemon as a hardened systemd service after enrollment.

Local final deny example:
`node device-agent/operator-agent.mjs login --deny sudo-on-demand,docker`

## Control API actions
Public device bootstrap/proof actions (Vercel OIDC at ARM, no owner bridge session):
- `enrollment-begin`
- `enrollment-poll`
- `device-heartbeat`

Owner-authorized actions (short-lived bridge session + Vercel OIDC):
- `enrollments`
- `enrollment-approve`
- `device-revoke`

Wall owner UI:
- `GET /enroll?id=<enrollmentId>`
- `GET /api/enrollments`
- `POST /api/enrollments/approve`

## Persistence / restart behavior
Pending requests and approved bindings survive executor restart. Enrollment signer identity is persistent. A daemon restart reloads the local device private key/certificate and resumes signed heartbeat. Heartbeat does not write ARM device state every 30 seconds unless online/offline state or effective capabilities changed; agent local state is checkpointed periodically rather than every heartbeat.

## Regression gates
- one-time code / no plaintext code at rest
- no device private key on server
- capability subset enforcement
- signed certificate validation
- signed heartbeat, timestamp and replay guard
- approved-offline -> heartbeat-online transition
- revoke -> heartbeat 403
- Vercel public-vs-owner auth route split
- Vercel source hash / per-source enrollment limit
- browser approval inline-JS syntax
- CLI secret-output / state-file permission
- daemon heartbeat + clean SIGTERM
- Linux systemd hardening
- Vercel function budget 12/12
- existing crypto/session/device/Wall regressions

## Deferred to v0.8+
- Remote command/control stream from ARM Hub to a second leaf executor.
- Target-node routing and independent operator sessions on a second device.
- Hosted multi-tenant account isolation and production OAuth approval portal.
- Windows Service and macOS launchd packaging.
- Capability-governed leaf execution adapters.

v0.7 must not claim v0.8 fleet execution until a real second node is enrolled and routed end-to-end.

## Pending enrollment cancellation

Owner-authenticated `enrollment-cancel` immediately invalidates an abandoned pending/replaced enrollment and clears its one-time code material. Live acceptance proofs use cancel-before-approval or revoke-after-approval cleanup so test devices do not accumulate in the registry.
