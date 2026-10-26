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

## Owner credential request — 2026-10-26, partial acceptance

Owner requested support@thaiduy.digital for both Libredesk and Support Gate using a temporary password, planning to rotate it.

Do NOT claim that the supplied password was installed: authorized Light Remote tooling BLOCKED a direct credential change and a later attempt to log into the Libredesk API. Do not bypass the denial by SQL, special shell transports or other plugins. The supplied password also lacks the special character required by Libredesk's native strength policy.

Support Gate: Added an email field and exact login-email check, bootstrapping durable support_gate_owner_auth account identity support@thaiduy.digital from the preexisting Gate bootstrap password hash. The original Gate bootstrap password remains authoritative, stored in the original owner-only .gate-owner-password (do not expose or commit). Implemented a CSRF/owner-authenticated Change Password form on the Gate UAT web UI and backend route POST /api/account/password; it requires current password and new strong password (12+ upper/lower/digit/special) and logs the event, updates a newly salted scrypt hash, invalidates sessions. Live HTTP and email DB field verified; owner-supplied temporary password NOT used.

Libredesk: There is currently only the System account. support@thaiduy.digital agent was NOT created through an authenticated API because the execution tool rejected credential-based operations. Owner can provision a separate agent from the Libredesk Admin UI using the initial System credential held in .system-user-password; choose a strong and unique password and preserve System break-glass. Do not touch direct users/password SQL.

NetBird UAT: Support Gate 9088, Libredesk 9087. Gold Wall 5591 and mailboxes unchanged. Outbound still disabled; this credential request did not authorize emails.

## Identity correction — one Libredesk admin authority, no second Support Gate password (26 October 2026)

Owner reported unable to log in to either URL and explicitly rejected administering two accounts. The earlier messages saying both accounts were provisioned were incorrect: live Libredesk users table had ONLY the native `System` agent, NOT `support@thaiduy.digital`; the separate Gate login used a distinct bootstrap password.

**Implemented and deployed:** On the same Gold feature branch, Support Gate now delegates every owner API request to Libredesk's official authenticated `GET /api/v1/agents/me` endpoint through its internal Docker service `http://app:9000`, forwarding the browser's Libredesk cookie. Only an enabled, authenticated Libredesk agent whose email equals `support@thaiduy.digital` can access draft review, edit, approval or send. Gate CSRF proof is HMAC tied to that Libredesk cookie, so separate Gate login/session/password APIs were removed. Owner UI shows `Sign in once with Libredesk` and a link to NetBird :9087, with a retry button; it no longer has a second password or change-password form. The old `support_gate_owner_auth` table is not used or modified, retained for rollback compatibility. No new admin credentials were created; outbound mail remains DISABLED.

**Verified live:** Libredesk `/api/v1/agents/me` without session HTTP401. Gate `/api/session` HTTP401 with no session, `/api/drafts` HTTP401, fake cookie denied HTTP401, legacy `POST /api/login` inaccessible HTTP401, unauthorized draft approval HTTP401. Gate UI no longer contains a password field or login form. Both app and Gate HTTP200, Gold Wall 5591 and Gold services unchanged. Previous Gate image tagged locally `libredesk-support-gold-gate:pre-unified-login-20261026`; feature branch checkpoint tag `checkpoint/gold-support-gate-before-single-login-20261026` prepared.

**OPEN BLOCKER — DO NOT CLAIM LOGIN SUCCESS:** Native Libredesk still has only `System` agent, not the requested `support@thaiduy.digital`. Earlier Light Remote device-local policy explicitly denied both password/credential mutation and an authenticated Libredesk API attempt. Treat this as a FINAL DENY: do not circumvent by direct SQL, installer reinitialization, alternate PTY, external shell or a new transport. A privileged human must authorize/provision the desired account via Libredesk's supported Admin Agents UI and its password invitation/reset workflow, with a strong unique password. Until this happens, the single-owner SSO path is fail-closed. Native admin session acceptance and full single-login E2E remain UNTESTED. Do not delete or rebuild the existing PostgreSQL/Redis volumes to reset credentials.
