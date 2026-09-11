# Light Remote MCP — Current State

Updated: 2026-09-11
Version: `v0.9.0-beta.1` source candidate on `codex/v0.9-device-policy-resume`; public beta promotion approved, production reference remains v0.8.0-dev until promotion completes

## Active path
`ChatGPT -> @Vercel -> light-remote-mcp.vercel.app -> ARM Hub -> {ARM local executor | explicitly selected outbound leaf}`

## Production facts
- v0.3 operator baseline remains accepted: encrypted, authenticated, idempotent host execution as `ubuntu` with sudo/Docker/LXD/Git/build/test capability.
- v0.4 added managed session leases: 30-minute idle grace, automatic HOLD while jobs run, fresh post-job reconnect grace, and disk-backed usage reconstruction.
- v0.5 enforces one-agent/one-live-session ownership. A different `agentId` cannot resume, execute, read job state, or retrieve output from another lane (`409 session_owner_mismatch`).
- Re-opening while the same agent already has a live lane returns the same session instead of consuming another slot. Default live-session ceiling is 5.
- Session-aware reads renew the lease. Expired/closed sessions remain audit history but consume no live capacity.
- v0.5.2 pins the Vercel/serverless Node major to `22.x`, matching the tested host/toolchain and preventing automatic future-major runtime jumps from `engines.node >=20`.
- ARM is the live Hub (`nodeId=arm`). `VPS-AMD` is the first live outbound Linux leaf; leaf sessions/jobs are explicitly target-bound and never silently fall back to ARM.
- v0.9 has also completed live Windows x64 leaf acceptance through the unchanged production Vercel -> ARM Hub route. Windows DEV persistence uses a per-user Interactive/Limited Scheduled Task rather than weakening blank-password Service policy.
- No repo/file/service locking is imposed. Concurrent agents coordinate through normal Git branch/worktree/clean-tree discipline.

## Wall / observability
- Wall is an authenticated owner control plane, not a generic executor. Structured Device Policy and signed-update maintenance actions are allowed; arbitrary shell execution is not exposed from Wall, and Wall never keeps a device/session alive.
- Wall now has independent local authentication: scrypt password verification, HMAC-signed session token, `HttpOnly + Secure + SameSite=Strict` cookie, login throttling, `/login`, `/auth/login`, and `/auth/logout`.
- Wall secret config is outside Git at `/home/ubuntu/.config/gpt-vps-operator/wall-auth.json`, mode `0600`, bind-mounted read-only as `/run/secrets/wall-auth.json`.
- The bootstrap password is stored only on the VPS in `/home/ubuntu/.config/gpt-vps-operator/wall-bootstrap-password`, mode `0600`; retrieve it locally and remove that plaintext bootstrap file after storing it safely.
- NetBird PIN/SSO may remain as an optional outer defense; it is no longer the Wall authorization requirement.
- Wall delivery is near-real-time: operator SSE is primary; browser replay is deduplicated, render work is batched, session refresh is single-flight/debounced, and a bounded 1-second activity-head probe triggers catch-up only if SSE missed something.
- Measured post-rebuild operator-to-Wall SSE latency was about 1–4 ms on the ARM path; the 1-second probe is fallback, not normal delivery.
- Authoritative audit remains `/var/log/gpt-vps-operator/operations.jsonl` with 50 MiB x 3 rotation; Wall memory remains bounded at 16 MiB / 5000 events.

## Security / transport
- Production is now serving the v0.8 production-test candidate on `main`; the v0.5.1 static caller-Bearer hotfix remains history only and `VPS_BRIDGE_CALLER_SECRET` is not part of the current runtime.
- v0.6 fails closed with a separate short-lived ARM-validated bridge session: `/api/auth` relays local operator credentials over Vercel OIDC, ARM mints a 15-minute session, and protected read/operator/MCP tool calls must forward it as `x-bridge-session`. Wall cookies and bridge sessions are cryptographically domain-separated.
- ARM independently continues to require Vercel OIDC for privileged `/operator/*` and MCP `tools/call`.
- Privileged envelopes remain X25519 + HKDF-SHA256 + AES-256-GCM with short expiry, replay rejection, and semantic `operationId` idempotency.
- v0.6 uses body-safe structured POST for operator payloads; GET/query/base64 remains small-call compatibility only.
- Public-product authorization must come from explicit account/device authorization plus ChatGPT permission/confirmation semantics, not a long-lived shared Bearer secret.
- Never move passwords, tokens, private keys, cookies, or other credentials into URL query parameters.



## v0.9.0-beta.1 public distribution preparation
- Owner selected Apache-2.0 and approved the public beta. Root `LICENSE` + `NOTICE` are now part of the candidate.
- Product architecture is locked in `PRODUCT_ARCHITECTURE_ROADMAP_V0_9_BETA_TO_PLUGIN.md`: Client <-> Server <-> thin Plugin/App <-> ChatGPT; Vercel is a deployment adapter, not authority.
- Public self-host packages now cover Linux Server/Hub x64+arm64, Vercel bridge, Windows x64 client, and Linux client x64+arm64. Windows/Linux clients can target a user's own Bridge/Hub URLs.
- Beta updates use signed `channels/beta/client-update.json` + signature, not GitHub `releases/latest`; Windows now has prerelease-aware SemVer ordering.
- Final pre-commit ARM regression is 37/37 PASS; root and gateway npm audits are 0 vulnerabilities; all beta workflow YAML parses cleanly.
- ChatGPT write-capable custom MCP use remains plan/workspace dependent and the generally distributable account/OAuth Light Remote Plugin/App is post-beta work; beta does not reintroduce anonymous execution or a static shared bearer.

## v0.9 Light Remote self-dogfood continuity
- A native owner OAuth lane is now implemented for `/mcp`: Authorization Code + PKCE S256, protected-resource/authorization metadata, DCR, short-lived access tokens and refresh tokens. The existing Vercel OIDC + bridge-session lane remains intact.
- The MCP tool surface now exposes the operating contract, device/fleet discovery, durable session open/read/resume/close, durable exec/job/output, session recovery, node drain, device policy and signed Linux update control. Generic exec remains policy/capability bounded on the target device.
- `deploy/scripts/live-v09-oauth-dogfood.mjs` passes end-to-end locally against the live operator socket: OAuth discovery/DCR/PKCE/replay rejection/refresh -> MCP initialize/tools -> ARM exec/output/resume -> AMD Linux file/Git/Docker/systemd proof -> Windows file/Git/process/service/package-manager proof.
- Full static regression after this work is 38/38 PASS; root and gateway audits remain zero known vulnerabilities. Production/public OAuth deployment proof is the next gate before beta promotion.

## v0.9 platform-adapter preview proof
- Branch `codex/v0.9-device-policy-resume` is the active v0.9 acceptance lane; production `main` remains v0.8. No stable v0.9.0 tag exists.
- Leaf execution is now adapter-based. Linux and Windows independently discover capabilities, infer script-required capabilities, apply the local deny boundary, and only then spawn the native shell/process. Caller `requiredCapabilities` cannot hide a capability from the device.
- A real Windows x64 desktop is live-accepted using the existing v0.8 fleet protocol. Seven proof jobs covered host/PowerShell, temporary filesystem I/O, Git + bundled Node, process/network inspection, Services read, Event Log read, and package-manager read. Wall attribution recorded 12 successful Windows `job_finished` events / 36 related events across repeated proof rounds with zero active sessions after cleanup.
- Final Windows acceptance observed Git 2.54.x, bundled Node x64, Windows PowerShell 5.1, and `winget v1.29.290`. Vercel production traffic for the final 30-minute window was 121 HTTP 200 responses with no warning/error/fatal logs.
- Blank-password Windows Service startup correctly failed with SCM Event 7038; DEV mode now uses a per-user Scheduled Task (`Interactive`, `Limited`) with no stored password/PIN. GitHub Actions validated this registration on Windows Server 2025. Password-backed Service mode remains optional and does not default to LocalSystem.
- AMD x86_64 Linux live migration is complete. The packaged layout is root-owned under `/opt/gpt-operator-agent/releases`, `current` selects the active release, the updater timer is active, and Wall Device Policy revision 3 keeps `sudo-on-demand`/`systemctl` genuinely usable. Signed acceptance moved `0.9.0-dev -> 0.9.0-rc.1`; a valid signed/hash-verified but non-executable `0.9.0-rc.2` then failed the stable service-health gate and automatically rolled back to healthy `rc.1`. Final ARM regression is 36/36 PASS and ARM+AMD+Windows fleet soak remained online with zero active sessions. See `LINUX_SIGNED_UPDATE_V0_9_ACCEPTANCE_2026-09-10.md`.
- macOS work is deferred by product-owner decision. See `PLATFORM_ADAPTERS_V0_9.md`.
- Release-prep review is complete: `origin/main` is now an ancestor via a no-content reconciliation merge, the AMD updater has been cut back to the canonical GitHub Release channel, the temporary ARM fixture listener is stopped, and security scans found no committed private-key/token markers. Binary packaging now carries Node.js and .NET runtime license/notice files as CI-enforced package requirements. Notice-hardened commit `119850a` passed Linux package run `34485046439` (x64+arm64) and Windows native run `34485046414` (publish/install/rollback/artifact). Engineering gates are green; promotion remains held for explicit owner approval and a project-wide root license decision. See `V0_9_RELEASE_REVIEW_2026-09-10.md` and `THIRD_PARTY_DISTRIBUTION_NOTICES.md`.

## v0.8 production-test proof
- ARM is the control Hub and enrolled Linux leaves connect outbound directly to `/device-channel/poll` and `/device-channel/result`; ChatGPT/Vercel never connects directly to a leaf.
- Leaf channel requests use Ed25519 device proof bound to action, timestamp, nonce and canonical payload hash. Replay/timestamp/account/device checks fail closed.
- Sessions bind to one device/node. Per-node session ceilings, offline/drain checks and explicit target routing are enforced before enqueue; a requested leaf is never silently replaced by ARM.
- Command delivery uses bounded queues, command leases/redelivery and idempotent completed-result receipts. The leaf `0600` command spool prevents a crash/restart from blindly executing an in-progress command twice.
- Real second-node acceptance passed with `VPS-AMD` (`linux/x64`): public Vercel opened independent ARM and AMD sessions; ARM returned `VPS-ARM:aarch64`, AMD returned `VPS-AMD:x86_64`.
- Draining AMD caused a fresh AMD-targeted session to return `409 target_node_draining`; undrain/cleanup restored AMD online with zero active sessions.
- Authoritative JSONL audit and authenticated Wall activity both attributed ARM and AMD job events to their exact node/device IDs. Vercel acceptance traffic had no warning/error/fatal runtime logs.
- Full ARM regression is green and the test crypto fixture is portable; no stable v0.8.0 tag has been cut. See `FLEET_ROUTING_V0_8.md`.

## v0.7 production-test proof
- `main` and `codex/v0.7-device-enrollment` converge on the v0.7 candidate.
- Device enrollment uses a 10-minute one-time code, a 256-bit poll token, local Ed25519 device keys, ARM-signed device certificates, explicit owner approval, capability subset enforcement, and signed heartbeat proof.
- Approval alone leaves the device offline; only a valid signed heartbeat makes it online. Device-local policy may reduce approved capabilities but cannot increase them.
- Public begin/poll/heartbeat travel through Vercel OIDC; owner list/approve/cancel/revoke additionally require the short-lived bridge session. No static shared Bearer is reintroduced.
- Live production proof passed begin -> approve -> offline -> poll/certificate verify -> signed heartbeat online -> revoke -> heartbeat 403, with test cleanup leaving zero pending enrollments.
- Wall `/enroll` and `/api/enrollments` pass authenticated live checks without regressing device/session/activity/SSE views.
- A real installed-layout bug (`/opt/lib/device-proof.mjs` missing) was caught during ARM deployment, fixed by an explicit host runtime manifest, and guarded by `selftest-host-install-layout.mjs`.
- At the v0.7 checkpoint remote command routing was deliberately deferred; that boundary is now superseded by the v0.8 fleet candidate. No stable v0.7.0 tag was cut.

## v0.6 production-test proof
- `main` and `codex/v0.6-device-presence` converged on the accepted candidate before production promotion.
- Vercel production built READY with 12/12 functions and Node 22.x.
- Anonymous `/api/operator?action=capabilities` returns 401 with upstream `bridge_session_required`; the public production bridge is not anonymous execution.
- Live `/api/auth` returns a 15-minute bridge session after the local operator credential check; the proof never prints the password or session token.
- Authenticated production proof passes capabilities, device listing (`arm-local`, node `arm`, online), 1-hour session lease (`3600000` ms), and clean session close.
- ARM host/gateway/Wall run v0.6.0-dev; Wall local auth, `/api/devices`, sessions, activity and SSE remain live-proof PASS.
- This is a production-test candidate, not the final public OAuth/account/device authorization release and not yet a stable v0.6.0 tag.

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
Fetch `/api/guide`, then read `AI_BRIDGE_GUIDE.md`, this file, `SESSION_OWNERSHIP_V0_5.md`, `HUB_TOPOLOGY_V0_5.md`, `SESSION_LANES_V0_4.md`, `PRODUCT_PLATFORM_PLAN_V0_6_TO_PUBLIC_PLUGIN.md`, `FLEET_ROUTING_V0_8.md`, `PLATFORM_ADAPTERS_V0_9.md`, `DEVICE_POLICY_V0_9_ACCEPTANCE_2026-09-10.md`, `LINUX_SIGNED_UPDATE_V0_9_ACCEPTANCE_2026-09-10.md`, and the latest dated handoff. RDC remains rescue-only during soak.
