# Light Remote 0.9.0-rc.50 — Consolidated Release Candidate

**State:** Release candidate source. Do not promote signed update channels until native CI, distribution artifact checks, and security E2E complete.

**Baseline in production at candidate time:** Windows rc.47, Linux rc.47, macOS rc.49; VPS-ARM installer manifest still rc.47. This source uses a single 0.9.0-rc.50 VERSION for all platform packages. The remote platform version must be read from installed artifacts or manifests rather than inferred from the repo VERSION.

## Candidate changes
- Linux server CLI: `light-remote restart` invokes the installed systemd Agent unit, waits for Local Wall to pass health checks, and then prints friendly status. Preserves device identity and existing enrollment. `light-remote announcements` reads persisted Agent notice inbox in SSH/terminal, with a short count in `light-remote status`.
- Announcements: opted-in client delivery feed in production Direct Plugin; native client implementations for Windows Tray notifications, macOS UserNotifications and Linux desktop notify-send. Durable locally cached inbox with Local Wall /announcements. Native client changes remain unshipped until this candidate passes CI and native permission tests.
- Maintenance: independently running host Docker on VPS-ARM, port 127.0.0.1:18081, using self-contained branded full maintenance page and schedule JSON; DOES NOT YET automatically replace NetBird Proxy TLS upstream when LXD goes down. Keep live production routing unchanged until an independent failover/rollback test.
- Free abuse protection: synchronized 10k/month per-Free-account and per logical-device-family SHADOW meter; do NOT enable ENFORCE before rotation, false-positive, and distributed quota E2E.
- Pro Team: registry of 5 seats incl owner, device sharing declarations, invite/accept/revoke, proposed owner-billed entitlement and 3-worker per Pro device limiter, tested at module level. **Cross-account job routing and team billing are not yet E2E wired. Feature unavailable to end users at release gate until finished; no false promise that Pro Team multi-account is enabled.**
- A/B 24h absolute grant and orphan-job cancellation previously deployed on Direct Operator; client candidate must remain compatible.
- Retain renew HTTP 404 hotfix and startup behavior on production; avoid overwriting production Direct Plugin overlay with branch baseline.

## Required release gates
1. All 5 native client artifacts must build and pass packaging provenance from the same Git SHA: Windows x64, macOS x64+ARM64, Linux x64+ARM64. Native GUI smoke/consent for 3 desktop OS plus Linux SSH terminal.
2. No actual cross-account Pro Team enablement until: accepted invitation, owner paid account, max 5 seats incl owner, local device sharing with fresh A/B per distinct OAuth client, revocation/downgrade deny in-flight/new work as policy dictates, owner-billed metering, multi-worker team dispatch on one device E2E and audit logs. No account isolation bypass.
3. Free device benefit must remain SHADOW until protected installation identity, key rotation transfer, anti-false-positive and rollback test; current Free users never blocked by new family ledger.
4. Do not tag a public release or promote R2 distribution, GitHub updater manifests, or any signed client channel until both artifact and security gates complete. Signed manifest must match immutable Git SHA/5 artifacts; owner signing remains an explicit step.
5. Test `light-remote restart` on a canary Linux rc.50 actual installed unit (not on this active operator connection in the middle of work) and verify service recovers with preserved identity and no A/B relink.
6. Verify host Maintenance is independent of LXD and NetBird ingress failover after synthetic outage; do not serve HTML to MCP, OAuth, or updater requests.

## Tested before source checkpoint
PASS: version plane, Free meter simulations, Pro Team registry, announcements feed, Maintenance, account registry, usage registry, account isolation, multi-account device-channel, plugin lifecycle, updater readiness, client packaging, Linux CLI, client-core parity, Fleet execution.

## Rollback
- Installed clients remain on their current signed release until signed manifest promotion.
- Direct Plugin announcement feed hotfix backup in /opt/light-remote-direct/hotfix-backups/client-announcements-20261010.
- Host Docker Maintenance: cd /home/ubuntu/light-remote-maintenance && docker compose ps; no active public ingress pointing to it.
- Production Pro Team is not enabled. SHADOW Free data cannot hard-block accounts.
