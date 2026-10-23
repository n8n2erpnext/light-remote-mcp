# Light Remote Project Continuity — Integration into the canonical Local Wall

Date: 2026-10-24 (Asia/Ho_Chi_Minh)
Branch: feature/project-continuity-plan-20261023
Prior SHA: d2982459785bed4a2b9463fc9d3dd6df47e47715
Status: Shared Local Wall source + isolated LXD UAT running. NOT deployed to production Wall.
Frozen production Windows #486 checkpoint: 30766940ac18e55cb735354b40a3af9ba37eddb8
Gold M6 worktree remains at ba579f8830a0654e8321204f17270db8d94c5593

## Why this corrective change was necessary

The previous NetBird UAT exposed a **separate** Projects-only HTTP server on port 5587. Although it reused the existing Projects page and owner session primitives, it wasn't the actual Light Remote Local Wall. The owner correctly pointed out that Project Continuity was specified as an OPTIONAL MODULE IN WALL, not a new standalone administration product. That delivery was architecturally misleading. This checkpoint corrects it.

## Canonical integration

- device-agent/local-wall.mjs already contained owner-authenticated /projects and /api/project-continuity/* handlers, backed by the feature-gated continuity request callbacks.
- Added a **Projects** navigation item next to Permissions in the ordinary Wall header, visible **only** when the optional continuity module is wired; when both modules are off or absent, ordinary Wall behavior is preserved.
- Tightened Continuity API POST routes: mismatching Origin is denied, in addition to the existing authenticated owner session and CSRF requirement.
- NEW device-agent/project-continuity-uat-wall.mjs is a thin executable wrapper around **startLocalWall** itself for the isolated Linux LXD, with broker-backed Project callbacks and existing Local Wall auth. It deliberately does not pretend that a real Light Remote Agent is enrolled: ordinary device/cloud controls remain unavailable.
- DELETED device-agent/project-continuity-uat-web.mjs, the parallel Projects-only HTTP implementation.
- Updated deploy/scripts/uat-enable-continuity-webui-netbird.sh to stage the shared canonical Wall source/branding/icons, then launch the **actual Wall**, no second server.
- Updated deploy/scripts/selftest-project-continuity-netbird-webui.mjs to verify actual authenticated **Wall root /** with a visible Projects navigation entry, together with /projects, Memory/consent and negative auth/CSRF/Origin tests.

## Observed UAT

Host NetBird-only proxy remains tcp:100.94.184.141:5587 → LXD 127.0.0.1:5587. No port change, no NetBird agent in the container, no publicly bound TCP listener.

Inside dedicated light-remote-continuity-uat:
- existing lr-continuity broker under protected service UID, SQLite/trust-anchor via Unix socket
- existing light-remote-continuity-web-uat.service now has an explicit systemd drop-in overriding ExecStart to project-continuity-uat-wall.mjs
- shared Local Wall runs under lr-cont-agent with its own password hash/session storage
- UAT fixture login stays uat-owner and the owner-only root LXD fixture password (not committed)

The real full Wall root / now contains Projects alongside the normal Wall navigation. /projects is the same module route delivered by Local Wall. The UAT device/cloud status is intentionally a disconnected placeholder; this UAT does NOT enroll a Light Remote device or execute jobs.

PASS:
- WEBUI_LOGIN_AUTH_CSRF_ORIGIN_DENY_PASS
- WEBUI_PROJECT_CREATE_MEMORY_CHECKPOINT_PASS
- WEBUI_OWNER_CONSENT_STEPUP_REVOKE_PASS
- WEBUI_NO_ANONYMOUS_MEMORY_API_PASS
- source/test verifies authenticated Wall root has title Light Remote MCP — Device Wall and visible Projects navigation
- CONTINUITY_FOUR_OS_SERVICE_CONTRACT_SOURCE_PASS
- PACKAGED_WALL_ASSET_PARITY=PASS and PACKAGED_WALL_RENDER_AND_API=PASS
- client core 101 files stage/verify PASS

## User access

UAT shared Wall root: http://100.94.184.141:5587/
UAT integrated module: http://100.94.184.141:5587/projects

Both require NetBird and local owner session. HTTP is UAT over WireGuard and is not production HTTPS. Gold production host Wall 5491 was NOT restarted/modified. Do not claim Project Continuity has been enabled on the owner-tested production Wall. Changes live in the feature branch and isolated UAT only.

## Remaining release gates

The full multi-OS rollout still requires actual Windows named-pipe DACL/service SID, macOS launchd/Keychain, Linux Desktop systemd user/system split, real owner-issued A/B session and official Plugin cross-conversation Memory, Codex app-server and Delegated Worker receipts, secure upgrade/rollback, and production authentication/HTTPS/privacy audit. No installer should be built yet. Existing Gold UNKNOWN jobs and rollback SHA are immutable.

## Next handoff

Continue from this shared canonical Wall integration. Do **not** recreate a separate Projects server. Improve the UAT Wall/Projects navigation and real enrolled Agent integration through the existing continuity feature flag, and only after owner acceptance promote a proven candidate with OS-specific adapters. Continue per-turn source commit, docs/handoff and test evidence.
