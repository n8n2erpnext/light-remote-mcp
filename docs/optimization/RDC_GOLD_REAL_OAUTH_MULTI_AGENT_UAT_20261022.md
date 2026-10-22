# Gold UAT — four authentic OAuth Agent clients / Pro personal 3+1

**Date:** 2026-10-22 (Asia/Ho_Chi_Minh)
**Branch:** feature/light-remote-gold-rebuild-20261018
**Status:** AUTH HARNESS READY ON OWNER WINDOWS; REAL 3+1 MCP + SQL ACCEPTANCE PENDING.

## Existing verified baseline
- Gold UAT LXD `light-remote-gold-uat` RUNNING on ARM.
- 6/6 Gold services active; Operator actual ExecStart points at immutable candidate `4934fa54c05efebf9a329956f763d34d96d4b486`; schema034 according to prior verified checkpoint. No schema or runtime modification during this step.
- Worktree HEAD before this handoff was `8359a2e9a621590e5301684aa8b890a2e2b3b3aa`.
- Earlier PG fixture `selftest-gold-m3-pro-3plus1-device.mjs` PASS 3/3 with synthetic verified-format Agent IDs under real PostgreSQL. **This is NOT evidence of four authenticated OAuth clients.**
- `plugin-server/operator-adapter.mjs` derives `stableAgentId` from hash(accountId | OAuth clientId). Re-opening the same MCP client or multiple Chrome tabs cannot create independent Agent identities. A separate client registration with full owner OAuth and A/B grant is needed per principal.
- Personal Pro entitlement: 3 executing Agent identities account-wide; session retained limit 12. Device session ceiling 2 and device weighted worker budget 2 are separate limits. WorkerWeight=0 lightweight read operations avoid conflating these.
- Poll transport can await one command; Duplex processes asynchronous commands. Test selected transport before diagnosing arbitrary per-device serial execution.

## Owner-controlled real-client UAT harness
- New Gold source file `deploy/scripts/gold-uat-four-oauth-clients.mjs`, Node 22+/26 syntax check PASS on ARM and on Windows.
- Exact matching source copied by authorized Light Remote Gold structured filesystem tool to `C:\Users\Admin\Documents\gold-uat-four-oauth-clients.mjs` on `DESKTOP-VA16D27`. Gold client Windows 26.7.0.
- Runs a bounded managed Node process on Windows, listening to ephemeral `http://127.0.0.1:<port>/` only; no public exposure, no server-side runtime modification. Started for a 45-minute UAT window. Do not assume its port persists after restart.
- Gold OAuth origin `https://gold.light-remote.thaiduy.digital`, discovery endpoint `/.well-known/oauth-authorization-server` returned HTTP 200 and valid metadata from Windows; `/healthz` returns 404 and is not an OAuth blocker.
- Four distinct OAuth **dynamic client registrations** A/B/C/D completed with HTTP 200 from the local harness. All four authorization links rendered. **No owner logins, tokens, A/B grants, execution leases or PG receipts yet.**
- Harness uses independent PKCE verifier/state per registered OAuth client, verified `/userinfo` account, a stable local Agent key derived from validated OAuth client identity, explicit owner Local Wall A/B for each client, RAM-only tokens, basic CSRF/origin check and localhost-only HTTP. Password entry belongs solely to official Gold OAuth page, never to harness. Do not expose cookies, tokens or callback authorization codes in docs.
- Once four clients have independent approvals for actual Gold devices, the harness can submit bounded foreground 22-second print/sleep commands to approved devices, observe A/B/C overlap and D queued/completes. **PG account_id/agent_id/operation_id/queue_reason and signed terminal receipts remain a separate required read-only verification**, not inferred from UI.
- Session cap of two per device means four real clients need at least two approved Gold devices unless a separately approved design changes it. Avoid forcing worker budget to three merely to make a test pass.

## Device enrollment versus MCP authorization, correction 2026-10-22
- Official Gold new-device enrollment: Local Wall /api/enrollment/begin -> Device Code -> Account > Add a device -> /api/enrollment/poll. It does not use an A code.
- Separate MCP access for a previously enrolled device: light_remote_connection_helper A/B with Local Wall /approve, one grant per independent OAuth client. Harness localhost /pair was misnamed; renamed /mcp-access.
- Local harness form POST failed origin_mismatch because Referrer-Policy no-referrer sends Origin null for navigation-mode form POST; fixed to same-origin while keeping strict Origin comparison and random CSRF. Existing Node process in memory will not hot-reload; do not terminate while preserving four OAuth-approved clients.

## Physical tool observations (not Gold scheduler regressions)
- First structured write to `C:\Users\Public` returned genuine `filesystem_path_outside_allowed_roots` 403; user-owned `C:\Users\Admin\Documents` confirmed allowed via list + write. Policy was NOT relaxed or bypassed.
- Windows RM `desktop_type_text` unexpectedly returned `desktop_input_physical_type_macos_only`, while `desktop_write_text` worked; Chrome title confirmed `Gold UAT 3+1 OAuth clients`.
- Stopping the initial 10-minute Windows managed Node process with `stop_process(force:false)` returned `stopForce:true` / `taskkill-tree`. This is physical corroboration of the pre-existing Windows graceful-cancel semantics gap. Node restarted with a 45-minute limit before owner OAuth to avoid losing in-memory state during A/B approval.
- Local harness GET returned HTTP 200; four authorization links A/B/C/D confirmed; cross-device copy SHA256 equal. No production update. No Team cross-account enablement, no billing changes.
- Transient safety/tool-layer block from previous turn remains separately documented; it was not an OS EACCES/policy decision. Do not use PTY or alternate tools to evade a legitimate deny.

## Acceptance gate (pending owner actions)
1. Owner uses the Chrome localhost UAT page on `DESKTOP-VA16D27`, selects A/B/C/D authorization, logs in each with same Pro account via official Gold OAuth, and approves four distinct A/B grants on the intended UAT Local Wall(s). Tool must not harvest passwords/tokens.
2. Confirm in local page: four READY, same OAuth account, four distinct stable Agent keys, Pro entitlement. At least two actual authorized Gold devices, max 2 sessions/device.
3. Explicit owner presses Run; observe three simultaneous execution leases (not just retained sessions), fourth job `queued` with PG `QUEUED_AGENT_SLOT`, no false owner drain/worker-capacity confusion, D promotion after release and all four signed receipts `ok`.
4. Read authoritative PostgreSQL rows without dumping credentials; correlate by bounded UAT job IDs, account/agent/session identities, timestamps, G4 operation ownership; no synthetic aliases as evidence for four true OAuth principals. If capability, identity or devices unavailable: status **BLOCKED**, not PASS.
5. Close temporary authorized sessions and stop Windows harness once complete. Preserve Owner account and production. UAT rollback is stopping its process; no Gold Operator restart/schema rollback needed.

**Do not merge or deploy this UAT-only harness to production without review.** Other pre-existing untracked files in the Gold worktree were not touched.
