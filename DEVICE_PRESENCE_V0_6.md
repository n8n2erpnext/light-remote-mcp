# GPT Remote Operator — Device Presence v0.6

Updated: 2026-09-09
Status: branch foundation; not deployed to production
Branch: `codex/v0.6-device-presence`
Production remains: `v0.5.2` on `main`

## Purpose
v0.6 separates a device being online from an operator session being alive.

Invariant:

`device presence != operator session lease != Wall/browser lifetime`

A device daemon may remain online indefinitely while zero operator sessions exist. Closing or expiring a session must not mark the device offline. Viewing Wall must not renew either a device heartbeat or an operator session lease.

## Current branch model
The ARM executor currently self-registers one local device and is the first implementation of the future fleet registry.

Device record fields:
- `accountId`
- `deviceId`
- `nodeId`
- `displayName`
- `platform` / `architecture`
- `agentVersion`
- `state` (`online` / `offline`)
- `firstSeenAt` / `lastSeenAt` / `offlineAt`
- public device identity key placeholder
- capability list
- policy profile
- projected active-session count

## Presence behavior
`operator-host/device-registry.mjs` owns device presence state.

Current defaults:
- heartbeat interval: 30 seconds
- presence TTL: 90 seconds
- registry file: `/var/lib/gpt-vps-operator/devices.json`
- Linux systemd daemon uses `Restart=always`; explicit service stop remains authoritative, while unexpected/clean process termination is automatically recovered
- state file mode: `0600`
- heartbeat must be at least 5 seconds and strictly shorter than the presence TTL; invalid runtime configuration fails fast

Normal heartbeats update in-memory `lastSeenAt` without rewriting the state file or emitting an audit event every 30 seconds. Significant transitions are emitted: register, update, online recovery, explicit offline. Executor startup registers again and persists the current identity/state.

Device identity is guarded: reusing a `deviceId` with a different `accountId` or `nodeId` is rejected with `device_identity_conflict`.

## Session leases
v0.6 keeps the v0.5 default 30-minute lease but makes the lease a per-session value.

Current branch defaults:
- default: 30 minutes
- named presets: `30m`, `1h`, `3h`
- `custom` accepts an explicit `leaseMs` within policy bounds
- `Always Keep Alive` is explicitly rejected as future-only, not silently emulated
- minimum: 5 minutes in normal runtime
- maximum: 24 hours
- active jobs still force HOLD
- when the final active job completes, the same session-specific lease starts fresh

The session view and session audit events now carry `accountId`, `deviceId`, `nodeId`, `leaseMs` and `leasePreset`. One-agent/one-live-session ownership remains unchanged.

## Read-only surfaces
Executor:
- `GET /v1/devices`
- `GET /v1/devices/:deviceId`
- `POST /v1/sessions/open` accepts optional `leasePreset` (`30m` / `1h` / `3h` / `custom`) plus `leaseMs` for custom leases

Gateway/Vercel branch surfaces mirror the device reads. Wall receives `/api/devices` behind Wall auth and shows device state separately from session tabs.

The v0.6 Vercel bridge does not require a static shared caller Bearer. For production testing it uses a short-lived ARM-minted bridge session: `POST /api/auth` validates the current local operator login at ARM, returns a 15-minute session, and protected Vercel calls forward it as `x-bridge-session`. ARM requires that session in addition to Vercel -> ARM OIDC before operator or MCP tool execution. Wall cookies and bridge sessions are domain-separated and cannot be cross-used. Public-product authorization replaces the temporary local-login mint step with the account/device/ChatGPT OAuth-permission plane.

Wall device refresh is read-only. It does not call session touch/resume and therefore cannot extend a session lease. The browser refreshes device metadata at a bounded interval only to render TTL-based online/offline state; operator SSE remains the live job/activity path.

## Tests
`deploy/scripts/selftest-device-presence.mjs` proves registry behavior:
- TTL online -> offline transition
- heartbeat recovery to online
- identity-conflict rejection
- active-session projection
- persisted state reload

`deploy/scripts/selftest-device-endpoints.mjs` proves executor integration:
- capabilities expose device identity and lease presets
- `/v1/devices` returns the registered device online
- custom session lease is accepted within policy bounds
- device active-session count changes 0 -> 1 -> 0
- session carries device/account identity
- device state file is created and reloadable

`deploy/scripts/selftest-lease-presets.mjs` proves `30m` / `1h` / `3h` / `custom`, conflict rejection, missing custom duration rejection, invalid preset rejection, and explicit future-only rejection for Always Keep Alive.

`deploy/scripts/selftest-wall-node-tabs.mjs` proves NODE tabs select a node lane, filter jobs by `nodeId`, render node/device metadata, and rerender after device refresh. `deploy/scripts/selftest-vercel-function-budget.mjs` keeps the top-level Vercel API at or below the 12-function project ceiling; the current branch uses 11.

`deploy/scripts/selftest-shutdown-sse.mjs` proves executor SIGTERM closes active SSE clients and exits cleanly instead of waiting for the forced 5-second fallback.

`deploy/scripts/selftest-no-static-bearer.mjs` prevents the static shared Bearer boundary from being reintroduced and proves anonymous requests are rejected by the ARM bridge-session gate. `deploy/scripts/selftest-bridge-session-auth.mjs` proves login, missing/tampered-token rejection, Wall/Bridge token domain separation and gateway guard placement. Existing crypto, replay, tamper, operation-id idempotency, session ownership/HOLD/expiry/capacity and Wall realtime tests remain regression requirements.

## Not implemented yet
- remote device enrollment/device-code flow
- account-backed device authorization
- device private/public key provisioning
- outbound ARM <-> remote-node control transport
- AMD/HomeLab executor routing
- Windows Service or macOS launchd agent
- Always Keep Alive commercial/session policy

Those remain later roadmap stages. The branch must not claim multi-node execution until a second real executor is enrolled and routed through the ARM Hub.
