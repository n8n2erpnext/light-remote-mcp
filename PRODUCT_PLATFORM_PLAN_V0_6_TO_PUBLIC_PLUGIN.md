# GPT Remote Operator — Product & Platform Plan

Updated: 2026-09-09
Status: active product plan
Current implementation baseline: v0.5.0 single-node ARM production closure

## 0. Product direction

The project started as a private replacement path for Remote Desktop Commander usage limits. It has evolved into a self-hosted / hosted remote AI operator control plane for ChatGPT.

The product goal is not "SSH exposed to an LLM". The product goal is:

`ChatGPT -> official App/Plugin -> public MCP gateway -> account/session control plane -> outbound device agent -> governed local executor`

Core product properties:

- No user laptop or terminal must stay open to keep an SSH session alive.
- Device presence is maintained by a lightweight local daemon/service.
- Operator sessions are logical leases, not TCP/SSH lifetime.
- Jobs live independently from ChatGPT/Vercel request lifetime.
- A dropped ChatGPT/network connection can resume the same owned session while its lease/job is valid.
- One agent instance owns one live session lane for clean audit.
- Multiple agents may operate concurrently; Git/worktree/repo discipline handles collaboration instead of global locks.
- Wall/audit are observability surfaces, never execution authority.
- Device owner policy remains the final local authority.
- Linux, Windows and macOS share one protocol with platform-specific adapters.
- Deterministic policy is authoritative; learned "Frog" safety is additive and fail-open relative to operator availability, never the sole safety boundary.

## 1. Current production truth — v0.5

Current path:

`ChatGPT -> Vercel bridge -> ARM MCP gateway -> Unix socket -> host executor (ubuntu)`

Accepted capabilities:

- encrypted privileged envelopes: X25519 + HKDF-SHA256 + AES-256-GCM
- Vercel OIDC identity at the gateway
- replay protection and semantic operationId idempotency
- host execution as ubuntu with sudo-on-demand, Docker, LXD, Git, build/test
- async jobs, output retrieval, timeout handling
- disk authoritative JSONL audit + bounded wall ring
- 30-minute idle lease
- automatic HOLD while one or more jobs are running
- fresh 30-minute post-job reconnect grace
- one agentId -> one live session lane
- different agent cannot resume/exec/read another lane
- live session target/ceiling: 1-5
- read-only wall with ALL + per-session tabs
- independent local Wall authentication with scrypt password verification, HMAC-signed HttpOnly/Secure/SameSite=Strict session cookie and login throttling; NetBird may remain as an optional outer defense
- near-real-time Wall delivery: SSE primary, bounded 1-second head probe/catch-up fallback, deduplicated replay and batched DOM rendering
- nodeId/sessionId/agentId carried through jobs and logs
- ARM is the first node and future control-hub anchor

## 2. v0.5.0 closure — completed 2026-09-09

Completed before opening v0.6:

1. Make all self-tests reusable/idempotent across repeated runs.
2. Run:
   - syntax checks
   - npm audit root/gateway
   - crypto/replay/tamper test
   - operationId idempotency test
   - session ownership/HOLD/expiry/capacity test
   - systemd capability test
   - wall inline JS/session-tab/SSE/realtime fallback test
   - independent Wall local-auth/cookie/tamper/rate-limit test
3. Run a live ChatGPT -> Vercel -> ARM session:
   - session-open
   - simple read/exec
   - async job
   - session ownership mismatch proof
   - session status and output retrieval
4. Verify independent Wall local auth is enforced; verify NetBird still works as an optional outer layer; verify execution MCP tool calls remain Vercel-OIDC protected.
5. Reconcile CURRENT_STATE.md and AI_BRIDGE_GUIDE.md.
6. Commit cleanly and tag v0.5.0.
7. Continue using RDC only as rescue during soak and specifically while rebuilding/restarting the bridge being tested.

## 3. v0.6 — Device Presence & Control Plane

Separate three concepts permanently.

### Device presence

A lightweight local service runs continuously:

- Linux: systemd
- Windows: Windows Service
- macOS: launchd

The daemon keeps an outbound authenticated control channel to the Hub. It does not require a shell session or open terminal.

Presence record:

- accountId
- deviceId
- nodeId
- displayName
- platform / architecture
- agent version
- online/offline
- firstSeenAt / lastSeenAt
- public device identity key
- capabilities
- policy profile
- current active session count

Device presence may stay online indefinitely and should not be monetized as an "active operator session".

### Operator session lease

A session is created only when the user or ChatGPT asks to work on a device.

Lease presets:

- 30 minutes
- 1 hour
- 3 hours
- custom
- Always Keep Alive (future paid tier)

Rules:

- any valid session-aware tool call renews an active timed lease
- active jobs force HOLD and suspend lease expiry
- final job completion starts a fresh configured grace period
- session close releases capacity immediately
- expired/closed sessions stay in audit history but consume no live slot
- device remains online after session expiry
- one agent instance owns one session lane
- a second agent cannot silently share/take over that lane
- explicit handoff/release can be added later
- default hosted/self-hosted target remains 1-5 live sessions per node, configurable

### Wall / Console

Wall does not keep a session or device alive.

The future console contains:

- Devices
- Sessions
- Activity / Wall
- Account
- Policy
- Billing (hosted edition)

Example:

`ARM VPS  ● online  sessions 3/5  [Connect]`
`AMD VPS  ● online  sessions 2/5  [Connect]`
`HomeLab  ● online  sessions 1/5  [Connect]`

Wall tabs:

- ALL
- per node
- per live session
- history search for expired sessions

Current wall remains read-only. Execution remains behind MCP/control APIs.

### v0.6 implementation checkpoint — 2026-09-09

Branch `codex/v0.6-device-presence` now contains the branch-only foundation: persistent local device registry, device/account/node identity propagation, independent heartbeat/TTL presence, named `30m` / `1h` / `3h` plus custom per-session leases, read-only device/session state in executor/gateway/Vercel/Wall, body-safe structured POST operator transport, and repeatable device/presence/lease regressions. Production remains tagged `v0.5.2`; this checkpoint is not deployed and does not claim remote-node transport. See `DEVICE_PRESENCE_V0_6.md`.

## 4. v0.7 — Device Enrollment

Public onboarding must not require users to paste SSH keys or long-lived bearer tokens.

First-time flow:

1. User installs device agent.
2. Runs `operator-agent login` once.
3. Terminal prints:
   - activation URL
   - short one-time device code
4. User opens URL on any browser/phone and signs in.
5. User approves device name and requested capability profile.
6. Device creates its private key locally.
7. Server stores/binds only the corresponding public identity.
8. Device establishes its outbound control channel.
9. From then on the terminal no longer needs to remain open.

Enrollment requirements:

- short-lived device code
- one-time use
- explicit account approval
- device fingerprint summary
- capability discovery
- device policy enforcement
- local private key
- local final deny boundary

Example fleet view:

- Vercel/GPT -> ARM Hub
- ARM -> 3 live sessions
- AMD -> 2 live sessions
- HomeLab -> 1 live session

The ChatGPT-facing URL never changes when a new node is enrolled.

## 5. v0.8 — ARM Hub & Fleet Routing

ARM remains the first control-hub node. Additional executors connect outbound to the Hub; ChatGPT/Vercel does not connect directly to leaf executors.

Fleet requirements:

- per-device/node identity and capability advertisement
- authenticated outbound node channel with reconnect/backoff
- explicit target-node routing; no silent execution on a different node when the requested target is offline
- per-node session ceilings and health
- fan-in audit and Wall views across nodes
- account/device isolation before hosted multi-tenant use
- safe drain/reconnect semantics for node upgrades

Acceptance: enroll one second AMD/HomeLab node, execute independent sessions on ARM and the new node, and prove Wall/audit attribution remains exact.

## 6. v0.9 — Platform Adapters

### Linux

Primary adapter:

- bash/zsh
- filesystem
- Git
- Node/Python/Rust/build tools
- Docker/Compose
- LXD
- systemd/journalctl
- package managers
- sudo on demand

### Windows

Windows agent runs as a Service. Default execution adapter is PowerShell 7 when available, with native process execution where appropriate.

Capabilities:

- PowerShell
- filesystem/NTFS
- Git
- Node/Python/Rust
- Docker Desktop/CLI
- Windows Services
- Event Log
- winget/choco
- process/network inspection
- native Windows/Electron build/sign tooling

Windows-specific protected areas include:

- Registry
- Scheduled Tasks
- Services/drivers
- Defender/Firewall
- SAM/SECURITY hives
- Credential Manager
- encoded/obfuscated PowerShell
- UAC/privilege escalation paths

### macOS

Initial target is developer-owned Macs/Mac mini servers.

Developer/self-hosted install may be terminal-first:

- binary/package install
- launchd service
- zsh/bash
- git/node/python/rust
- Docker
- brew
- launchctl
- xcodebuild / Swift tooling

Public distribution later adds:

- Developer ID signing
- hardened runtime
- notarization
- stapling
- signed pkg/dmg/updater

macOS protected capabilities:

- Keychain
- Full Disk Access
- Automation/Apple Events
- Accessibility
- privileged system paths
- sudo

Distribution trust is the main macOS complexity; the remote operator protocol itself remains the same.

## 7. v1.0 — Governed Safety Plane

Public App/Plugin must obey both OpenAI permissions/confirmations and our own independent safety model.

Authority stack:

`OpenAI/ChatGPT permission -> server policy -> device-local policy -> executor`

User approval in ChatGPT never overrides a device-local hard deny.

Policy tiers:

### READ
Examples:
- read/list/search files
- git status/diff/log
- docker ps/logs
- health/status

### WRITE
Examples:
- edit normal project files
- build/test
- git add/commit
- project package install

### PRIVILEGED / ASK
Examples:
- git push/deploy
- docker compose mutate
- system service restart
- system package changes
- sudo
- privileged config writes

### HARD DENY
Examples/effects:
- block-device destruction
- root filesystem destruction
- credential harvesting/export
- disabling mandatory local safety policy
- unauthorized firewall/security bypass
- destructive boot/kernel/security-store changes
- deliberate policy bypass/obfuscation where intent cannot be safely resolved

Do not rely on keyword regex alone. The policy engine evaluates effect/capability, shell nesting, encoded payloads, download-and-execute, privileged paths, credential paths, block devices, network/security changes and command context.

Public MCP should prefer structured tools such as:

- read_file
- write_file
- search
- git_status
- git_diff
- git_commit
- git_push
- run_build
- run_tests
- process_start
- process_status
- docker_compose
- service_operation
- exec_batch_advanced

Advanced arbitrary.exec stays policy-governed and may be disabled by profile.

High-risk governed workflows should capture pre-state, validate mutation and verify post-state.

Examples:

- nginx: backup -> edit -> nginx -t -> reload -> health check
- docker: compose config -> build/pull -> up -> health
- git deploy: clean/status -> test/build -> commit/push -> verify

## 8. Adaptive Safety — Frog Layer

Reuse the Sentinel/Frog concept as a learned advisory safety layer.

Initial deployment: 1-3 small observers.

Possible roles:

- Frog A: intent and tool-call sequence context
- Frog B: command/effect risk
- Frog C: per-device/per-agent behavioral anomaly

Learning flow:

`observe -> learn -> explain -> risk score -> shadow decision -> bounded intervention`

Inputs after redaction:

- agentId/sessionId/nodeId
- tool/capability
- cwd/repo
- command/action structure
- Git state
- stdout/stderr/exit
- preceding call sequence
- deterministic policy result
- user confirmation result

Never train on raw secrets. Redact tokens/passwords/private keys/cookies before Frog input.

Rollout:

1. shadow only
2. warnings
3. ask/confirmation recommendation
4. bounded temporary hold for extreme confidence

Deterministic policy remains authoritative.

Invariant:

`Frogs may fail. The operator must not fail merely because the learned advisory layer is unavailable.`

## 9. Official ChatGPT App/Plugin Track

The eventual public product replaces the Vercel relay with our own hosted MCP/control service.

Target:

`ChatGPT App/Plugin -> our public MCP -> Hub -> enrolled user device`

Requirements before submission:

- explicit user authorization/consent
- clear read vs write vs privileged tool descriptions
- confirmation for sensitive actions where required
- privacy policy and minimal data collection
- account isolation
- device isolation
- deterministic dangerous-action policy
- auditable action history
- revoke device/session/account paths
- no secret-bearing URLs
- rate limits and abuse controls
- clear product support/contact/privacy surfaces

The current Vercel bridge remains a development transport and regression oracle until the hosted MCP is ready.

## 10. Hosted vs self-hosted editions

### Self-hosted
- open-source device agent
- open-source/private Hub deployment
- owner control of policy and infrastructure
- local/internal wall possible
- no mandatory hosted subscription

### Hosted
- account login
- managed hub/broker
- device enrollment
- console
- official ChatGPT App/Plugin
- fleet wall
- plan limits
- premium Always Keep Alive / larger concurrency / longer history as possible commercial features

Do not monetize basic device online presence. Monetization should attach to managed control-plane value, concurrency, retention and premium session behavior.

## 11. Security invariants

- Device agents initiate outbound connections.
- Do not expose executor TCP directly to the Internet.
- Public gateway does not mount Docker socket.
- Device private identity keys remain local.
- Privileged execution stays behind authenticated/encrypted envelopes.
- Replay protection and semantic idempotency remain mandatory.
- One agent instance cannot silently share another session.
- Audit identifiers always include account/device/node/session/agent/request/operation/job.
- Wall is read-only and is never required for execution.
- Secrets are redacted from wall/logging/learned-safety inputs.
- Hard deny policy cannot be disabled by ChatGPT permission alone.
- Git/resource collaboration is not globally locked by the operator.
- Backup/validate/rollback discipline is required for risky configuration mutations.

## 12. Development transport rule

During development:

- Use the project's own ChatGPT -> Vercel -> ARM operator path for normal coding, reads, tests and acceptance.
- When an operation may rebuild/restart the MCP gateway/operator/control path currently carrying that call, switch to RDC rescue channel for the disruptive step.
- After restart/build, immediately return to the self-hosted operator path and prove the new path end-to-end.
- Avoid making RDC the normal execution path; it is a rescue/failover channel during soak.
- Production v0.5.x keeps `/api/operator` GET/query/base64 as bootstrap-only compatibility. The v0.6 branch adds authenticated structured POST/body transport and caps legacy GET payloads to small calls with deterministic rejection when too large. RDC remains rescue-only for self-disruptive steps. The public product should converge on Streamable HTTP/POST or an equivalent body-safe transport and must not carry secrets in URLs.

## 13. Execution order from here

### Phase 1 — close v0.5
- fix reusable systemd selftest
- rerun all tests
- live Vercel acceptance
- reconcile docs
- commit/tag v0.5.0

### Phase 2 — v0.6 device-presence model
- device registry schema
- separate presence from operator session
- configurable lease presets
- console model for device/session state
- no browser dependency for session survival

### Phase 3 — enrollment
- device-code flow
- device key generation/binding
- revoke/rotate
- outbound control channel

### Phase 4 — second node / fleet
- enroll one AMD or HomeLab executor
- Hub routing and fan-in
- fleet wall
- prove multiple nodes and multiple sessions

### Phase 5 — platform adapters
- Windows PowerShell service
- macOS launchd/dev install
- capability-specific safety rules

### Phase 6 — governed public safety
- structured public tools
- server policy engine
- device policy profiles
- confirmation semantics
- Frog shadow mode

### Phase 7 — hosted control plane + official ChatGPT App/Plugin
- accounts/auth
- managed MCP
- console
- billing/plan model
- privacy/support/review package
- OpenAI submission

## 14. Product acceptance definition

The system is ready to call an RDC-class replacement for this project when:

- a user installs/enrolls a device once
- no terminal/SSH/browser must remain open
- ChatGPT mobile can connect and work
- long builds survive request/network disconnects
- same agent resumes its lane
- different agents receive separate lanes
- 1-5 simultaneous sessions remain cleanly auditable
- wall can view ALL or individual sessions
- privileged Linux development workflow is practical
- device/server restart failure modes are documented/recoverable
- security and audit remain intact

It becomes a public product only after account isolation, device enrollment, platform policy, dangerous-command controls and official App/Plugin review requirements are complete.
