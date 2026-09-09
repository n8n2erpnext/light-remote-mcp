# GPT VPS Bridge — Current State

Updated: 2026-09-09
Version: v0.5.2 production stability hotfix

## Active path
`ChatGPT -> @Vercel -> gpt-vps-bridge.vercel.app -> ARM hub/MCP Gateway -> Unix socket -> gpt-vps-operator (ubuntu)`

## Production facts
- v0.3 operator baseline remains accepted: encrypted, authenticated, idempotent host execution as `ubuntu` with sudo/Docker/LXD/Git/build/test capability.
- v0.4 added managed session leases: 30-minute idle grace, automatic HOLD while jobs run, fresh post-job reconnect grace, and disk-backed usage reconstruction.
- v0.5 enforces one-agent/one-live-session ownership. A different `agentId` cannot resume, execute, read job state, or retrieve output from another lane (`409 session_owner_mismatch`).
- Re-opening while the same agent already has a live lane returns the same session instead of consuming another slot. Default live-session ceiling is 5.
- Session-aware reads renew the lease. Expired/closed sessions remain audit history but consume no live capacity.
- v0.5.2 pins the Vercel/serverless Node major to `22.x`, matching the tested host/toolchain and preventing automatic future-major runtime jumps from `engines.node >=20`.
- Current execution node is `nodeId=arm`. Remote-node transport is not implemented yet; ARM is the future hub anchor.
- No repo/file/service locking is imposed. Concurrent agents coordinate through normal Git branch/worktree/clean-tree discipline.

## Wall / observability
- Wall is read-only and never keeps a device/session alive.
- Wall now has independent local authentication: scrypt password verification, HMAC-signed session token, `HttpOnly + Secure + SameSite=Strict` cookie, login throttling, `/login`, `/auth/login`, and `/auth/logout`.
- Wall secret config is outside Git at `/home/ubuntu/.config/gpt-vps-operator/wall-auth.json`, mode `0600`, bind-mounted read-only as `/run/secrets/wall-auth.json`.
- The bootstrap password is stored only on the VPS in `/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password`, mode `0600`; retrieve it locally and remove that plaintext bootstrap file after storing it safely.
- NetBird PIN/SSO may remain as an optional outer defense; it is no longer the Wall authorization requirement.
- Wall delivery is near-real-time: operator SSE is primary; browser replay is deduplicated, render work is batched, session refresh is single-flight/debounced, and a bounded 1-second activity-head probe triggers catch-up only if SSE missed something.
- Measured post-rebuild operator-to-Wall SSE latency was about 1–4 ms on the ARM path; the 1-second probe is fallback, not normal delivery.
- Authoritative audit remains `/var/log/gpt-vps-operator/operations.jsonl` with 50 MiB x 3 rotation; Wall memory remains bounded at 16 MiB / 5000 events.

## Security / transport
- Production `v0.5.2` still contains the v0.5.1 static caller-Bearer hotfix; that remains production history until a later accepted release replaces it.
- Development `v0.6` deliberately removes the static shared Bearer requirement from Vercel read/operator endpoints. No `VPS_BRIDGE_CALLER_SECRET` is required by the v0.6 bridge runtime.
- The v0.6 candidate now fails closed with a separate short-lived ARM-validated bridge session: `/api/auth` relays local operator credentials over Vercel OIDC, ARM mints a 15-minute session, and protected read/operator/MCP tool calls must forward it as `x-bridge-session`. Wall cookies and bridge sessions are cryptographically domain-separated.
- ARM independently continues to require Vercel OIDC for privileged `/operator/*` and MCP `tools/call`.
- Privileged envelopes remain X25519 + HKDF-SHA256 + AES-256-GCM with short expiry, replay rejection, and semantic `operationId` idempotency.
- v0.6 uses body-safe structured POST for operator payloads; GET/query/base64 remains small-call compatibility only.
- Public-product authorization must come from explicit account/device authorization plus ChatGPT permission/confirmation semantics, not a long-lived shared Bearer secret.
- Never move passwords, tokens, private keys, cookies, or other credentials into URL query parameters.

## v0.5 closure proof
- All syntax checks and root/gateway npm audits pass with 0 known vulnerabilities.
- Operator crypto/replay/tamper, idempotency, session ownership/HOLD/expiry/capacity, systemd capabilities, Wall auth, and Wall realtime selftests all pass repeatedly.
- Live Wall proof: unauthenticated root redirects to `/login`; unauthenticated APIs return 401; bad password returns 401; live throttling returns 429; authenticated root/API/SSE return 200; logout clears the cookie.
- Public Wall without a NetBird session still returns the outer NetBird 401, proving optional defense-in-depth remains present.
- Live `@Vercel -> ARM` proof passed session-open, synchronous exec, async exec, job read, output read, owner-mismatch 409, session status, and clean session-close.

## Session state machine
`active -> hold(active job) -> active(post-job grace) -> expired`

Every real session-aware call refreshes `lastSeenAt`. Running jobs suspend expiry. Transport loss never owns process lifetime; the same agent resumes its lane. A different agent is rejected rather than silently sharing it.

## Recovery order
Fetch `/api/guide`, then read `AI_BRIDGE_GUIDE.md`, this file, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, `PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`, and the latest dated handoff. RDC remains rescue-only during soak.
