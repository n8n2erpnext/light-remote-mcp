# Light Remote — Account, Device Connection and Agent Session Plan

Updated: 2026-09-11
Status: implementation plan / architecture lock replacing the temporary one-hour Plus pairing model

## 1. Problem statement
Light Remote must remove the need to keep a terminal open without turning every installed client into a permanent cloud connection. The local service is always alive on the device, while the cloud connection is finite and explicitly created by the user from Local Wall/Desktop App.

The product must keep four different concepts separate: account authentication, durable device identity, finite device cloud connection, and one-or-many ChatGPT/Agent working sessions. Conflating these concepts creates either poor UX (approve every chat) or unbounded server load (devices connected forever).

## 2. Locked invariants
- The Light Remote background service is always alive with the OS.
- Local Wall remains available while the cloud connection is dormant.
- No Terminal/PowerShell shell must be kept open to maintain Light Remote.
- Cloud device connections are finite. There is no Unlimited connection lease.
- A device connection has an absolute hard expiry set by plan entitlement.
- Agent idle/disconnect grace is separate from the hard device connection lease.
- One approved device connection may host multiple independent ChatGPT/Agent sessions.
- A new ChatGPT window does not require another approval while the relevant device access grant remains valid.
- Device, grant, Agent session, job and account login identities remain independently auditable.
- No silent target fallback is permitted.
## 3. Runtime hierarchy
`Account -> Device identity -> Device Connection Lease -> Device Access Grant -> many Agent Sessions -> Jobs`

Account login proves the user and plan. Device identity proves the enrolled machine. Device Connection Lease decides whether the machine may maintain an outbound cloud channel. Device Access Grant represents owner approval for remote-control work on that connected device. Agent Session represents one ChatGPT/Agent working lane and is never the device identity.

A single device may therefore show several lanes at once:

```text
VPS-A — CONNECTED
  Agent session A — ACTIVE
  Agent session B — HOLD
  Agent session C — ACTIVE
```

The same `agentId` may own one live lane per device. A session is target-bound; switching target creates/reuses the lane for that other device instead of mutating the original lane.

## 4. Device Connection Lease
A connection starts only after the user opens Local Wall/Desktop App and presses Connect. The client contacts the account/control server; the server verifies account, plan, entitlement, device binding and policy, then issues a finite hard lease.

Reference caps for the first implementation:
- Free: maximum 4 hours.
- Pro: maximum 24 hours.
- VIP: maximum 72 hours.

These are server-authoritative caps, not promises of billing SKU names. The implementation must allow policy configuration without changing the protocol. No plan may request Unlimited.
The hard lease is absolute. Tool activity must not silently renew it forever. When it expires the server rejects new work, closes all Agent sessions under that device connection, closes the access grant and tears down the cloud channel. The local service remains alive and Local Wall remains reachable.

After expiry the user must explicitly press Connect again. If the cached account login is still valid, the server may reconnect with one click. If account authentication has expired, the client must request login again before the server creates a new connection lease.

## 5. Agent idle/disconnect grace
The user configures one reconnect/idle grace per device in the 15–60 minute range. Initial default: 30 minutes.

This timer is not a connection lifetime. It only decides how long an Agent lane may remain recoverable after tool activity stops or transport disappears. There is no custom/unlimited Agent grace.

Session states are:
- `active`: recent tool activity.
- `hold`: recoverable but currently inactive/disconnected, or protected by an active durable job.
- `closed`: explicitly ended.
- `expired`: grace elapsed.

A returning Agent inside the grace resumes the same session/job/output lane. A returning Agent after terminal expiry creates a new lane. If the device access grant is still valid because other sessions are active, that new lane does not need another owner approval.

If no Agent sessions remain live and no tool activity occurs for the configured grace, the device access grant closes and the device connection may close early instead of consuming the rest of the hard lease.
## 6. Owner approval semantics
Approval is per device access grant, not per ChatGPT window. Several Agent sessions may attach to one approved grant. Human approval is not a fixed one-hour bearer lifetime.

Technical credentials may rotate internally, but token rotation must be invisible to the user while the device connection/grant remains valid. The user is asked to approve again only after the prior device access grant reaches a terminal state or is explicitly revoked.

The current ChatGPT Plus -> `@Vercel` compatibility lane must therefore stop binding human approval to one `agentId` with a hardcoded one-hour expiry. It should resolve a live device grant first, then create/reuse target-bound Agent sessions underneath it.

## 7. Local Wall and Desktop App
Local Wall is the control surface for exactly one local device by default. Desktop applications may embed it or open it in a browser.

Required local states:
- Service: `running` / local health.
- Cloud: `connected`, `hold/recovering`, or `dormant`.
- Account: signed-in identity or login required.
- Hard lease: connected-at, expires-at, remaining time and plan cap.
- Reconnect grace: 15–60 minutes.
- Sessions: all Agent lanes on this device with state, last activity, jobs and reconnect count.
- Controls: Connect, Disconnect now, End session, Revoke access, policy/capabilities, logs and maintenance.

VPS/Linux headless uses the same Local Wall contract. Windows/Linux/macOS Desktop adds native chrome/tray/service management but does not change authority semantics.

## 8. Account Portal and VIP fleet Wall
The hosted Account Portal is separate from Local Wall. After account login it lists every device bound to the account, usage, profile/security and plan/entitlement information.

All users may see their account-owned device inventory. VIP adds a convenience fleet Wall that aggregates several devices into one management screen. VIP does not merge device identities, leases, grants or sessions into one security context; each device remains isolated underneath the aggregate UI.
## 9. Server-load rule
The always-alive local service must not imply an always-open central connection. A dormant client performs no long-poll/cloud heartbeat loop. Only a user-created Device Connection Lease opens the outbound channel.

Within a live lease the channel may use long poll, streaming or a future transport, but the hard expiry and early-idle close are transport-independent. The server must be able to reap expired leases and all associated sessions even if the client disappears without a clean disconnect.

## 10. Durable jobs at hard expiry
A hard lease expiry blocks new tool calls immediately. Existing jobs enter terminating policy. Jobs explicitly marked session-bound may be stopped; safe background jobs may detach and continue locally but Light Remote loses control until a new connection is created. The server must persist the last known job/output state for audit and later inspection.

The first implementation must not introduce a blanket `kill -9` at lease expiry.

## 11. Migration from current v0.9 state
Current code has three mismatches that must be removed:
1. `plus-auth.mjs` binds approval to one `agentId` and hardcodes a one-hour session token.
2. `SessionRegistry` maps one live session per agent globally, which prevents clean one-agent-per-device lanes.
3. Session lease presets include 30m/1h/3h/custom semantics; the new model instead uses device-scoped reconnect grace (15–60m) plus a separate hard Device Connection Lease.

Current running-job HOLD behavior remains useful but becomes one HOLD reason rather than the whole HOLD model.

## 12. Implementation phases
P0 — model and regression: add this architecture lock, refactor SessionRegistry to one live lane per `(deviceId, agentId)`, implement 15–60m reconnect grace and explicit HOLD reasons, remove unlimited/custom lifetime semantics, and add regression tests.

P1 — device connection authority: add a durable Device Connection Registry with hard lease, plan caps, connect/disconnect/expire APIs, server-side reaping and close-by-device session cascade.

P2 — client service lifecycle: keep Windows/Linux service always alive locally, but make cloud polling conditional on a valid connection lease. Add dormant/connect/disconnect behavior without requiring Terminal.

P3 — Wall: add local device connection status, lease countdown, reconnect-grace setting, session tree, Connect/Disconnect and approval state. Keep the current owner fleet aggregate only as the VIP/reference view.

P4 — Plus bridge: replace one-hour agent-bound approval with device-grant-aware authorization; multiple ChatGPT windows attach as separate Agent sessions to the same approved grant. Keep Vercel-only continuity for Plus.

P5 — hosted account plane: signup/login, account/device ownership, plan entitlement, central Devices/Usage/Settings portal and account-auth refresh. Protocol surfaces implemented earlier must remain provider-neutral.
## 13. Acceptance gates
The architecture is accepted only when all of the following are proven:
- Local service survives Terminal close and OS session changes.
- Dormant state performs no continuous cloud poll loop.
- Connect creates one finite device lease and exposes its absolute expiry.
- Hard expiry closes all sessions for that device and blocks new execution.
- Reconnect grace cannot be set below 15m or above 60m.
- Same device + three distinct Agent IDs can work concurrently after one device approval.
- Same Agent ID can own separate sessions on different devices without target mutation.
- An Agent returning inside grace resumes the same lane; after expiry it cannot resume that lane.
- Device access approval is not requested again while its grant is valid.
- Account Portal inventory and VIP aggregate Wall never weaken per-device isolation.
- ARM, AMD and Windows still pass encrypted execution, file/Git/process/service operations and durable job/output recovery.
- Full standalone regression, package CI, Vercel production and reference fleet dogfood remain green.

## 14. Release discipline
This refactor changes a frozen v0.9 session/authority contract, so every behavior change requires a regression before deployment. Do not tag or publish stable v0.9 while the migration is partially enabled. Keep compatibility shims only where they preserve enrolled devices and rollback; do not preserve the incorrect one-hour human-approval semantics merely for compatibility.

Implementation checkpoints must be committed independently enough to roll back: model/tests, device-connection authority, client lifecycle, Wall, Plus bridge, then hosted account integration.
## 15. Implementation checkpoint — P0/P1
Implemented on 2026-09-11 before client dormant enforcement is enabled.

P0 is complete in source: Agent lanes are keyed by `(deviceId, agentId)`, reconnect grace is bounded to 15/30/45/60 minutes, explicit HOLD reasons exist, same Agent may own separate target-bound lanes on different devices, and Unlimited/3h session lifetime semantics are rejected.

P1 authority is implemented behind `OPERATOR_CONNECTION_LEASE_ENFORCE`. `DeviceConnectionRegistry` persists finite device leases, Free/Pro/VIP reference caps (4h/24h/72h), reconnect grace, hard expiry, explicit disconnect and server reaping. Executor routes expose connection read/connect/disconnect/grace/activity operations. Device disconnect cascades terminal close to that device's Agent lanes.

Migration safety: enforcement remains OFF by default until P2 teaches the always-alive client service to enter a truly dormant state without cloud polling and to reconnect only from Local Wall/Desktop App. This prevents the current ARM/AMD/Windows reference fleet from being stranded by a half-migrated protocol.

Regression checkpoint: 44 standalone selftests pass, including new device-connection registry and enforced endpoint tests. Root and Gateway production dependency audits report zero vulnerabilities.

## 15. Implementation checkpoint — P2 client dormant lifecycle
P0/P1 landed in commit `853811f`. P2 now implements the always-alive local service / finite-cloud-connection split without enabling hard-lease enforcement by default on the existing fleet.

- Linux/device agent stays alive in `daemon` while cloud state is `dormant`; dormant mode performs no cloud poll or heartbeat loop.
- Signed device operations now include `connect`, `disconnect` and reconnect-grace mutation.
- Hard-expiry/connection-required responses move the agent to dormant instead of creating a reconnect storm.
- Windows supervision separates local service lifetime from cloud desired state; Connect/Disconnect no longer means start/kill the local daemon.
- Device disconnect cascades terminal close to all Agent sessions for that device only.
- Enforcement remains behind `OPERATOR_CONNECTION_LEASE_ENFORCE` until installed clients and Wall controls complete migration.
- P2 local acceptance: 46/46 selftests, root/gateway audit 0, diff check clean; Windows native compilation remains a CI gate after push.
