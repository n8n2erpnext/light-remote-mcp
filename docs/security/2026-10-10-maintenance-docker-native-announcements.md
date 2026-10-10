# Light Remote — Maintenance Docker + Native Announcements (2026-10-10)

Branch: feature/free-benefit-pro-team-20261010. Owner release baselines: Windows rc.47 production, rc.48 development; macOS rc.49; Linux rc.47.

## ARM host maintenance — ALREADY RUNNING
- Live host directory: /home/ubuntu/light-remote-maintenance.
- Source: deploy/maintenance-host/compose.yaml and site/ directory.
- Running Docker container light-remote-maintenance, busybox:1.36-musl image about 0.9 MB, 24 MB memory cap, nonprivileged, read-only FS, healthcheck healthy.
- Host loopback 127.0.0.1:18081; Docker network alias light-remote-maintenance:8080 reachable on netbird_netbird.
- HTTP 200 homepage, local SVG logos, maintenance.json. Source page includes brand hero, explanatory progress panel, four-part countdown, ICT ETA, Dark/Light, English default and ?lang=vi. Optional ?preview=1 90-minute countdown for visual UAT.
- Configuration site/maintenance.json defaults to standby with no date. For actual maintenance set UTC ISO startAt/endAt and mode scheduled/active, then independently set restored after verification. Countdown reaching zero must not falsely claim the Hub is restored.
- IMPORTANT: live HTTPS routing goes through NetBird Proxy TLS passthrough toward LXD. The independent Docker container remains alive with LXD down, but the public hostname will NOT automatically display this page until an explicit tested ingress failover rule is installed. Do not redirect machine API/MCP/OAuth/device-channel/updater JSON routes to HTML; preserve HTTP 503 + Retry-After semantics.
- No live NetBird Proxy changes made. Direct Operator/Plugin services remain active. Do not stop LXD just to test.

## Native Announcements source work
- Existing distribution Admin Announcements editor preserved; added opt-in Site/Clients/Both + category + target Windows/macOS/Linux. Public GET /api/client-announcements delivers only active broadcasts, no device/account secrets.
- Device Agent now polls at ~5-minute intervals, failure backoff up to ~15 minutes, stores a local inbox with per-announcement receipts via shared lib/client-announcement-inbox.mjs. Agent status JSON includes announcements, and journal logs new item receipts.
- Auth-protected Local Wall /announcements and /api/announcements use the locally cached inbox even when Hub is down.
- Windows Tray uses NotifyIcon.ShowBalloonTip and per-user LocalAppData last notification receipt; menu opens Local Wall inbox.
- macOS Tray uses UserNotifications framework, consent/permissions flow, user defaults dedupe and inbox menu. Native macOS Xcode/Swift compile and GUI test still required.
- Linux desktop GTK tray uses notify-send when GUI is available and a dedupe receipt.
- Linux server terminal: light-remote announcements or light-remote notices prints locally cached notices; light-remote status shows notice count. No desktop dependency.
- Packaging manifest includes ClientAnnouncementInbox plus cloud renew backoff and Pro worker limiter imports; Linux workflow copies CLI announcements module.
- Source tests: announcement delivery, maintenance native notifications, Linux CLI packaging and core parity PASS. No client release has been deployed. Windows rc.47 and Linux rc.47 stable channels untouched.

## Remaining gates
1. Native Windows CI and test rc.48 canary (do not promote over Windows rc.47); macOS rc.49 Swift/notification consent CI, Linux desktop + headless terminal test.
2. Install backward-compatible public notice feed and editor patch in LXD Direct Plugin with content backup and rollback; do not overwrite active website admin/analytics code or old announcement data.
3. Real notice E2E to one test client and local inbox; verify no repeat native toast after tray restart.
4. Implement controlled NetBird Proxy route/fallback to Docker maintenance host with valid HTTPS cert. Browser gets maintenance HTML; client OAuth/MCP/API get machine-readable error, not HTML. Exercise synthetic outage and rollback without stopping LXD.
5. Owner approves client signed build rollout separately.

This handoff records confirmed runtime/test state only. Native toasts and public fallback are not yet live.

## Production update: client feed activated, 2026-10-10
- The backward-compatible Direct Plugin site-announcements.mjs feed and active /admin editor fields were staged and activated with rollback backup in LXD.
- Backup: /opt/light-remote-direct/hotfix-backups/client-announcements-20261010/.
- Public checks after activation: Home HTTP 200; /healthz HTTP 200; /api/client-announcements?platform=windows and macos HTTP 200; empty POST /device-channel/renew HTTP 400 (correct validation, not route 404).
- Public JSON observed schemaVersion=1, platform=windows, items=0, pollAfterSeconds=300. No client-targeted bulletin was created.
- New source code still requires signed Windows/macOS/Linux client releases before native notifications reach installed users.
- GitHub Actions workflows on the Pro Team branch were enabled for Windows/macOS/Linux CI canary checks. Do not claim they passed until their actual runs and artifacts are reviewed.
- Latest UI fixes make native toasts use the newest received bulletin rather than the highest-priority banner already displayed.
- Host Maintenance Docker remains healthy in standby and NetBird Proxy target remains untouched. Production preview ZIP: docs/demos/light-remote-host-maintenance-production-preview.zip.
