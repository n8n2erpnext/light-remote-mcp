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
