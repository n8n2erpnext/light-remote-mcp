# Gold Libredesk Support Gate — Master Handoff — 26 October 2026

## Owner scope

Chose Libredesk + custom Support Gate + official Light Remote as AI's investigation arm. Gold has NO ERPNext Helpdesk integration. Work on existing Gold feature branch; do not merge or build Windows. The old independent ERPNext/Helpdesk and all existing mailboxes must remain unchanged.

Checkpoint tag: checkpoint/gold-pre-libredesk-support-gate-20261026. Gold UAT has 3 retained latest snapshots; no change to them.

## What is running

Upstream source: /home/ubuntu/services/libredesk-support/upstream, official v2.9.0 tag, commit 5668a2a2c503b9304404d8f3620131b2990cbb99, AGPL-3.0.
Runtime: /home/ubuntu/services/libredesk-support/runtime (owner-only secrets).
Docker project: libredesk-support-gold, services app, db, redis, gate.
Libredesk image pinned to OCI digest sha256:cdf84e6e6759e5b140a8a59339fb63c5a939175cdae9afd387ac9717dbaeeef4 (ARM64 verified).
New Libredesk PostgreSQL17 schema initialized on EMPTY DB (57 tables), then all 20 official v2.9.0 upgrades; dedicated Redis7; uploads volume.
Custom Node22 Support Gate code: support-gate/ on current Gold worktree. Own database support_gate and non-superuser SQL role; draft and audit tables. Secrets ONLY in runtime 600 files: .env, config.toml, .system-user-password, .gate.env, .gate-owner-password, .gate-worker-token. Username of Libredesk initial admin is System.

Private NetBird UAT:
- http://100.94.184.141:9087/ — Libredesk
- http://100.94.184.141:9088/ — Support Gate owner review
- http://100.94.184.141:5591/ — PREEXISTING Gold Wall unaffected
Host bindings also 127.0.0.1, but never 0.0.0.0. PG/Redis have no host bindings. Gold UAT 4 services stayed ACTIVE; free SSD ~22GB.

Security: UAT-only HTTP over private encrypted NetBird; disable_secure_cookies=true in Libredesk configuration for UAT. Before customer traffic, trusted TLS plus secure cookies must be configured, initial credentials rotated, backups restored in a drill, and access reviewed. No public exposure.

## Completed acceptance

1. Both web apps HTTP 200 through NetBird, PostgreSQL/Redis healthy and isolated.
2. Owner login + CSRF fail-closed, draft create, owner approval.
3. Light Remote scoped token POST /api/agent/drafts creates an internal synthetic draft, visible in owner web dashboard. Incorrect token denied HTTP403; worker cannot approve/send (HTTP401).
4. Owner send denied HTTP503 without Libredesk agent API key/inbox mapping; no outgoing email sent. Email/threading has NOT been tested with real customers.
5. Unmodified existing Gold services and unrelated ERPNext Helpdesk.

## Unfinished — highest priority next

- Create separate Libredesk email inboxes for Remote/LightBI; verify incoming IMAP, outgoing SMTP and correct Message-ID threading using controlled UAT mailbox.
- Generate least-privilege Libredesk agent API key and define brand inbox ID mapping; test real conversation read and owner-approved send with one controlled UAT ticket.
- Wire Libredesk webhooks into a persistent AI work queue and official Light Remote device-session investigation; present evidence/log excerpts to owner. Current scoped draft path is functional, but not an autonomous worker.
- Build expiring customer ticket links with access isolation, public knowledge base, TLS and production backup policy.
- Keep send disabled pending verified channel/recipient and owner explicit approval. Never automatically retry an ambiguous send.

Stop UAT stack safely: from runtime directory run docker compose stop gate app. Do NOT run down -v or remove databases. No Gold Wall rollback is required for this independent stack.
