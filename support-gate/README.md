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
