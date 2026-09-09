# GPT Remote Operator — Device Presence v0.6

Updated: 2026-09-09
Status: branch foundation; not deployed to production
Branch: `codex/v0.6-device-presence`
Production remains: `v0.5.0` on `main`

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
- state file mode: `0600`
- heartbeat must be at least 5 seconds and strictly shorter than the presence TTL; invalid runtime configuration fails fast

Normal heartbeats update in-memory `lastSeenAt` without rewriting the state file or emitting an audit event every 30 seconds. Significant transitions are emitted: register, update, online recovery, explicit offline. Executor startup registers again and persists the current identity/state.

Device identity is guarded: reusing a `deviceId` with a different `accountId` or `nodeId` is rejected with `device_identity_conflict`.

## Session leases
v0.6 keeps the v0.5 default 30-minute lease but makes the lease a per-session value.

Current branch defaults:
- default: 30 minutes
- minimum: 5 minutes in normal runtime
- maximum: 24 hours
- active jobs still force HOLD
- when the final active job completes, the same session-specific lease starts fresh

The session view and session audit events now carry `accountId`, `deviceId`, `nodeId` and `leaseMs`. One-agent/one-live-session ownership remains unchanged.

## Read-only surfaces
Executor:
- `GET /v1/devices`
- `GET /v1/devices/:deviceId`
- `POST /v1/sessions/open` accepts optional `leaseMs`

Gateway/Vercel branch surfaces mirror the device reads. Wall receives `/api/devices` behind Wall auth and shows device state separately from session tabs.

Wall device refresh is read-only. It does not call session touch/resume and therefore cannot extend a session lease. The browser refreshes device metadata at a bounded interval only to render TTL-based online/offline state; operator SSE remains the live job/activity path.

## Tests
`deploy/scripts/selftest-device-presence.mjs` proves registry behavior:
- TTL online -> offline transition
- heartbeat recovery to online
- identity-conflict rejection
- active-session projection
- persisted state reload

`deploy/scripts/selftest-device-endpoints.mjs` proves executor integration:
- capabilities expose device identity
- `/v1/devices` returns the registered device online
- custom session lease is accepted within policy bounds
- device active-session count changes 0 -> 1 -> 0
- session carries device/account identity
- device state file is created and reloadable

Existing v0.5 crypto, replay, tamper, operation-id idempotency, session ownership/HOLD/expiry/capacity and Wall realtime tests remain regression requirements.

## Not implemented yet
- remote device enrollment/device-code flow
- account-backed device authorization
- device private/public key provisioning
- outbound ARM <-> remote-node control transport
- AMD/HomeLab executor routing
- Windows Service or macOS launchd agent
- Always Keep Alive commercial/session policy

Those remain later roadmap stages. The branch must not claim multi-node execution until a second real executor is enrolled and routed through the ARM Hub.
