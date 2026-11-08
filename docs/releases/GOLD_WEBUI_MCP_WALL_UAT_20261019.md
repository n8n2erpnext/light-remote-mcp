# Gold WebUI / MCP / Wall UAT handoff — 2026-10-19

Branch `feature/light-remote-gold-rebuild-20261018`; production `light-remote-direct` LXD and production official ChatGPT Plugin were NOT modified.

## 1. Actual screenshot regressions FIXED

- The Material SVG files were already self-hosted in `assets/icons/material/`; the Gold preview Traefik Docker router mistakenly filtered out `/assets/icons/material/:name`. This was the reason the account-sidebar/nav and ChatGPT/Claude icons showed broken image placeholders.
- Extended Gold-only router allowlist for `/assets/icons/`, `/assets/fonts/` and `/assets/brand/`.
- Reconciled actual referenced Material SVGs against disk: 29 referenced, **zero missing**. Icon SVG `/assets/icons/material/devices.svg` and web UI font `/assets/fonts/GoogleSans-Variable.ttf` returned **HTTP 200** over Gold HTTPS after Docker provider refreshed; do not depend on remote Google Fonts at runtime.
- `plugin-server/account-portal/usage.html` was missing Pro Team and Inbox in navigation; added them. All six Account page menus now list the same six entries: Devices, Pro Team, Inbox, Usage, Billing, Settings. Public `/account/usage` returned HTTP 200 and reflected Pro Team entry.
- `plugin-server/account-portal.mjs` now conditionally changes ChatGPT Plugin onboarding links **only when** `LIGHT_REMOTE_GOLD_DEMO=1`: points to ChatGPT Plugins directory / custom MCP setup instead of misleading owners to the production plugin. Includes Gold MCP and NetBird Wall URLs.

## 2. Actual Gold MCP Server (not a mock)

- Already-running Gold Plugin `light-remote-gold-plugin` is a separate Node MCP SDK Streamable HTTP server on the Gold LXD.
- Dedicated HTTPS OAuth/MCP ingress was added to Gold Docker provider rule for `/mcp`, `/oauth/`, `/.well-known/oauth-`, `/userinfo`. The route is independent of production.
- Verified both `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp` return **200** with Gold HTTPS issuer/resource. `GET /mcp` returns **405**, which is expected because the implementation accepts MCP via POST only.
- `deploy/gold-demo/mcp-gold.json` provides a separate Streamable HTTP configuration name `light-remote-gold-uat` and URL `https://gold.light-remote.thaiduy.digital/mcp`.
- A remote test command combining Docker redeploy and MCP POST initialize was DENIED by the safety layer. No MCP POST tool enumeration or authorized A/B command was verified in this turn. Do NOT mark full MCP handshake PASS.
- A Gold-specific ChatGPT plugin has **not been installed by the assistant**. The owner must select ChatGPT Plugins > Add > Add custom MCP server, enter the Gold URL, complete explicit OAuth connection, then test. The already installed official Light Remote plugin remains production.

## 3. Genuine isolated Gold Wall, available only through NetBird

- Gold LXD `light-remote-gold-uat` now has enabled systemd service `light-remote-gold-wall.service`, launching actual `device-agent/operator-agent.mjs daemon`.
- Inside Gold LXD, the Wall binds `10.192.135.61:5491` and has an independently generated `account-only` Local Wall auth config under `/var/lib/light-remote-gold-uat/wall/`. No fake Wall screenshot or production Wall state was copied.
- Gold Docker sidecar `light-remote-gold-wall-netbird` binds **only** `100.94.184.141:5591/tcp`, forwarding to Gold LXD Wall. Gold-only Nginx reverse proxy, read-only root, no-new-privileges, and **Traefik disabled** for this sidecar. Connection over NetBird tunnel.
- `http://100.94.184.141:5591/` tested from VPS and returned **303 to /login**; `/login` returns a real Local Wall login page. LXD Operator, Plugin and Wall all active.
- Existing 100.94.184.141:5491 was in use by a separate Wall; it was **not touched**. Gold uses 5591.
- Gold preview ingress now allows the canonical public `/enroll`, `/api/operator` and `/device-channel/` paths needed for legitimate agent enrollment/channel signature flows. Gold public `/enroll` returned HTTP 200 after config refresh.
- Agent is presently **not yet enrolled/approved**. The owner must log into the Wall via NetBird, begin enrollment and approve it from Gold Account for A/B/runtime testing. A 303 login proves Wall availability, not actual authenticated access from another NetBird peer.

## 4. Admin privileges — NOT provisioned

- A one-time UAT-only operator bootstrap path was prepared, but the actual internal Account registration call was denied by OpenAI safety enforcement. **No UAT Admin account was created, and no user received Admin privileges.**
- Immediately removed the temporary bootstrap environment and credential files; restored canonical `operator-host/executor-routes-account.mjs` (route absent) both in branch and running Gold LXD. Gold Operator, Plugin, Wall remain active. `GOLD_ADMIN_BOOTSTRAP_DISABLED=PASS`.
- The existing synthetic Pro UAT Account password has previously been shared in chat; **do not bind `LIGHT_REMOTE_ADMIN_ACCOUNT_ID` to this account while its password is unchanged**. User can change it privately via Gold Account Settings and notify the assistant; then legitimate admin mapping can be configured without issuing another public known credential.
- `/admin` currently redirects to Account login without a session and refuses non-admin Account IDs.

## 5. Pending

- Complete OAuth connector creation and real authenticated MCP POST/tools discovery in ChatGPT UI.
- NetBird peer (e.g. owner Windows PC) validates Wall 5591 reachability, signs in, starts enrollment, approves device A/B, exercises actual actions.
- Privately provision legitimate Gold Admin only after password rotation or another authorized account creation.
- Signed Paddle UAT account still has synthetic Pro subscription from prior runs; isolated test state, no real payment. Cleanup previously denied and not bypassed.
- Continue Gold acceptance **using the demo**, not blocking owner preview until all backend tests complete.

## URLs

- Gold WebUI: `https://gold.light-remote.thaiduy.digital/account`
- Gold independent MCP: `https://gold.light-remote.thaiduy.digital/mcp`
- Gold NetBird Wall: `http://100.94.184.141:5591/` (NetBird only)
- Gold LXD: `light-remote-gold-uat`, internal `10.192.135.61`.
