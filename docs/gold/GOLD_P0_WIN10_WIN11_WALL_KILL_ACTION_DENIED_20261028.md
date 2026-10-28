# Gold P0 — Local Wall Kill denied on Windows 10 + Windows 11

Owner's real Win10 and Win11 Local Wall clicks failed with `Not stopped: device_channel_action_denied`. The screenshots show the `Kill` button next to a `running` command; the failure was emitted by the Gold plugin public gateway before the signed Operator route.

## RCA
- `device-agent/local-wall.mjs` invokes owner-authenticated/CSRF-protected `/api/jobs/cancel`.
- `device-agent/operator-agent.mjs` uses `channelRequest(state,hub,'job-cancel',{jobId})` with the enrollment-signed device envelope.
- `operator-host/executor-routes-device-channel.mjs` already handles `/v1/device-channel/job-cancel`, verifies the signed device proof, binds `accountId` and `deviceId` from the trusted signature, and delegates to strict `cancelControlJob`.
- `operator-host/trusted-channel-rate-limiter.mjs` already assigns `job-cancel` to the control lane.
- **Missing gate**: `plugin-server/device-public.mjs` public `CHANNEL` allowlist lacked `job-cancel`, returning HTTP 404 `device_channel_action_denied`. This affects BOTH Windows clients, even though AI direct Cancel works.

## Corrective scope
- Add exactly `job-cancel` to the explicitly allowlisted signed device-channel actions. Do not add public arbitrary stop actions, bypass A/B, change source account/device identity, or fake signed terminal.
- New regression `deploy/scripts/selftest-gold-wall-job-cancel-gateway.mjs` checks allowlist, negative names, signed Operator route binding, Wall route and control rate lane.
- Existing Job Control, Durable ACK and Gold Wall regression PASS.

## Deployment discipline
- Gold UAT only; no Windows reinstall and no production cutover.
- A plugin-only UAT restart while the user's two intentionally long-lived Windows PowerShell jobs exist requires preserving Operator process and the signed Agent channel. Roll back plugin override on any failed health check.
- Validate physical owner Wall Kill on both Windows and signed terminal `cancelled/130`. Acknowledged stop request alone does not prove cancellation.
