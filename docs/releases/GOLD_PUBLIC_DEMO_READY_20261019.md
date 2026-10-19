# Light Remote Gold demo — PUBLIC PREVIEW HANDOFF — 2026-10-19

**MILESTONE: DEMO READY FOR OWNER TESTING. NOT RELEASE ACCEPTANCE.**

## Owner URL and DNS

- Preview: https://gold.light-remote.thaiduy.digital
- Public VPS-ARM IPv4: 138.2.99.208
- Hostname currently resolves to the VPS and a valid HTTPS connection returned HTTP 200 for `/` and `/account` from the VPS public route, **without disabling TLS verification**.
- If the owner wants an explicit DNS entry instead of current wildcard behavior, configure `gold.light-remote.thaiduy.digital A 138.2.99.208` (not the private LXD IP).
- Gold WebUI now uses HTTPS origin `https://gold.light-remote.thaiduy.digital`; Gold Plugin binds **only on Gold LXD network address `10.192.135.61:5583`**, not on the public VPS interface.

## Architecture and proof

- Isolated `light-remote-gold-uat` LXD uses PostgreSQL 17/Redis 8, Gold Operator and Gold Plugin.
- Isolated Docker sidecar `light-remote-gold-preview` (nginx:1.27-alpine), from `deploy/gold-demo/compose.yaml`, joins existing `netbird_netbird` network, proxies only to Gold LXD.
- Existing Traefik Docker provider discovers `gold-preview@docker` via container labels, **no production Traefik restart**.
- The original production dynamic Traefik config was restored byte-for-byte (SHA256 `493ee4863b337209345048db900f062ebe91980e182a1908dd1e6b7f95f1916b`). Production and ERPNext routes remain unchanged; `https://light-remote.thaiduy.digital/` still returned HTTP 200.
- Gold drop-in `deploy/gold-demo/10-gold-public-demo.conf` installed as `/etc/systemd/system/light-remote-gold-plugin.service.d/10-gold-public-demo.conf` **inside Gold LXD only**.
- `boot.autostart=true` set only for Gold LXD; Gold sidecar `restart: unless-stopped`.
- `/ `, `/account`, `/downloads`, `/support`, `/ai-guide`, `/account/assets/light-remote.ico`: all public HTTPS 200. `/admin`: 303 to login as expected without session.
- `/mcp`, `/billing/paddle/webhook`, `/oauth/authorize`: **public HTTPS 404** via Traefik path allowlist (backend intentionally not exposed on demo).
- Response includes `X-Light-Remote-Environment: gold-uat-preview`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`; per-IP preview rate limit 60 requests/minute, burst 120.
- Gold Operator, Gold Plugin, PostgreSQL and Redis: active during final test.

## Account login and current caveats

- Preview is intentionally an owner UAT. Built-in Account session authentication is active. A separate edge BasicAuth password was **not configured** (credential-generation operation denied); do not broadly advertise the hostname until an extra access gate (e.g. Cloudflare Access) is configured.
- Existing synthetic fixture `gold-native-uat-20261019@example.invalid` remains in Gold database, **Pro** plan, with **one signed Paddle UAT event and subscription** from earlier testing. No real Paddle transaction or external refund was performed. It is test data; don't interpret it as a paid customer.
- The previously attempted automatic HTTPS account-login check was denied by the safety gate. **Signed-in public API is NOT marked PASS** until the owner tests login through their browser.
- The `/admin` area authorizes only `LIGHT_REMOTE_ADMIN_ACCOUNT_ID`; the synthetic fixture is not confirmed an Admin and must not be elevated with its publicly known test password. Admin demo access needs separate private staging-admin provisioning.
- Paddle checkout is explicitly disabled with `LIGHT_REMOTE_PADDLE_CHECKOUT_ENABLED=false`.
- A prior signed Paddle cancel/cleanup UAT operation was denied; it is **not required for first preview**, but cleanup is still required before release acceptance.
- Team, License, Fleet, live device job, A/B and signed-in full API end-to-end acceptance are outstanding. **They are tasks to test THROUGH THE DEMO**, not prerequisites to showing it.

## Operations

- Dedicated Gold preview proxy: `docker compose -f deploy/gold-demo/compose.yaml up -d --pull never` (does not restart production Traefik).
- Inspect: `docker ps --filter name=light-remote-gold-preview`, `lxc exec light-remote-gold-uat -- systemctl is-active light-remote-gold-plugin light-remote-gold-operator postgresql redis-server`.
- Demo-only rollback: `docker compose -f deploy/gold-demo/compose.yaml down`; optional remove **Gold-only** Plugin systemd override; no production restart required.
- Do not run real Paddle billing or email operations against Gold. Do not overwrite production LXD `light-remote-direct`.

## Next iteration — driven by owner's hands-on testing

1. Owner opens preview, checks account login, UI, device and management flows and reports actual defects.
2. Establish privately authorized Gold admin login (not the generic test fixture) and fix deficiencies found in the UI.
3. Extend demo API/backend behavior iteratively; preserve PostgreSQL typed relational canonical state and Redis for ephemeral state.
4. Signed Paddle cancel cleanup and full regression after feature feedback; only **then** release acceptance.
