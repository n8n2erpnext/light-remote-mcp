# Project Continuity — NetBird-only Projects WebUI UAT

Date: 2026-10-24 (Asia/Ho_Chi_Minh)
Branch: feature/project-continuity-plan-20261023
Previous source SHA: 529b9e31ccb2d13c07745e22d32deafe50506f46
Frozen Gold rollback: 30766940ac18e55cb735354b40a3af9ba37eddb8
Status: WEBUI FUNCTIONAL and owner-authenticated via NetBird-only LXD TCP proxy; UAT only.

## Owner-requested NAT / proxy model

- UAT container: light-remote-continuity-uat, isolated Linux ARM LXD.
- Host NetBird interface wt0: 100.94.184.141.
- New port 5587 checked unused on host; does not conflict with Light Remote Wall 5491 / Fleet 5492.
- Persistent LXD device continuity-webui-netbird, bind=host, listen tcp:100.94.184.141:5587, connect tcp:127.0.0.1:5587.
- Owner browser URL: http://100.94.184.141:5587/projects. NetBird connected and ACL permitting peer access are prerequisites.
- WebUI loopback-only inside container, never host 0.0.0.0 or public 10.0.0.74.
- No NetBird installation inside LXD; its eth0 lacks IPv4 DHCP, but TCP proxy works.
- Broker stays separate-UID Unix socket, protected SQLite and signing key not reachable by TCP.

## Login and secrets

UAT username: uat-owner. Random fixture-only password stays root-only in the UAT container:
lxc exec light-remote-continuity-uat -- cat /root/light-remote-continuity-uat-fixture.secret

Do NOT copy fixture credentials into the repo, logs, real Gold or public URLs. User accesses the password through their authorized host terminal. Login config stores only scrypt password hash and cookie secret in the separate lr-cont-agent-owned mode-0700 auth dir; auth file mode 0600. This disposable UAT temporarily uses the same fixture for owner broker signing; production must separate and protect credentials.

HTTP is UAT-only over the encrypted NetBird/WireGuard tunnel, not a public TLS application endpoint. Do not expose port 5587 publicly. Browser session is HttpOnly, SameSite Strict, 1 hour. Host header exact-match, CSRF for mutations, Origin match, no-store responses, local owner step-up for consent changes, failed login rate limit. Password rekey UI is hidden in UAT until a full password-rotation workflow exists.

## New source files

- device-agent/project-continuity-uat-web.mjs — isolated standalone authenticated HTTP entrypoint, reuses the existing Project Continuity dark Projects page, shared Local Wall auth, broker-only allowlist (projects, module switches, tasks, sections, Memory, checkpoint, scoped owner consent/revoke). Does NOT expose remoteBrief, arbitrary command, SQL, filesystem, Codex worker or generic broker RPC.
- deploy/scripts/uat-enable-continuity-webui-netbird.sh — explicitly gated LXD UAT setup for service user lr-cont-agent, local auth hash, service on container 127.0.0.1:5587 and NetBird-only host TCP LXD proxy mapping.
- deploy/scripts/selftest-project-continuity-netbird-webui.mjs — real login, anonymous deny, malformed CSRF, malicious Origin, create Project, set Memory, save fact, checkpoint, context retrieval, owner password step-up and immediate consent revoke. Never prints secret.

These UAT files are NOT shipping Windows/macOS/Linux Desktop runtime feature claims and do not alter the canonical 101-file Client Core manifest.

## Verified acceptance

- Service light-remote-continuity-uat.service ACTIVE.
- Service light-remote-continuity-web-uat.service ACTIVE.
- ss confirms only 100.94.184.141:5587 bound on host.
- Host HTTP GET /healthz via NetBird IP returns 200.
- Host anonymous /projects => 303 /login.
- Host anonymous /api/project-continuity/listProjects => 401.
- Wrong Host header => 400.
- WEBUI_LOGIN_AUTH_CSRF_ORIGIN_DENY_PASS.
- WEBUI_PROJECT_CREATE_MEMORY_CHECKPOINT_PASS.
- WEBUI_OWNER_CONSENT_STEPUP_REVOKE_PASS.
- WEBUI_NO_ANONYMOUS_MEMORY_API_PASS.
- NETBIRD_WEBUI_STOP_START_PERSISTENCE_PASS (after LXD stopped and started, both services automatically active, proxy preserved).

## Outstanding reboot behavior

An initial lxc restart light-remote-continuity-uat attempt timed out during graceful shutdown (context deadline exceeded). The instance subsequently reached STOPPED. A separate normal lxc start succeeded; broker/WebUI services and host NetBird mapping returned healthy. Do NOT claim fully clean fast lxc restart. Investigate shutdown unit timing and LXD proxy lifecycle separately; do not use --force blindly. This problem only affected the disposable Continuity UAT container.

## Explicit release gates still OPEN

- Operator-signed live A/B session and actual ChatGPT Web cross-conversation Project Memory smoke, including full log/tracing privacy audit.
- Real Codex app-server, Task Controller Delegated Worker execution budgets/leases/cancel and signed terminal receipts.
- Windows native service SID + named pipe DACL + CNG/DPAPI and physical owner-tested #486 parity.
- macOS launchd/Keychain/TCC and Linux Desktop system/user services with same four independent module modes.
- Product HTTPS endpoint, separate production login/owner-signing secrets, password recovery, system upgrades/rollback and physical OS acceptance.
- Old Gold M6 UNKNOWN jobs/resource claims untouched; no Gold PostgreSQL/Redis migrations or production restarts.

## Next development

Fix isolated LXD graceful stop timing (without harming Gold), add HTTPS behind a NetBird-scoped trusted proxy when transitioning beyond UAT, and preserve native WebUI parity for all OSes. Continue P2/P3 official MCP integration after trusted Operator key provisioning and explicit owner authorization. Save docs/handoff per turn.
