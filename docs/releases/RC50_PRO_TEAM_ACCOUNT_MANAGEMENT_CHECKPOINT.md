# Light Remote rc.50 — Pro Team management checkpoint, 2026-10-10

Branch: feature/free-benefit-pro-team-20261010. Parent checkpoint: 24d6fc7 (MCP scanner fix). Version candidate: 0.9.0-rc.50.

## Completed in this continuation
- Reused approved Light Remote session on VPS-ARM, verified clean starting checkout and Direct Plugin/Operator running and Docker maintenance healthy.
- Added real account-session authenticated Pro Team management under operator-host/executor-routes-account.mjs:
  GET/POST /v1/accounts/team (paid owner team view/create)
  POST /v1/accounts/team/invite (registered operational member)
  POST /v1/accounts/team/accept (member's own account, single-use invitation)
  POST /v1/accounts/team/member/remove
  POST /v1/accounts/team/device/share (must be owner's currently non-revoked enrolled device)
  POST /v1/accounts/team/device/unshare
- Wired ProTeamRegistry + ProTeamError into Operator executor, preserving HTTP 403/409/429 statuses.
- Published account-portal /account/api?action=team-view/team-create/team-invite/team-accept/team-remove/team-device-share/team-device-unshare. Mutations use existing same-origin CSRF guard and session cookie forwarded only as x-light-account-session to Operator; no direct accountId passed by browser for owner actions.
- Added /account/team as responsive website in existing Light Remote theme. Sidebar links on account home/usage/billing/settings. Displays a conspicuous warning that cross-account remote execution is NOT enabled until independent A/B & team billing verified; never falsely claims team sharing itself grants Remote rights.
- Strengthened ProTeamRegistry: repeat invitations revoke previous pending code for same recipient, expired invites pruned, pending invites reserve remaining seats; prevents unlimited pending invite spam and over-allocation.
- New selftest-pro-team-account-api and selftest-pro-team-invite-budget validate own-account guards, owner device matching, membership, paid plan downgrade, invite one time usage, seat budget, privacy & CSRF wiring.
- No live Direct Operator deploy or public Pro Team activation in this continuation.

## CI provenance
From GitHub Actions commit 50e7b4798c4382e5bcc8ab1c3bcdcdb82594c572, all 3 platform workflows completed success; all 5 platform artifacts exist and are unexpired:
Windows x64 (~328 MB), macOS x64 (~83 MB) / arm64 (~80 MB), Linux x64 (~81 MB) / arm64 (~81 MB).
This SHA predates Pro Team account routes and prior MCP fixes, so DO NOT promote these artifacts as a single-sha final rc.50 release; rebuild from final approved SHA when source frozen.

## Verification
PASS: ProTeamRegistry, Pro Team account API, invite seat budget, Free benefit simulation, v09 account portal, v10 account routing isolation, v10 multi-account device channel, plugin account-scoped lifecycle, announcements delivery, maintenance native announcements, reviewable MCP tool schemas and helper parity, update release readiness, version parity, client packaging, Linux CLI.
Full plugin-server/selftest still cannot run locally in worktree because dev node_modules lacks 'express'. Its pure tool registration tests and production-LXD staging previously passed. Do NOT mark full integration suite PASS until isolated staging with all dependencies succeeds.
No production client releases touched; current distribution remains rc.47 Windows/Linux and rc.49 macOS.

## Outstanding critical gates
1. Multi-account Pro Team ACTUAL execution remains denied in targetRoute / outbound-leaf / device-agent identity (accountId bound to owner). Must implement actorAccountId vs bill-to-ownerAccountId and verify owner device share + paid plan + member invited and accepted + individual owner-approved A/B for member's OAuth client + expiration / revocation / downgrade. Do NOT replace current device account mismatch with a global allowance. Fail closed.
2. Lead/worker actual concurrency 3 per shared device (not per seat), job lock/drain semantics and per-worker audit not yet E2E verified.
3. Free device-family anti-abuse remains SHADOW; stable installation principal and rotation verification needed before ENFORCE.
4. NetBird Proxy public maintenance failover to independent ARM Docker is NOT yet activated. Docker health alone doesn't make website reachable during LXD outage.
5. Build and native smoke from FINAL rc.50 SHA for five platforms, owner signing, signed updater manifest promotion and canary before public rollout.
6. OpenAI MCP helper Held finding is metadata of held description-only change. Runtime tools/list returned 80 with focused desktop schemas after previous production patch; Portal status must be confirmed by owner rescan.

## Recovery
Handoff located: /home/ubuntu/handoffs/LIGHT_REMOTE_RC50_PRO_TEAM_ACCOUNT_WORK_2026-10-10.md
Worktree: /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/free-benefit-pro-team-20261010
Production Direct LXD unchanged by Pro Team changes; Windows/Linux and macOS updater manifests unchanged.
