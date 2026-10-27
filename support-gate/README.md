# AI Support Gate — Gold UAT phase 1

Libredesk OSS v2.9.0 (upstream unmodified) + custom owner-reviewed Support Gate + the official Light Remote device-session plugin.

Gold has NO ERPNext Helpdesk integration to remove. No existing ERPNext Helpdesk service, mailbox, Gold Wall or production system was changed.

## Architecture

Upstream Libredesk uses private Docker PostgreSQL17, Redis7 and uploads. Our Node22 Gate runs independently with a separate PostgreSQL database and non-superuser role. Drafts and audit events are durable.

The Light Remote bridge has a scoped capability at POST /api/agent/drafts that may CREATE drafts, but cannot approve or send. Owner uses login + CSRF via web UI to edit, approve and eventually send. Send is currently DISABLED until actual Libredesk agent API credentials and both brand inbox IDs are configured. Before send, Gate checks the actual conversation contact email, brand email inbox and last message UUID. No automatic resend if delivery outcome is uncertain.

## VPS-ARM UAT

- Source in the current Gold branch under support-gate/
- Libredesk unmodified source clone: /home/ubuntu/services/libredesk-support/upstream/ (v2.9.0, commit 5668a2a2)
- Private runtime: /home/ubuntu/services/libredesk-support/runtime/
- Compose project: libredesk-support-gold
- Libredesk: http://100.94.184.141:9087/
- Owner Review: http://100.94.184.141:9088/
- Existing Gold Wall remains on 5591.

Runtime-only secret files, never in Git: .env, config.toml, .system-user-password, .gate.env, .gate-owner-password, .gate-worker-token. File permissions are 600. Initial Libredesk username is System.

Private NetBird-only HTTP UAT currently uses Libredesk disable_secure_cookies=true. Public deployment requires trusted HTTPS, secure cookies, backups, SSO and secret rotation. These ports are bound only to loopback and NetBird IP, not public 0.0.0.0.

## Current acceptance

Libredesk and Gate UI HTTP 200; admin login, CSRF rejection, draft store, owner approval; scoped Light Remote POST draft appears in web inbox; agent cannot approve; owner send returns HTTP 503 while API credentials are absent. Zero customer emails sent. Existing Gold UAT 4/4 services ACTIVE.

## Not ready yet

Real Light Remote/LightBI inboxes and IMAP/SMTP, Libredesk API key and brand mapping, webhook-triggered AI worker, automated Light Remote investigation, customer magic-link ticket portal, and public TLS are NOT configured. Do not call this customer-ready.

## Rollback

In runtime dir: docker compose stop gate app. Never use docker compose down -v: volumes contain databases and uploads. Checkpoint tag: checkpoint/gold-pre-libredesk-support-gate-20261026.

Official APIs: https://support.libredesk.io/en/articles/get-conversation and https://support.libredesk.io/en/articles/send-message.

## Unified Libredesk identity (26 October 2026)

The separate Gate password login was removed. Owner web access now exclusively delegates to an authenticated Libredesk session via the official GET /api/v1/agents/me API. The browser must sign into Libredesk at NetBird :9087 as the single support@thaiduy.digital agent first; opening Support Gate at :9088 then uses that same Libredesk cookie (same NetBird host, different port). For every Gate request, an active upstream Libredesk session and an exact owner email match are required; mutations additionally require an HMAC-based CSRF token bound to the Libredesk session cookie. The owner has one credential authority: Libredesk. Password rotation also occurs exclusively in Libredesk. Worker draft-only ingest is separate from owner auth and cannot approve/send.

**Account provisioning blocker:** The Libredesk installation still only has its initial System account. support@thaiduy.digital has NOT yet been created. A previous Light Remote credential operation was denied by device-local policy; no attempted bypass by SQL, installers, alternate shells or transport is acceptable. The owner must provision the account via authorized Libredesk administrative UI. Until then this integration deliberately returns 401, and legitimate login has NOT passed E2E.

Live unauthenticated/fake-cookie tests pass, Gate UI and Libredesk are HTTP 200, outbound remains disabled; no customer email sent. The original independent Gate authentication database row is no longer consulted and is retained only for rollback.

## Libredesk-matched UI and Admin login, 27 October 2026

The Gate web UI now matches the bright Libredesk Inbox visual language: compact icon rail, left navigation, status filters, searchable draft queue and detail/editor pane with local SVG; mobile responsive. No native browser confirmation for Send. No modification to upstream Libredesk.

Authorized Libredesk Admin sessions (System or support@thaiduy.digital) now provide access to the same Gate via the Libredesk session cookie, without a second Gate password. Authorization is checked live through Libredesk on every API call and is denied for missing, foreign or non-Admin identities. Gate send remains disabled.

Current Libredesk database only has the System account. Authenticated browser end-to-end must still be checked by the owner, as no user cookie was available in remote tests. New unit tests cover allowed and denied identities. Deployment only rebuilt Support Gate on NetBird :9088, leaving Libredesk :9087 and Gold Wall 5591 intact.

## Canonical HTTPS production-domain UAT (27 October 2026)

The former NetBird HTTP browser URLs are superseded by:
- https://support.thaiduy.digital/ — upstream Libredesk agent portal
- https://support.thaiduy.digital/ai-support/ — AI Support Gate Owner Review

Existing NetBird Traefik terminates trusted Let's Encrypt TLS and forwards by host/path to the respective existing Docker containers, with StripPrefix for Gate. UI scripts/styles and API requests are same-origin under /ai-support/. Libredesk Secure Cookies are enabled. Gate is authenticated exclusively against the Libredesk Admin session (native System or the configured support Admin). No separate admin account or password.

Original ERPNext/Helpdesk LXD, its database and erp.thaiduy.digital remain unchanged. The support.thaiduy.digital route no longer serves ERPNext Helpdesk. Router backup and original PostgreSQL custom-format dumps, with SHA256SUMS, are stored privately in /home/ubuntu/n8n2erpnext/support-gate-checkpoints/20261027-domain-cutover.

Important Docker note: /home/ubuntu/netbird/traefik-dynamic.yaml is bind-mounted READ ONLY as a single FILE into netbird-traefik. After changing this host route file, its original pinned inode may remain in the container. To reload the correct file, recreate ONLY the Traefik service from its existing Compose:
  cd /home/ubuntu/netbird && docker compose -f docker-compose.yml up -d --no-deps --force-recreate traefik
Do not restart or redeploy other NetBird services. For rollback, restore the saved pre-cutover route, recreate Traefik, restore Libredesk's pre-cutover config if required and restart only Libredesk app.

The live owner browser still needs to confirm WebSocket readiness after signing in via HTTPS. Unauthenticated GET /ws returns 401 from Libredesk, proving route exists, but not an authenticated successful WebSocket upgrade. Email inboxes/API and actual outgoing mail remain disabled.

## Signed inbound Libredesk webhook UAT (2026-10-27)

Live receiver: `POST https://support.thaiduy.digital/ai-support/api/webhooks/libredesk`. It accepts only the exact Libredesk `X-Libredesk-Signature: sha256=<HMAC>`, validated against the raw HTTP body, and stores **only event metadata** in `support_gate_inbound_events` (deduplicated; no ticket bodies). Its signing secret is generated solely at private runtime in `.gate.env`, never in Git.

The existing Admin has a one-click **Connect incoming events** control inside **Support channels & incoming events** on the Gate Owner Review web page. It uses the same Libredesk Admin cookies and native CSRF, and creates the official Libredesk webhook through `POST /api/v1/webhooks` with only `conversation.created` and `message.created` subscriptions. This connection is not auto-enabled by the deployment; it must be activated by an authenticated owner. The event queue is owner-only. AI may create drafts, but does not auto-approve or auto-send.

At deployment, Libredesk had zero email inboxes and no webhook configured. Real customer email remains out of scope until both brands have verified IMAP/SMTP credentials and sender identities. Lark requires a dedicated app authorization code entered only in the Libredesk Admin web form; do not copy passwords into tickets or Git.

Detailed handoff: `docs/gold/RDC_GOLD_LIBREDESK_INBOUND_WEBHOOK_HANDOFF_20261027.md`.
