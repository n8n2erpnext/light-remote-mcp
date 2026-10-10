# Light Remote — Announcements to Clients & Maintenance Landing (research + demo)
Date: 2026-10-10. Branch: feature/free-benefit-pro-team-20261010 (same consolidated Pro Team branch).

## Why this work
The live Direct distribution already has Announcements in /admin and a public website banner. Its source exists in the active LXD deployment as plugin-server/site-announcements.mjs, but was missing from the Pro Team worktree. This implementation ports the existing module and carefully adds **client delivery opt-in**, without replacing production announcement data or publishing anything to real devices.

## Existing production source confirmed
- Content location: LIGHT_REMOTE_SITE_CONTENT_PATH or /var/lib/light-remote-direct/plugin-state/site-content.json.
- Admin write operations require authenticated admin session and same-origin.
- Site announcements include title, message, website pages, start/end schedule, priority, dismissible, color preset and safe link. Existing site-only announcements must NOT automatically reach devices.

## Branch proof-of-concept
- Ported plugin-server/site-announcements.mjs: existing website banner behavior and admin editor preserved. Added audience: site / clients / both (default SITE), category: feature/update/maintenance/service, target platforms Windows/macOS/Linux.
- GET /api/client-announcements?platform=windows|macos|linux: public broadcasts only, enabled and within scheduled window, no account/device secrets, max 25 results, response revision and poll recommendation of 300s. This is **not** an account-personalized endpoint.
- Shared lib/client-announcement-inbox.mjs: reusable poll + receipt deduplication + persisted local inbox, URL sanitization and callback for newly arrived messages. It runs the same on Windows/macOS/Linux Node agent builds in future. It is NOT started by existing clients yet and does not show native Windows/macOS/Linux notifications in production.
- Admin announcement editor on branch allows an explicit audience and platform selection. Existing notices remain site-only. Demo does not mutate live site-content.json.
- DEMO pages added to Plugin server routing, not deployed:
  * /demo/maintenance — branded English-first page with Dark/Light, optional Vietnamese preview, live countdown, scheduled/in-progress/recovered variants, estimated ICT return, responsive layout, independent preview controls; theme, favicon and Google Sans point at existing site assets.
  * /demo/announcements — interactive simulated publisher/client inbox with Windows/macOS/Linux selectors, plus read-only Sync actual public feed action where feed available. Demo publishing is local simulation ONLY.
- No real announcement has been sent to live clients. No public maintenance routing activated.

## Operational requirement for server-down maintenance page
If Direct Hub/ARM actually goes offline, HTML at the Hub would be unreachable. Production maintenance fallback MUST be hosted at an independently reachable edge (Cloudflare Worker/Pages or equivalent), with an absolute UTC endAt, cached static branded HTML, timezone-aware countdown and optionally signed maintenance metadata. Announce BEFORE the outage to connected clients.
Keep API machine traffic as meaningful 503 + Retry-After or the existing connector error contract; never feed generic maintenance HTML to OAuth, MCP, A/B device-channel or updater JSON endpoints. Keep health checks meaningful so outages aren't falsely reported healthy. Do not rely on a Node process under maintenance to render the page.

## Next implementation gate to truly send to installed clients
1. Wire ClientAnnouncementInbox into device-agent/operator-agent.mjs with poll on authenticated desired-connected Agent lifecycle and exponential failure backoff; cache to a local protected state path. Verify signed/HSTS trusted origin, account/device version filters if account-personalized in later phase.
2. Show an inbox in Local Wall and safe native toast/notification integrations: Windows NotifyIcon toast, macOS UserNotifications/tray and Linux freedesktop desktop notifications where available. Respect OS permission/Do Not Disturb. Device state must be durable; don't spam toast after restart.
3. Add admin analytics: delivered/read/ack aggregate counts without PII by default; authorization and replay protection for any private acknowledgements. Public broadcast feed doesn't prove that a client actually received a message.
4. For planned maintenance store UTC start/end, timezone display, pause/edit/cancel and explicit owner approval; use edge routing toggle with rollback and an automatic restoration/recheck path independent of the failed Hub.
5. Test real Windows/macOS/Linux clients, ETag/idempotency, 304/backoff, scheduled/offline handling and localized text BEFORE a public release.

## Verified
- node --check server, admin, site announcement module, shared inbox.
- All inline JS in the two demo pages and admin editor syntax PASS.
- selftest-announcement-delivery-demo PASS: opt-in, platform targeting, scheduled filtering, existing site banner behavior, sanitized links, feed route, receipt dedup and restart persistence.
- selftest-direct-web-plane, selftest-direct-distribution-endpoints, selftest-v09-account-portal, selftest-v09-distribution PASS.
- No production deployment; project source candidate only.

## Safety and limitations
A public client broadcast must never contain secrets. Admin API is authenticated; browser demo has no publish access. Production has active announcements data; migrations must preserve the current JSON and require a backup/rollback. Countdown is an *estimate* and may change; do not claim automatic server recovery based only on elapsed clock time.