# Light Remote — owner-approved A/B 24-hour policy (2026-10-10)

Status: **SOURCE CANDIDATE ONLY**, NOT deployed or enabled on production. This design intentionally retains cross-ChatGPT-conversation continuity for the **same verified OAuth account and plugin client** while preventing unauthorized session-ID reuse and indefinite authorization.

## Owner decision
- A/B local physical owner approval required once per **24-hour authorization period**, **not once per ChatGPT conversation**.
- The same verified owner OAuth account, its specific OAuth `clientId`, and the corresponding approved plugin `agentId` may resume the authorized device from another ChatGPT conversation within that period. Preserve working context, workspace and running jobs; no unnecessary re-pair.
- A different OAuth account or OAuth plugin client must have its own device A/B approval; knowing an existing `sessionId` never conveys authorization.
- 24 hours starts from local B approval. Device connection/lease renewal, OAuth refresh and job/session activity **must not push out the absolute A/B deadline**.
- After expiry, prevent **new** remote operations and request fresh owner A/B pairing; already accepted jobs may finish under bounded operation timeouts. An old session may remain in the diagnostic history, but it must not be usable to bypass expired device access.

## Evidence behind the change
On VPS-ARM, existing session `s_muz2uu81_6951a80f41de8521` was 43.5 hours old with 37 `active_job` entries. 36/37 were orphan jobs without commandId (19 exec, 17 fs), and some were ~42 hours old, defeating 60-minute session grace. The source fix is in parent branch `fix/session-orphan-jobs-20261010` commit `e5cad43`.
Original A/B grant was approved >48h previously and its expiry kept sliding with the device connection lease. OAuth access JWT TTL is 1h but refresh TTL is 30 days, Agent Client TTL is sliding 24h, plugin `agentId` is stable over chat changes by SHA256(accountId|clientId).
Legacy selftest `v09-device-access-multi-agent-one-approval` explicitly allowed different agentId values to inherit one grant; this weakens client isolation. These are distinct problems from mere session ID visibility.

## Source candidate
Worktree: `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/ab-24h-client-bound-20261010`, branch `fix/ab-24h-client-bound-20261010`, based on orphan-job fix (includes the Direct renew 404 fix).
- `operator-host/device-access-grant-registry.mjs`: explicit `AB_GRANT_MAX_LIFETIME_MS = 24h` ceiling, persisted `absoluteExpiresAt`, enforced by `_activeGrant`, `poll`, `assert`, `renewConnection`, `activeForDevice`, `reap`; legacy stored grants cap to `approvedAt+24h` upon loading.
- Pending requests and approved grants are scoped by account + agent + device + connection. Approving a request **does not approve another agent's pending request**. A/B reapproval for an already approved agent closes the old grant and issues a new ID with its own 24h clock.
- For explicit owner A/B approvals, the registry uses 24h idle grace instead of the device's shorter 30m reconnect grace. This permits cross-chat continuation during the 24h window even when no ChatGPT conversation was active for a few hours, as long as the device connection and account authorization remain valid. Genuine device disconnect/revoke may require earlier re-pair.
- `operator-host/agent-client-registry.mjs`: attach enforces grant accountId and grant agentId.
- `operator-host/executor-routes-device-channel.mjs`: agent-client device listing, resolve and context assert the scoped grant against the binding's account/agent identity.
- `deploy/scripts/selftest-v09-device-access-grant.mjs` was updated to reject former insecure multi-agent-one-approval assumptions; `selftest-v11-device-connection-renewal.mjs` now expects A/B to expire at 24h even if the underlying connection renews.
- `selftest-ab-24h-client-bound.mjs` tests hour 23/24 boundary, same-client chat transition, account/client isolation, session owner mismatch, reapproval rotation, connection renewal without grant extension, stored legacy migration.
- Regression selected suite PASS (must rerun after any last modification): v09 access, v11 renewal, v09 agent client, v09 pairing connect, v09 OAuth MCP, v11 agent sliding TTL, v11 OAuth onboarding, v08 fleet execution, session orphan-job guard.

## Rollout gates / caveats
- **Do not apply to production automatically**. Existing grant >24h old will expire on first deployment of this policy, forcing one immediate A/B pairing and potentially interrupting a long-running ChatGPT workflow. Arrange a convenient time with the owner, checkpoint/backup registry and keep rollback branch/artifact.
- Security principal is OAuth account and OAuth `clientId` derived plugin `agentId`; there is **no reliable ChatGPT conversation ID** exposed at present. A second ChatGPT conversation using the same OAuth app connection legitimately shares the same client identity; this is the requested behavior. A separate OAuth client has its own agent identity.
- A/B is owner consent for device access, not a substitute for OAuth security. An attacker controlling the **same OAuth session/client token** may have access within the 24h window; support owner revocation/logout, audit and protected token handling. No security control can guarantee safety against stolen live credentials.
- Session grace of 60m is an idle/lifecycle parameter, not absolute 24h authorization. Do not conflate.
- No production restart/forced detach or modification of Windows/macOS clients. No new A/B approval was requested in this source/test work.

## Acceptance test summary
Same account+OAuth client agent within 24h: A/B not required, session ID reused when still active.
Different OAuth client, different account: no auto-approval, cannot attach another agent's grant, cannot resume other agent's session.
After 24h: grant assert and new command denied, even with device renewal and active jobs.
Explicit new A/B: new 24h grant; previous grant revoked; in-flight jobs can complete with existing bounded execution policy.
