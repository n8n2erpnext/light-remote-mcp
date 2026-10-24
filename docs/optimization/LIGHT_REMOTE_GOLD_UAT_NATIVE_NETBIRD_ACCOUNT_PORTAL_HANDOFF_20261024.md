# Gold UAT — Native LXD NAT to NetBird, no SSH tunnel

Date: 2026-10-24 Asia/Ho_Chi_Minh
Branch: feature/project-continuity-plan-20261023
Previous checkpoint: 2258798fac083058c80668f20262a00e27ad6802
Frozen Gold Windows #486: 30766940ac18e55cb735354b40a3af9ba37eddb8
Gold M6 worktree: ba579f8830a0654e8321204f17270db8d94c5593
Release: BLOCKED (only owner-facing Gold Account/Enrollment UAT networking).

## Architecture and request

Owner correctly rejected SSH tunnel. LXD native proxy can expose the EXISTING Gold UAT enrollment portal on the host NetBird interface. Project Continuity is a feature of the SAME Gold Agent/Wall, not a separate web app. Independent device-level Project Memory and Codex Bridge toggles do not require any Project. The old fake Continuity Wall remains OFF.

## Actual implementation

- Owner browser URL: http://100.94.184.141:5588/enroll
- Existing Gold UAT login: http://100.94.184.141:5588/account/login
- Only LXD container light-remote-gold-uat (10.192.135.61).
- LXD native proxy device gold-enrollment-netbird: bind=host, listen tcp:100.94.184.141:5588, connect tcp:10.192.135.61:5583.
- Host binds only NetBird interface wt0, NOT 0.0.0.0 nor production/public interface.
- No extra HTTP server, no parallel Wall, no SSH forwarding, no enrollment or device capability grant triggered by NAT.
- Native Gold UAT Plugin Host-header security initially denied NetBird IP with 403. Only Gold UAT systemd drop-in /etc/systemd/system/light-remote-gold-plugin.service.d/zzzz-netbird-owner-uat.conf adds the IP 100.94.184.141 to LIGHT_REMOTE_PLUGIN_ALLOWED_HOSTS alongside existing gold.light-remote.thaiduy.digital; only the Gold UAT Plugin was restarted.
- Existing Gold UAT Plugin, Operator, Wall and Supervisor remain active. Production and frozen Windows #486 unchanged.
- Gold UAT Account login requires the owner's actual **email in this UAT account database**, not the Local Wall test name uat-owner or its random fixture password.
- GET /account/register exists for owner-directed UAT account registration if needed. No production credential is cloned or bypassed.
- HTTP traffic travels over the encrypted NetBird/WireGuard tunnel; browser still displays HTTP, which is UAT-only, not public HTTPS. NetBird peer ACL needs to restrict access appropriately. The NAT exposes the existing Gold UAT plugin routes, not just a static enrollment page; account authentication remains required.

## Actual acceptance

- GOLD_UAT_NATIVE_LXD_NETBIRD_NAT_PASS
- GOLD_UAT_NATIVE_NETBIRD_NAT_LOGIN_ENROLL_ASSETS_PASS
- GOLD_UAT_INVALID_HOST_REJECTED_PASS
- HTTP 200 at /account/login, /enroll, /account/assets/portal.css, /account/assets/theme.js.
- HTTP 403 for arbitrary Host.
- Port 5588 is only bound 100.94.184.141.
- Read-only smoke: bash deploy/scripts/selftest-gold-enrollment-netbird-uat.sh
- Guarded setup: bash deploy/scripts/uat-publish-gold-enrollment-netbird.sh --explicit-netbird-gold-uat
- Guarded rollback script: bash deploy/scripts/uat-rollback-gold-enrollment-netbird.sh --explicit-rollback-gold-uat-netbird
- Both scripts only affect the dedicated Gold UAT LXD and host NetBird proxy, NOT production.

## Account and approval status

Prior 600-second test device code expired (remainingSeconds 0 observed). Agent enrollment remains unapproved, no account, no signed cert or A/B session. Owner must use an actual Gold UAT account email, approve a fresh enrollment code and grant capability explicitly. Do not use Local Wall uat-owner credentials to log in to Gold UAT; those are different stores. Do not place temporary device codes or owner secrets in Git.

## Still OPEN

Gold UAT owner login and final enrollment approval; account-bound signed enrollment certificate, actual A/B/Fleet/Permissions proof, official ChatGPT cross-chat Project Memory, genuine Codex worker, Windows and Linux Server release plus macOS/Linux Desktop parity. Release BLOCKED, no final installer.

## Next

Once docs/checkpoint are committed, issue a fresh UAT-only enrollment code against private LXD network and present the direct NetBird enrollment URL. Owner signs in with UAT email and accepts only after reviewing device. Then test signed enrollment and read-only A/B/plugin on the SAME full Gold Agent.
