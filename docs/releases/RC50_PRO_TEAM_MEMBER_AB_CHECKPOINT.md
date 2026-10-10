# Light Remote rc.50 — Team Member A/B Request Checkpoint (2026-10-10)

Branch: feature/free-benefit-pro-team-20261010. Direct production server and Windows/macOS/Linux stable client channels remain unchanged by this checkpoint.

## Source changes
- operator-host/team-approval-requests.mjs (new): requestTeamMemberApproval is a narrow, fail-closed creator of a **pending** Local Wall approval request. It takes authenticated actorAccountId (never from browser-supplied accountId), validates the shared device's server-owned enrollment owner, active Pro/VIP subscription and accepted team membership, device connection identity and hard expiration, then issues a separate agent-scoped A/B request with forceApproval true. Does not auto-approve, attach an agent client, create sessions or permit remote execution.
- rate limit: max five new pending requests / 15 minutes per acting account and device, returning 429 team_approval_rate_limited; attempts without authorized membership do not consume the request quota.
- operator-host/executor-routes-account.mjs: POST /v1/accounts/team/access/request requires real account session and accepts deviceId + agentId. No ownerAccountId spoof input.
- operator-host/executor.mjs: passes trusted ProTeamRegistry/DeviceConnectionRegistry/DeviceAccessGrantRegistry/account-plan objects, preserves TeamEntitlementError HTTP status.
- plugin-server/account-portal.mjs: /account/api?action=team-access-request forwards same-session token to Operator and keeps same-origin CSRF check. A/B approval requests are not sent on their own from an invitation.
- operator-host/device-access-grant-registry.mjs: pendingForDevice now includes requester accountId for locally approved owner-visible requests.
- device-agent/local-wall.mjs: /api/approve returns accountId and /approve displays the requester account ID in the decision, before local owner hits Approve.

## Security verification
- 10 relevant tests PASS: selftest-team-approval-request, selftest-team-member-auth, selftest-pro-team-account-api, selftest-pro-team-invite-budget, selftest-pro-team-seats, selftest-free-benefit-pro-team, selftest-v10-account-routing-isolation, selftest-v10-multi-account-device-channel, selftest-v10-plugin-account-scoped-lifecycle, selftest-device-worker-races.
- Test confirms denied outsider/Free owner, denied other device, no grant until owner B, grant agent/actor scoped, revocation/downgrade and spam cap, owner shown verified account ID.
- All touched JS passes node --check and git diff --check.
- **Not deployed** to production. No member A/B request was made against real user's account or real connected device.

## Remaining critical work
1. Fully implement actor/member vs device owner billing and routing across agent-client/context, targetRoute and device-channel command identity, every operation family. Current targetRoute still enforces device.accountId==session.accountId. DO NOT remove this mismatch guard without per-operation verification of signed member A/B, owner device sharing, paid active subscription, max 3 workers/device, and owner-billed quota.
2. Host agent must verify each signed member job is explicitly allowed by owner and account, with session/grant lifecycle checks, and owner must retain ability to revoke immediately.
3. Build five native rc.50 artifacts from final frozen SHA, run real Windows/macOS/Linux E2E; do not confuse successful earlier CI SHA 50e7b47 with final release.
4. Finish stable cross-update installation identity for Free device-family meter, remain SHADOW until tamper/false-positive tests pass.
5. Controlled NetBird maintenance fallback to host Docker with proper TLS and API 503 semantics is not yet activated.
6. MCP 80-tool desktop scanner source/prod patch is separate and live; OpenAI held helper metadata finding may persist in portal.
7. Owner signing and R2 manifest promotion must only happen after gates; rc.47 Windows/Linux and rc.49 macOS remain on their production channels.
