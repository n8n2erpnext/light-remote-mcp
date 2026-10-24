# Project Continuity — Private Gold UAT enrollment handoff

Date: 2026-10-24 Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Previous source checkpoint: bd6dab6ab35743bb124befcf33daa9d00917e282
Frozen owner-approved Windows #486 source: 30766940ac18e55cb735354b40a3af9ba37eddb8
Gold M6 candidate worktree: ba579f8830a0654e8321204f17270db8d94c5593
Release: BLOCKED. No installer, production release, or cloud Gold migration.

## Original non-negotiable product contract

Light Remote Project Continuity extends the already tested Gold Operator Agent, Wall, Fleet, Permissions, enrollment and A/B approval, without replacing them or creating a second Wall. Project Memory and Codex Bridge are independent optional DEVICE-level features, with no requirement to create a Project. Both OFF must preserve normal Gold. Memory-only serves cross-conversation context without Codex; Codex-only can run without Memory; both ON cooperate through deterministic Task Controller. Gold PostgreSQL17/Redis8 remains the server canonical datastore, whereas user Project Memory stays local in protected SQLite. Windows and Linux Server first, then macOS and Linux Desktop with the same four-mode contract.

## Isolated real Gold Operator UAT connectivity

Only changed the isolated LXD instance light-remote-continuity-uat. Did not mutate the Gold UAT Plugin/Operator/Wall systemd configuration, any Gold production service, Gold M6 worktree, frozen Windows #486 build or real device account identity.

- Gold UAT Plugin listens at 10.192.135.61:5583; Operator behind its established private Unix socket.
- Continuity LXD has its own NIC override eth0 ipv4.address=10.192.135.62 on lxdbr0. The NIC originally came from the shared default LXD profile, so ordinary lxc config device set was rejected correctly; repaired using lxc config device override on THIS INSTANCE only.
- The minimal LXD image failed to acquire DHCP, although systemd-networkd was running. A temporary in-container address verified connectivity; then ONLY this LXD /etc/netplan/50-cloud-init.yaml was changed to static 10.192.135.62/24, dhcp4:false, dhcp6:false; old netplan copied to /etc/netplan/50-cloud-init.yaml.continuity-before-static. netplan generate/apply succeeded.
- There is NO DEFAULT/WAN ROUTE in Continuity LXD. No inbound listener bound to the host NetBird IP; the earlier fake Wall UAT NetBird proxy remains REMOVED.
- In THIS LXD /etc/hosts pins gold.light-remote.thaiduy.digital to 10.192.135.61. Neither external DNS nor the real production origin can be reached from this container.
- The isolated real Gold operator-agent.mjs daemon service now uses OPERATOR_AGENT_BASE_URL and OPERATOR_AGENT_HUB_URL equal to http://gold.light-remote.thaiduy.digital:5583, intentionally for the sibling Gold UAT only. Previously they were pinned to a closed localhost port. Exact Host header is required by the Gold UAT Plugin; direct IP Host returned 403.
- The original full Gold Agent daemon, Gold Wall, Permissions, branded assets and isolated Continuity Broker SQLite v9 from prior checkpoint remain unchanged. Broker runs as lr-continuity and Agent as lr-cont-agent. The mock Projects-only Wall service is inactive; no duplicate management app.
- Health HTTP GET /healthz from Continuity LXD reached Gold UAT, returning service version rc.49. Unsupported /api/operator action returned 403 as expected.

## First real test enrollment: waiting for the owner

Triggered ONE new device enrollment against the private Gold UAT Operator via the actual full Gold operator-agent.mjs login --no-wait command. New test device name is Continuity Gold Linux UAT; generated a fresh device identity inside the isolated LXD. Gold UAT returned an enrollment URL and one-time device code with lifetime 600 seconds.

State after request: pendingEnrollment exists; no enrolled deviceId, no linked account, no signed owner approval, no active A/B session, no user-granted capabilities. This must NOT be marked enrolled or end-to-end PASS. Do not copy one-time code, enrollmentId, signing keys, raw device identity or account secrets into this public Git repository. The code will expire; check state and request a fresh code only with proper owner coordination.

Gold UAT returned a localhost activation route under http://127.0.0.1:5583/enroll. We verified Gold UAT GET /enroll, /account and /account/login return HTTP 200 when accessed from the authorized host with the localhost Host header. Owner may securely forward the ORIGINAL Gold UAT portal over their authorized NetBird SSH session using:

    ssh -N -L 5583:10.192.135.61:5583 ubuntu@100.94.184.141

Then, on that same Windows PC, open http://127.0.0.1:5583/enroll and use an authorized GOLD UAT account and a still-valid enrollment code to approve. This is an SSH tunnel into the existing Gold UAT portal; it is NOT another Wall. We have NOT confirmed that the owner's particular Windows SSH configuration, account login or owner approval succeeds. Do not use production account credentials as a workaround.

## Script changes

- NEW deploy/scripts/uat-connect-full-gold-agent-private-operator.sh: exact-instance/branch gates; verifies reserved network and private Host, checks denied operator action, configures only isolated Agent BASE/HUB and restarts test Agent. Does not enroll a device.
- NEW deploy/scripts/selftest-project-continuity-private-gold-uat-operator.sh: read-only verification of both instance IPs, pinned UAT hostname, no WAN route, UAT service HTTP health, denied unexpected API actions, running local Agent/Broker, pending-or-approved state and no public Wall exposure. Does not approve or create device records.
- THIS per-turn handoff, updated master plan and JSON release gates.

Tool integration returned an ECONNRESET while reporting the first endpoint setup; rather than blindly repeat, a read-only reconciliation showed the intended private hosts alias and systemd override were already applied. Additional read-only health and policy checks passed.

## Evidence / open gates

PASS:
- ISOLATED_CONTINUITY_LXD_STATIC_NO_WAN_ROUTE_PASS
- CONTINUITY_GOLD_UAT_HTTP_PRIVATE_INTERFACE_PASS
- GOLD_UAT_PRIVATE_OPERATOR_PINNED_DNS_NO_WAN_NO_PUBLIC_WALL_PASS
- GOLD_UAT_BOOTSTRAP_ROUTE_REJECTS_UNKNOWN_ACTION_PASS
- UAT_DEVICE_ENROLLMENT_STATUS=OWNER_APPROVAL_PENDING_OR_EXPIRED
- Four existing Gold UAT services stayed ACTIVE.
- Frozen Gold #486 and Gold M6 source untouched.

OPEN:
1. Actual owner approval, account binding and signed Gold UAT enrollment certificate.
2. Authorized A/B session, capability approval, actual Link Device, Fleet/PTY/permissions under enrolled account.
3. Official Plugin cross-conversation Memory, local-only privacy/retention verification and scoped consent.
4. Real optional Codex-only worker with budgets/cancel/reconciliation, and memory-only cross-chat without Codex.
5. Windows native Service SID/Named Pipe DACL/DPAPI, Linux Server full deployment and macOS/Linux Desktop parity.
6. Gold M6 prior UNKNOWN jobs/resource locks untouched.

NEXT: Owner approves a fresh test enrollment using the existing Gold UAT portal. Then poll and verify signed certificate and actual authorization; perform one bounded read-only real Plugin call, then Memory-only and Codex-only in the SAME enrolled Gold Agent. No fake Wall or production cutover.
