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

If no Agent sessions remain live and no tool activity occurs for the configured grace, the Device Access Grant closes. Agent inactivity does not close the Device Connection Lease; that lease remains valid until explicit Disconnect, revoke/authority failure, or its absolute hard expiry.
## 6. Owner approval semantics
Approval is per device access grant, not per ChatGPT window. Several Agent sessions may attach to one approved grant. Human approval is not a fixed one-hour bearer lifetime.

Technical credentials may rotate internally, but token rotation must be invisible to the user while the device connection/grant remains valid. The user is asked to approve again only after the prior device access grant reaches a terminal state or is explicitly revoked.

The current ChatGPT Plus -> `@Vercel` compatibility lane must therefore stop binding human approval to one `agentId` with a hardcoded one-hour expiry. It should resolve a live device grant first, then create/reuse target-bound Agent sessions underneath it.

## 7. Local Wall and Desktop App
Local Wall is the observer/control surface for exactly one local device by default. It uses the same operator-stream/session-lane/history experience as the owner reference Wall, but is scoped to one device. Desktop applications may embed it or open it in a browser. Closing or reloading Wall must never keep alive or terminate the service, cloud lease, access grant, Agent sessions, or durable jobs.

Required local states:
- Service: `running` / local health.
- Cloud: `connected`, `hold/recovering`, or `dormant`.
- Account: signed-in identity or login required.
- Hard lease: connected-at, expires-at, remaining time and plan cap.
- Reconnect grace: 15–60 minutes.
- Sessions: all Agent lanes on this device with state, last activity, jobs and reconnect count.
- Controls/observability: device/cloud status, Agent session lanes, live operator stream, command/output history, policy/capabilities and maintenance. Connection controls may be exposed by the device App/Wall, but Wall presence itself is never a keepalive mechanism.
- Approval UX: `/approve` accepts the short code, resolves only a pending request for this device, offers Approve/Deny, then reports success and returns to `/`. Approval never asks for a duration and never creates or extends the Device Connection Lease.
- Security boundary: loopback-only Wall may rely on local-machine access, but any non-loopback/private/VPN bind **must fail closed unless device-local Wall authentication is configured**. Reverse proxy/TLS/NetBird may add outer defense but do not replace the Wall owner session. A code display, `/approve`, status/activity/SSE, Connect/Disconnect, policy and maintenance all sit behind that owner session.

VPS/Linux headless uses the same Local Wall contract. Windows/Linux/macOS Desktop adds native chrome/tray/service management but does not change authority semantics.

## 8. Account Portal and VIP fleet Wall
The hosted Account Portal is separate from Local Wall. After account login it lists every device bound to the account, usage, profile/security and plan/entitlement information.

All users may see their account-owned device inventory and manage the account-approved permission ceiling for each of their devices from a per-device Permissions page. That page must expose only capabilities the device declares grantable; device-local policy remains the final deny boundary. VIP adds only a convenience fleet Wall that aggregates several devices into one management screen. VIP does not merge device identities, leases, grants, permissions or sessions into one security context; each device remains isolated underneath the aggregate UI.
## 9. Server-load rule
The always-alive local service must not imply an always-open central connection. A dormant client performs no long-poll/cloud heartbeat loop. Only a user-created Device Connection Lease opens the outbound channel.

Within a live lease the channel may use long poll, streaming or a future transport. The Device Connection hard expiry is absolute; Agent/session and Device Access Grant idle expiry are separate child lifecycles and must not reap the parent Device Connection. The server must still reap expired hard leases and associated child state even if the client disappears without a clean disconnect.

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

P4 — Plus bridge: replace one-hour agent-bound approval with device-grant-aware authorization and prove the Wall/Agent/session lifecycle over the current Vercel compatibility lane.

P4.5 — A/B device pairing and agent-facing golden path: remove pre-authorization device discovery from the normal bootstrap. Local Wall rotates a short-lived one-time A code. The Agent submits A directly; server resolves exactly one connected device, consumes A, creates a B challenge, and returns B to the Agent. The owner enters B at that exact device Wall `/approve` and explicitly Approves/Deny. Approval creates an authorized device binding for the current Agent client session. A client session may contain several independently approved devices and may then list/route work across that authorized set. The normal Agent surface must be high-level and token-efficient (`connect`, `list_devices`, execution/job/output, disconnect); fleet/account/capability discovery stays advanced/debug only.

P5 — hosted account plane: signup/login, account/device ownership, plan entitlement, central Devices/Usage/Settings portal and account-auth refresh. Account identity remains useful for licensing/portal/VIP fleet management, but is not required to discover the first device when A/B pairing is used. Protocol surfaces implemented earlier must remain provider-neutral.
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
- A code is generated only from the exact device Wall, has a short TTL, is one-time, and is invalid after successful redemption, rotation, disconnect, connection identity change or hard expiry.
- Possessing A alone never grants access: successful A redemption must return a B challenge and execution remains blocked until B is confirmed and explicitly approved on the same device Wall.
- B is one-time, short-lived, request/device/connection-bound and cannot be approved from another device.
- Normal Agent bootstrap does not enumerate account/fleet/devices/capabilities before pairing; an A code goes directly to the high-level connect entrypoint.
- One Agent client session may hold several independently approved devices and list only that authorized set; routing Task A to Device A and Task B to Device B must preserve separate grants, sessions and disconnect lifecycles.
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

## 16. Implementation checkpoint — P2 client dormant lifecycle
P0/P1 landed in commit `853811f`. P2 now implements the always-alive local service / finite-cloud-connection split without enabling hard-lease enforcement by default on the existing fleet.

- Linux/device agent stays alive in `daemon` while cloud state is `dormant`; dormant mode performs no cloud poll or heartbeat loop.
- Signed device operations now include `connect`, `disconnect` and reconnect-grace mutation.
- Hard-expiry/connection-required responses move the agent to dormant instead of creating a reconnect storm.
- Windows supervision separates local service lifetime from cloud desired state; Connect/Disconnect no longer means start/kill the local daemon.
- Device disconnect cascades terminal close to all Agent sessions for that device only.
- Enforcement remains behind `OPERATOR_CONNECTION_LEASE_ENFORCE` until installed clients and Wall controls complete migration.
- P2 local acceptance: 46/46 selftests, root/gateway audit 0, diff check clean; Windows native compilation remains a CI gate after push.

## 17. Implementation checkpoint — P3 Local Wall
P2 is committed as `ee87985`; Linux Server, Linux Client and Windows Native Client GitHub Actions all completed successfully, including the real Windows compile/install/rollback lane.

P3 now adds a loopback-only Local Wall served by the always-alive client service at `127.0.0.1:5491`. It exposes this-device service/cloud state, finite lease countdown, reconnect grace (15/30/45/60m), Agent session tree, and Connect/Disconnect controls. The Local Wall performs no remote status call while the device is Dormant.

The device channel now has a signed `status` operation scoped to the calling device; it returns only that device's connection state and active/held Agent sessions. Linux service installation no longer requires enrollment first, so service + Wall may stay alive before login/enrollment. Windows tray/app exposes an Open Local Wall action and packages the same Wall runtime/assets.

P3 local acceptance: 48/48 standalone selftests, root/gateway audit 0, syntax checks and diff check clean. Enforcement remains migration-gated until the installed reference fleet is upgraded to a client containing the dormant/Wall lifecycle.
## 18. Implementation checkpoint — P4 Device Access Grant / Plus bridge
P3 is committed as `ab11c6a`. P4 replaces the temporary one-hour, agent-bound Plus approval with a persistent server-side Device Access Grant bound to `(accountId, deviceId, connectionId)`.

- `authorize-begin` now requires one explicit connected `deviceId`. Pre-authorization `devices-bootstrap` exists only to select that device.
- If the current Device Connection already has an active grant, another ChatGPT window receives its own scoped `ps` capability without another owner approval.
- If no grant exists, the selected device receives a pending access request through its signed device channel. Local Wall is the approval authority; hosted `/plus-authorize` is informational only.
- Local Wall Approve/Deny uses Ed25519-signed `access-approve` / `access-deny`; one approval resolves all pending ChatGPT requests for the same device connection.
- `ps` is scoped to `grantId + deviceId + connectionId`, is not agent-bound, and cannot outlive the finite Device Connection Lease. Every protected call re-validates the grant server-side.
- Durable Agent lanes remain independently owned by `(deviceId, agentId)`. A grant for one device cannot open, resume, inspect, execute, read jobs/output, or enumerate sessions from another device.
- Device disconnect, hard lease expiry, device revoke, or connection identity change closes the grant and terminally closes that device's Agent lanes. A later connection therefore requires a new owner approval.
- Plus `devices`, `fleet`, and `sessions` responses are filtered to the granted device; encrypted execution is re-bound at the operator-host grant boundary before job start.

P4 local acceptance: 49/49 standalone selftests PASS, including a dedicated persistent Device Access Grant regression; root/gateway production audits report zero vulnerabilities; diff and syntax checks PASS. Production deployment remains held until this checkpoint is committed, CI is green, and the reference fleet is upgraded safely.


## 19. P4.5 architecture lock — A/B device pairing and multi-device Agent set
This checkpoint supersedes `devices-bootstrap -> choose device -> authorize-begin` as the **public golden path**. The older device-id bootstrap remains compatibility/debug-only until all callers migrate. It must not be taught to normal Agents.

### 19.1 Two-code handshake
- **A code — device discovery/pairing challenge.** Generated by the Local Wall of exactly one device, rotated on a new Wall visit/reload, short-lived (target 2–5 minutes), one-time, and bound to the current `deviceId + connectionId`. Rotation invalidates the prior A code; a very short overlap may be added only if a measured browser race requires it. Server stores only a verifier/hash where practical.
- User gives A to ChatGPT/Codex/Claude. The Agent calls the high-level Light Remote connect primitive directly; it must not enumerate devices/fleet/account/capabilities first.
- Redeeming A resolves the exact connected device and consumes A immediately. **A never creates execution authority.**
- **B code — access approval challenge.** Server creates a fresh pending access request after A redemption and returns only B plus an opaque continuation to the Agent. B is short-lived, one-time, and bound to request + device + connection.
- User enters B at that same device Wall `/approve`. Wall resolves the pending request, shows the requester label, then offers only `Approve` / `Deny`. No time selector, Connect action, lease duration or session duration belongs on this screen. Success returns to `/`.
- Approve establishes the Agent-to-device authorized binding and may create/reuse the underlying Device Access Grant; Deny creates no binding. A copied A or copied B is insufficient by itself to obtain execution authority.

### 19.2 Agent client session and authorized device set
A ChatGPT/Codex conversation may authenticate several devices independently. The Agent-facing state is therefore `client session -> authorized device bindings`, not `one ChatGPT -> one device`. Each binding remains backed by its own `deviceId + connectionId + Device Access Grant` and its own target-bound Agent session lane.

After the first successful A/B handshake the runtime returns/maintains one opaque client-session handle. Additional A/B handshakes attach more device bindings to that same client session. `list_devices` returns **only currently authorized bindings for that client session**, with compact labels/state; it is not account inventory and is never a pre-auth discovery mechanism.

If exactly one authorized device is live, an unqualified task may route there. If several are live and the user did not identify a target, the Agent asks which authorized device to use. Explicit requests such as `Task A on AMD, Task B on Windows` may execute concurrently. Disconnect/revoke/expiry of one device removes only that binding and closes only that device's child sessions/jobs according to existing lifecycle rules.

### 19.3 Token/latency contract for Agents
The normal tool contract must expose the smallest useful state machine: `need_a_code -> approval_required -> ready`, then normal remote operations. A supplied A code goes straight to connect. Normal bootstrap must not call `devices-bootstrap`, `fleet`, `capabilities`, account lookup, or broad status probes. Internal IDs and authority metadata stay hidden unless a recovery/debug action needs them.

Target compact responses:
```json
{"status":"approval_required","code":"EJHL-LJBA","continuation":"<opaque>"}
```
then after approval:
```json
{"status":"ready","device":"VPS-AMD","client":"<opaque>"}
```
Operational errors collapse to deterministic actionable states such as `need_a_code`, `approval_required`, `approval_expired`, `device_offline`, `access_revoked`, and `ready`; low-level grant/connection/session details remain available only in diagnostics.

### 19.4 P4.5 implementation order
1. Add short-lived A-code registry with hash/verifier storage, rotation, consumption and connection binding.
2. Add signed device-channel A-code rotation endpoint and Local Wall A-code display/refresh behavior. Wall is still observer/control only; closing it never affects runtime.
3. Add high-level Plus/Vercel `connect` begin/poll contract: A in -> B out -> B approval -> ready. Force B approval for a new Agent-device pairing even if the underlying device grant already exists, so leaked A alone is never sufficient.
4. Add Agent client-session registry and per-device authorized bindings; keep underlying Device Access Grants per device/connection.
5. Add compact `list_devices` and explicit target routing across the authorized set; preserve concurrent per-device sessions/jobs.
6. Mark `devices-bootstrap` and broad discovery as compatibility/debug-only and add machine-readable instructions forbidding their use on the golden path.
7. Extend Wall live activity with A rotation/redeem, B requested/approved/denied and binding events without logging A/B plaintext after issuance.
8. Regression/security gates: replay/expiry/rotation, wrong-device B, disconnect during handshake, active-grant bypass attempt, brute-force rate limits, multi-device isolation, concurrent Task A/Task B, Wall-close invariance, token-size/response-budget checks.
   Non-loopback Wall additionally requires login/session/CSRF regressions: unauthenticated page redirect, API/SSE 401, scrypt verifier with no plaintext password, signed HttpOnly/SameSite cookie, login throttling, tamper rejection, and no authority leakage through a reverse proxy.
9. Live acceptance through ChatGPT Plus -> Vercel -> ARM -> two separately paired devices. RDC remains rescue-only; final acceptance must not depend on it.

P4.5 source checkpoint now includes A registry, A->B connect/poll, idempotent approved poll, Agent-client multi-device bindings, compact authorized-device listing/routing, and fail-closed non-loopback Local Wall authentication. Before P5 account registration/login exists, hosted Wall and device Wall intentionally share the same transitional `operator` credential for consistent owner UX while keeping independent cookie-signing secrets per Wall. P5 replaces this bootstrap credential model with registered account login without changing A/B pairing or per-device approval semantics. It remains **in progress until live two-device acceptance is complete**. P4's current device-grant and session lifecycle remains the compatibility substrate while this pairing/client-session layer is implemented.
