# Gold Support Center — Signed Inbox Event Intake / Handoff (2026-10-27)

## Owner decision and boundaries
Libredesk v2.9.0 is the ONLY admin/identity provider at `https://support.thaiduy.digital/`. AI Support Gate is the integrated owner console at `https://support.thaiduy.digital/ai-support/`. Brand targets: Light Remote and LightBI. Continue in branch `feature/gold-wall-account-notifications-20261026`; do not merge or build Windows. Gold Wall 5591, ERPNext LXD, legacy Helpdesk tickets, NetBird Traefik route and all production mailboxes remain untouched.

## Verified initial state
- Libredesk PostgreSQL17 contains **zero** inboxes and zero configured outbound webhooks at the start of this phase. There is no real IMAP/SMTP support channel connected.
- Existing Gate retained two synthetic UAT drafts; send remains OFF because Libredesk agent API key/secret and BOTH brand inbox IDs are not configured.
- The owner successfully signed in via Libredesk System Admin on canonical HTTPS, and can open Gate with the same browser session.

## Implemented (new UAT code)
- `support-gate/src/inbound.mjs`: Libredesk v2.9.0 webhook HMAC-SHA256 verification, exact `X-Libredesk-Signature: sha256=<hex>`, allowlisted webhook events, normalize metadata and stable idempotency key.
- Gate POST `/api/webhooks/libredesk`: unauthenticated *by session*, but requires a valid HMAC signature on the original raw bytes; max body 128 KiB. Reject unsigned, wrong signature, malformed/unknown events. Store ONLY metadata; no customer message bodies or PII-containing raw payload.
- New `support_gate_inbound_events` table in the existing dedicated Gate PostgreSQL DB: unique event key, type, conversation UUID, message UUID, inbox ID, sender type, status `pending_review`, reception time. Duplicate event returns 202 but no second insert. No autonomous AI calls and **no outbound mail**.
- Owner-only GET `/api/inbound/events` for queue visibility. All owner APIs still require the real enabled Libredesk Admin session and HMAC-bound Gate CSRF for mutations; worker token still draft-only.
- Owner-only POST `/api/integration/connect-webhook`: via the SAME authenticated Libredesk browser session (cookies + native `X-CSRFTOKEN`), call official Libredesk `POST /api/v1/webhooks`. Creates fixed-name `Light Remote Gold AI Support Gate` with fixed URL `https://support.thaiduy.digital/ai-support/api/webhooks/libredesk`, events `conversation.created` and `message.created`, secret generated/stored server-side. Idempotent when linked; refuses conflicting existing-name entry. Requires `webhooks:manage`. Does not create secondary identity or ask user to paste an API key.
- Gate UI under **Support channels & incoming events** has one-click `Connect incoming events`, event queue and shortcuts to native Libredesk Admin Inbox/Webhook pages.
- Server secret `GATE_WEBHOOK_SECRET` is generated at runtime in owner-only `.gate.env`, permission 0600, intentionally NOT checked into Git.
- Real source Libredesk confirms signed webhook header, event type names and native signature format. Docs: https://support.libredesk.io/en/articles/webhooks and https://support.libredesk.io/en/articles/connecting-inboxes .

## Acceptance on VPS-ARM
- Nine unit tests passed (previous 6 plus 3 inbound signature/normalization/idempotency).
- Official HTTPS route `/ai-support/`, JS, CSS and health all HTTP200. Four Docker support containers running.
- Signed synthetic `webhook.test` POST returned 202; duplicate same payload returned duplicate:true and exactly one metadata event recorded. Unsigned and wrong HMAC requests rejected HTTP401; unauthenticated event list HTTP401.
- Secure cookies are still enabled on Libredesk. `outbound_ready=false` and no customer email sent.
- No Python/SQL bypass to create an admin, inbox or webhook. Live webhook registration still needs an authorized owner browser click; Admin must test the first real Libredesk event.

## What remains, in order
1. Owner signs into the existing HTTPS Libredesk Admin (already functional). Open `https://support.thaiduy.digital/ai-support/`, expand **Support channels & incoming events**, click **Connect incoming events**. Confirm badge says **Webhook connected**. This uses the Libredesk account without a second login or API key.
2. Create the **Light Remote** email inbox (owner-confirmed email address, candidate `support@thaiduy.digital`) via `https://support.thaiduy.digital/admin/inboxes/new` → Other Provider. Use the mailbox provider's dedicated IMAP/SMTP app password in the Libredesk web form, never share it in ChatGPT or Git. For Lark Mail, see https://www.larksuite.com/hc/en-US/articles/484507441712-update-the-smtp-server-settings-in-business-systems-during-email-migration . Typical Lark settings: IMAP `imap.larksuite.com:993` SSL, SMTP `smtp.larksuite.com:465` SSL (or 587 STARTTLS); confirm with Lark's own current mailbox settings. Lark may require owner approval enabling third-party client access and separate application authorization code. **Do not use the ordinary login password.**
3. Decide the real LightBI support mailbox address and ensure it has its OWN IMAP mailbox or a verified alias strategy. Do not blindly point TWO IMAP clients to the SAME mailbox: that could ingest and reply to tickets twice. Create second independent email inbox only after mailbox details are verified.
4. With controlled UAT mailboxes, test inbound email -> Libredesk conversation -> event queue, then test actual reply threading and sender identity in a single owner-authorized transaction. Don't switch existing customer forwarding or MX before acceptance.
5. Provision an explicitly scoped Libredesk agent API user with permission to read conversations and `messages:write`, map correct brand inbox IDs in private Gate env; validate recipient, inbox, latest message and idempotency before enabling Send.
6. Only after verified events/inboxes: persistent AI task worker using official Light Remote authorized session, brand + conversation + project-bound memory, evidence review; AI may propose drafts but cannot approve/send.
7. Customer ticket links without forced login, signed and expiring; harden TLS, backup, retention, CSRF, rate limits and role separation.

## Rollback
- Private full Gate image/DB/environment checkpoint: `/home/ubuntu/n8n2erpnext/support-gate-checkpoints/20261027-inbound-webhook`; Git tag `checkpoint/gold-gate-before-inbound-webhook-20261027`.
- Old image `libredesk-support-gold-gate:pre-inbound-webhook-20261027`; do not delete Docker named volumes. Stop/recreate ONLY Gate if rollback warranted. If a webhook has been registered in Libredesk, disable it via the native Admin UI before reverting the Gate server.
- Keep canonical HTTPS support domain and existing NetBird Traefik, ERPNext LXD and Gold Wall unchanged.

**Important status:** webhook RECEIVER is live and tested; Libredesk webhook CONFIGURATION in native admin is pending owner activation. Mailbox integration and customer email handling are NOT active.
