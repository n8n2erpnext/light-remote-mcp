# Fleet Routing v0.8

Updated: 2026-09-09
Status: production-test candidate; not a stable tag

## Purpose

v0.8 turns ARM from the only executor into the first Hub. ChatGPT and Vercel continue to address one stable public bridge while enrolled leaf executors connect outbound to ARM.

Active topology:

`ChatGPT -> Vercel -> ARM Hub -> {ARM local, enrolled outbound leaves}`

The first accepted real leaf is `VPS-AMD` (`linux/x64`) with node/device ID `dev_700ad1e57b626a18ffad9339`.

## Routing invariants

- A session is bound to one `accountId + deviceId + nodeId`.
- `nodeId` may be omitted only for the backward-compatible ARM-local path.
- Leaf execution requires an explicit target `nodeId`.
- Offline, draining, identity-mismatched, or capacity-full targets fail closed.
- There is no silent fallback from a requested leaf to ARM or another node.
- Same-agent reuse across different target nodes is rejected instead of silently reusing the old lane.
- Each leaf advertises its own session ceiling; ARM retains its local global ceiling.
## Outbound leaf channel

The leaf agent does not accept an inbound Vercel or Hub connection. After v0.7 enrollment it long-polls the ARM Hub directly:

- `POST /device-channel/poll`
- `POST /device-channel/result`

Every channel request is Ed25519-signed by the enrolled device key and binds:

- device ID
- action
- timestamp
- random nonce
- canonical payload SHA-256

ARM validates enrollment binding, timestamp, signature, account/device identity and nonce replay before touching FleetRouter state. The private key remains on the leaf.

Default channel values:

- channel TTL: 20 seconds
- command lease: 12 seconds
- long-poll wait: 8 seconds
- per-node queue bound: 64 commands

Vercel OIDC remains the trusted Vercel-to-ARM transport for ChatGPT/owner calls; the leaf channel is separately authenticated by device proof and does not require a shared Bearer.
## Command delivery and crash safety

Hub command state is `queued -> dispatched -> completed`.

- A dispatched command has a lease and is redelivered if the lease expires without a result.
- Completed command receipts are cached so a repeated identical result is acknowledged as `duplicate:true` without duplicating output or job completion.
- Hub jobs and audit events retain the target `nodeId`, `deviceId`, session and operation ID.
- Owner drain blocks new sessions/jobs while allowing an already-running command to return its result.

The Linux leaf writes a local command spool under `~/.config/gpt-operator-agent/commands` with mode `0600` before execution. If the agent restarts after recording `running` but before recording the result, it reports a recovered-incomplete error and does not execute that command a second time.

## Capability boundary

A remote exec carries `requiredCapabilities`. ARM checks them against the enrolled/advertised node capabilities before enqueueing. The leaf checks the same requirement again against its local effective capability set before execution.

The local deny boundary may only reduce owner-approved capability. It cannot expand capability beyond the enrollment approval.

## Drain / reconnect

Owner control uses `POST action=node-drain payload={nodeId,draining}`. The leaf also supports local `operator-agent drain` / `undrain` state. Either side may make a node draining; routing remains fail-closed until both permit new work.
## Live acceptance — VPS-AMD

Production-test acceptance passed on 2026-09-09:

1. Enrolled `VPS-AMD` through the v0.7 owner device-code flow.
2. Installed the Linux systemd agent on AMD from the exact v0.8 candidate SHA.
3. ARM Fleet view showed ARM local plus AMD outbound leaf online simultaneously.
4. Opened independent sessions through public Vercel for ARM and AMD.
5. ARM exec returned `VPS-ARM:aarch64`.
6. AMD exec returned `VPS-AMD:x86_64` through the outbound command channel.
7. Draining AMD caused a new explicitly targeted AMD session to fail `409 target_node_draining` with no ARM fallback.
8. Undrain and cleanup left AMD online, not draining, with zero active sessions.
9. Authoritative audit and authenticated Wall activity attributed ARM and AMD jobs to their exact node/device IDs.
10. Vercel runtime during acceptance showed successful 200 calls plus only the intentional 409 drain guard, with no warning/error/fatal log entries.

## Scope boundary

v0.8 proves Linux ARM Hub + Linux x64 leaf routing. Windows/macOS execution adapters, broader packaging/distribution, hosted multi-tenant account isolation and public OAuth/App permission UX remain later roadmap work. No stable `v0.8.0` tag is implied by this production-test checkpoint.
